# Audit du document « Yavin — Référence API »

> **Objet** : `/home/user/snack-manager/docs/yavin/YAVIN-API-REFERENCE.md` (398 lignes, daté du 2026‑08‑29), destiné à servir de contexte d'intégration paiement pour Snack Manager.
>
> **Confronté à** :
> - le **code officiel Yavin** cloné localement sous `/home/user/yavinapi/` : `demo-cash-register` (app de caisse Android officielle, API locale + découverte NSD — dernier commit **2022‑06‑27**), `android-api-intent` (démo API Intent v1 et v4 — **2022‑10‑12**), `demo-cashless-nfc` (**2022‑06‑29**), `yavin-android-sdk` (**2024‑05‑07**, SDK de logs/fichiers/connectivité, **pas** un SDK de paiement), `yavin-docs` (un README qui renvoie vers `api.yavin.com/docs`) ;
> - la **cohérence interne** du document, ligne à ligne ;
> - le **dépôt Snack Manager** `/home/user/snack-manager`.
>
> **N'a pas pu être confronté** : `https://api.yavin.com/docs/en`, `https://api.yavin.com/docs/fr` et `https://yavin.notion.site/...` sont **injoignables depuis cette session** (politique de sortie réseau : seuls `github.com` et le registre npm passent ; le proxy refuse le CONNECT sur les autres hôtes). Aucune affirmation du document renvoyant à ces sources n'a donc pu être ni confirmée ni infirmée. Ces points sont isolés en §3.
>
> **Avertissement de méthode** : le code officiel Yavin disponible ici date de **2022** et ne couvre que l'API locale, l'Intent Android et le NFC — **rien** sur le Cloud ni sur l'e‑commerce. Un écart entre le document et ce code n'est donc pas automatiquement une erreur du document : l'API a pu évoluer. Chaque écart est formulé ci‑dessous comme une **divergence à trancher**, les deux versions données.

---

## 0. Verdict

**Peut‑on coder d'après ce document ? Partiellement, et pas encore.** Le document est un bon travail de lecture documentaire — probablement le meilleur point de départ disponible — mais il n'est pas un contrat d'implémentation. Trois défauts le disqualifient en l'état comme source de génération de code : sa légende de confiance ment sur son propre statut, plusieurs de ses exemples copiables sont faux ou incomplets, et sa sonde de vérification (§ 9) est dangereuse.

**Ce qui tient.** La confrontation au code officiel confirme le socle technique : le port `16125`, la base `/localapi/v4/`, le paiement simple en `GET` avec le montant en centimes dans le chemin, le schéma d'URI `yavin://com.yavin.macewindu/v4/<action>?data=…`, l'extraction du résultat par `data.extras.getString("response")`, l'absence totale d'authentification sur l'API locale, la présence d'`idempotentUuid` en requête **et** en réponse, le statut booléen en NFC (Y‑06), et la coquille de port de la doc source (Y‑07). Les noms de champs de réponse (`transactionId`, `cardToken`, `scheme`, `issuer`, `currencyCode`, `appVersion`, `clientCardTicket`/`merchantCardTicket`) sont exacts au caractère près. Sur ces points, on peut écrire des types TypeScript aujourd'hui.

**Ce qu'il ne faut surtout pas en faire.** Ne pas exécuter le § 9. Ne pas copier l'exemple Kotlin du § 4 (il n'envoie ni `cartId` ni `idempotentUuid`, et instancie une classe qui n'existe dans aucun dépôt officiel). Ne pas écrire l'exemple de réponse locale du § 3 tel quel dans un type : il **omet** `cartId` et `reference` — les deux champs sur lesquels le document fonde lui‑même toute sa clé de rapprochement — et affiche un champ `message` qui n'existe dans aucun modèle officiel. Ne pas appliquer la règle 5 du § 10 telle qu'écrite : elle autorise un webhook non signé à faire passer une commande à « payée », c'est‑à‑dire exactement la faille inter‑restaurants que ce dépôt a déjà reproduite puis corrigée sur Stripe (`apps/api/src/modules/ordering/payments.service.ts:394‑414`).

**Ce qui doit être tranché avant la première ligne de code**, et qui ne relève pas du document mais de nous : (a) **le montage juridique** — le restaurateur est‑il contractant direct de Yavin, les fonds arrivent‑ils sur son IBAN sans transiter par nous, y a‑t‑il une rétrocession assise sur son chiffre d'affaires ? C'est la seule question qui peut tuer le projet, et le § 8 du document ne la pose pas ; (b) **la cible de build du POS** — `apps/pos` ne produit aujourd'hui qu'un bundle web servi en HTTPS, d'où un appel `http://192.168.x.x:16125` est bloqué par le navigateur ; le mode retenu au § 0 suppose donc un build natif Android, que le projet a préparé (`app.json` déclare `android.package: "fr.snackmanager.pos"`, `package.json` expose `expo start --android`) mais ne produit pas ; (c) **l'autonomie réelle du mode local** — le TPE honore‑t‑il un appel sur `:16125` sans accès à `api.yavin.com` ? Si la réponse est non, le mode recommandé viole la règle de gouvernance « offline d'abord » (`docs/specs/contraintes-business.md:141`).

**Note de confiance globale.** Sur les trois registres du document — description du transport, exemples de code, règles d'implémentation — la fiabilité décroît nettement : le transport est solide, les exemples sont fautifs, les règles sont contradictoires entre elles. La légende `✅ documenté et vérifié` (ligne 11) est le premier défaut à corriger, parce qu'elle conditionne la lecture de tout le reste : le document dit lui‑même qu'aucun sandbox n'existe (Y‑17, lignes 302‑303), que la sonde reste à exécuter (ligne 321) et que la recette est entièrement décochée (lignes 386‑398). **Aucun `✅` de ce document ne peut signifier « vérifié contre un terminal ».**

**Périmètre écarté par décision produit.** Le § 5 (API E‑commerce / payment links) est intégralement **invérifiable** ici — un `grep` sur `generate_link|payment_link|cart_id|ecommerce` dans les cinq dépôts officiels ne renvoie **aucune occurrence**. Comme la vente en ligne est déjà en production sur Stripe Connect en charges directes, avec absence de commission verrouillée par test (`apps/api/src/modules/ordering/charges-directes.test.ts:102‑121`), ce chantier n'est pas ouvert. Les constats du § 5 restent listés mais sortent du chemin critique.

---

## 1. Ce que la confrontation au code officiel Yavin a confirmé

| Affirmation du document | Preuve (code officiel Yavin, 2022) | Verdict |
|---|---|---|
| Base locale `http://<IP>:16125/localapi/v4/`, port **16125** | `demo-cash-register/.../repository/TransactionRepositoryImpl.kt:32` — `"http://${hostIp}:16125/localapi/v4/payment/$amountCts"` | Confirmé |
| Y‑07 : la doc source se trompe en écrivant `:6125` | même ligne : le seul port réel observé est 16125 | Confirmé |
| Paiement simple = `GET`, montant en centimes dans le chemin | `demo-cash-register/.../network/YavinApiService.kt:11‑14` — `@GET suspend fun makeSimplePayment(@Url url: String)` | Confirmé |
| API locale **non authentifiée** (Y‑14) | `YavinApiService.kt:9‑16` : une méthode, aucun `@Header` ; `ApiModule.kt:56‑58` : le seul intercepteur est le logueur, en DEBUG | Confirmé |
| Transport local en **HTTP clair** | `TransactionRepositoryImpl.kt:32` | Confirmé |
| Découverte NSD/Bonjour possible | `demo-cash-register/.../network/NsdHelper.kt:21` (`SERVICE_TYPE = "_http._tcp."`), `:23` (préfixe de nom `yavin`), `:45` (filtrage par sous‑chaîne) | Confirmé |
| Le service découvert porte hôte + port | `demo-cash-register/.../model/TerminalServiceDTO.kt:3` — `data class TerminalServiceDTO(val host: String, val port: Int, val name: String)` | Confirmé |
| URI Intent `yavin://com.yavin.macewindu/v4/<action>?data=<json url‑encodé>` | `android-api-intent/.../payment/PaymentFragment.kt:107‑111` (`Uri.encode(gson.toJson(...))`), `:114` (`startActivityForResult`) | Confirmé |
| Résultat Intent lu dans l'extra `response` | `PaymentFragment.kt:170` — `data.extras?.getString("response")` | Confirmé |
| `idempotentUuid` existe en Local/Android, en requête **et** en réponse | `PaymentRequestV4.kt:36‑37` ; `PaymentResponseV4.kt:43‑44` | Confirmé |
| Corps local = corps Cloud **sans** `serialNumber`, **plus** `idempotentUuid` | `PaymentRequestV4.kt:11‑38` : aucun `serialNumber`, `idempotentUuid` présent | Confirmé (inférence juste) |
| Noms des champs de réponse : `transactionId`, `cardToken`, `scheme`, `issuer`, `currencyCode`, `appVersion`, `clientCardTicket`, `merchantCardTicket`, `giftAmount` | `PaymentResponseV4.kt:11‑44` ; `demo-cash-register/.../model/LocalPaymentResponse.kt:5‑36` | Confirmé |
| Y‑06 : `status` est un **Boolean** en NFC, String ailleurs | `demo-cashless-nfc/.../model/remote/YavinNFCReaderResponse.kt:7` — `data class YavinNFCReaderResponse(val status: Boolean, val tagInfo: TagInfo? = null)` vs `PaymentResponseV4.kt:37‑38` (`status: String?`) | Confirmé |
| Y‑15 : pagination `offset`/`limit`, **défaut 20**, aucun curseur | `android-api-intent/.../v4/transactions/TransactionsRequestV4.kt:5‑17` | Confirmé (le plafond de 200 reste invérifiable) |
| Montants en **entiers** | `PaymentRequestV4.kt:12‑13` (`amount: Int`) ; `LocalPaymentResponse.kt:8‑9` | Confirmé |
| Y‑03 : trois conventions de nommage cohabitent | modèles TPE tout en camelCase (`PaymentResponseV4.kt`, `LocalPaymentResponse.kt`) contre l'exemple de webhook snake_case du document (`trs_id`, `serial_number`, lignes 102‑109) | Confirmé |
| « Le mot **crash** » de Y‑06 est littéral | `demo-cashless-nfc/.../CashlessPaymentResultContract.kt:22` utilise `Json.decodeFromString` sur un `status` non‑nullable : kotlinx.serialization lève sur un type incompatible | Confirmé |

---

## 2. Erreurs et divergences prouvées

Chaque entrée est prouvée par le code officiel ou par une contradiction interne au document. Les constats réfutés en contre‑expertise ont été retirés (voir la note en fin de section).

### E1 — Un HTTP 200 ne vaut pas paiement accepté : le document ne le dit nulle part

**Citation.** § 1, ligne 43 : « **Codes d'erreur HTTP** ✅ : `400` requête invalide · `401` clé invalide / terminal inaccessible avec cette clé · `404` · `405` · `500`. »

**Preuve.** `demo-cash-register/.../repository/TransactionRepositoryImpl.kt:34` et `:37‑50` : le client officiel teste **séparément** `response.isSuccessful` (le transport) puis `response.body()?.status == "ok"` (l'issue métier). Dans la branche `isSuccessful` (donc 2xx), un `status` différent de `"ok"` est traité comme une **erreur**. Le champ existe bien : `LocalPaymentResponse.kt:30‑31`.

**Conséquence chez nous.** `packages/client-core/src/api.ts:160‑169` classe tout 2xx en succès. Un HTTP 200 portant `status:"ko"` ferait écrire `paid: method !== 'retrait'` — donc `true` pour tout encaissement carte (`apps/pos/src/PosScreen.tsx:377`), la commande partirait en cuisine, le client repartirait sans avoir payé, et le Z du soir compterait une ligne carte sans contrepartie bancaire.

**Correction.** Réécrire la ligne 43 en deux registres explicitement séparés : « **Transport (HTTP)** : 400 / 401 (Cloud et E‑commerce uniquement — Local et Android n'ont pas de clé, cf. ligne 41) / 404 / 405 / 500. **Issue métier** : elle ne se lit **jamais** dans le code HTTP mais dans le champ `status` du corps. Un HTTP 200 avec `status:"ko"` est un paiement **refusé**. ❓ À demander à Yavin : liste close des motifs de `ko`, et code renvoyé quand le terminal est déjà occupé. »

---

### E2 — L'exemple de réponse locale (§ 3) omet `cartId` et `reference`, et invente `message`

**Citation.** § 3, lignes 144‑148 : `{ "status":"ok", "transactionId":"…", "amount":1000, "giftAmount":0, "currencyCode":"EUR", "scheme":"CB", "issuer":"…", "transactionType":"Debit", "cardToken":"…", "clientCardTicket":"…", "merchantCardTicket":"…", "appVersion":"3.2.8", "idempotentUuid":"…", "customer":{…}, "message":"(erreur éventuelle)" }`

**Preuve.** `demo-cash-register/.../model/LocalPaymentResponse.kt` : `cartId` aux lignes **12‑13**, `reference` aux lignes **28‑29** — tous deux présents dans la réponse locale officielle et absents de l'exemple. Aucun champ `message` n'existe dans ce modèle (35 lignes au total), ni dans `PaymentResponseV4.kt` (44 lignes) ; `message` n'apparaît que sur `PrintResponseV4` et `ShareResponseV4`. Symétriquement, `PaymentResponseV4.kt:33‑34` porte un `receiptTicket` que l'exemple ignore aussi.

**Conséquence.** C'est le bloc qu'un développeur copie pour écrire son type de réponse. Un parseur écrit d'après cet exemple **jette silencieusement** `cartId` et `reference` — c'est‑à‑dire la clé de rapprochement que le § 0 institue lui‑même à la ligne 24 et que la règle 2 du § 10 rend obligatoire. Le paiement autorisé ne peut plus être rattaché au ticket ; et un affichage de motif de refus fondé sur `message` restera vide.

**Correction.** Compléter l'exemple avec `"cartId"`, `"reference"` et `"receiptTicket"` ; marquer `message` en `❓` (« observé sur print/share, non observé sur payment — à confirmer ») ; ajouter `cartId` et `reference` à la liste des champs à conserver de la règle 7.

---

### E3 — L'exemple Kotlin du § 4 est inutilisable en l'état

**Citation.** § 4, lignes 167‑173 : `val request = TransactionRequest(amount = 100, customer = …, vendor = …, receiptTicket = …)`

**Preuve.** `grep -ril "TransactionRequest" /home/user/yavinapi` → **0 occurrence** dans les cinq dépôts. La classe officielle est `PaymentRequestV4` (`android-api-intent/.../v4/payment/PaymentRequestV4.kt:11`). Surtout, l'exemple **n'envoie ni `cartId` ni `idempotentUuid`**, alors que le § 0 (ligne 25) et la règle 2 du § 10 (ligne 358) les déclarent obligatoires, et que la démo officielle renseigne bien l'UUID (`PaymentFragment.kt:104`).

**Conséquence.** L'erreur de nom se corrige au compilateur en dix minutes. L'absence des deux champs, non : elle produit précisément le double débit et l'encaissement irrattachable que le reste du document prétend prévenir, et elle passe la compilation.

**Correction.** Remplacer l'exemple par la data class officielle recopiée telle quelle, avec `cartId = ticket.clientId` et un `idempotentUuid` généré **et persisté avant** l'appel.

---

### E4 — La règle 5 du § 10 annule Y‑11 : un webhook non signé y devient une preuve de paiement

**Citation.** § 10, règle 5 (ligne 361) : « Seul un webhook confirmé **ou** une lecture via l'API transactions fait passer à `PAYE`. » — contre Y‑11 (lignes 284‑285) : « aucune signature HMAC, aucun secret partagé […] ➜ **re‑vérification systématique** de chaque événement […] avant de valider un encaissement. »

**Preuve.** Contradiction interne stricte : le « ou » de la règle 5 rend facultative la lecture de contrôle que Y‑11 déclare systématique. Précédent dans le dépôt : `apps/api/src/modules/ordering/payments.service.ts:394‑414` documente la faille reproduite (« un restaurateur pouvait […] payer cinquante centimes sur SON compte en pointant `metadata.orderId` sur la commande de l'autre : elle basculait payée en ligne ») et la correction retenue (le compte émetteur entre dans le filtre de transition, `:415‑423`). La seule route publique non authentifiée tolérée dans cette API l'est parce que la signature HMAC est vérifiée sur les octets bruts avant toute lecture (`apps/api/src/common/stripe-signature.ts:61‑99`).

**Conséquence.** Un développeur qui applique la règle 5 telle qu'écrite ouvre une route publique par laquelle quiconque connaît l'URL solde n'importe quelle commande — en multi‑tenant, celles d'un autre restaurant.

**Correction.** « Le webhook est un **signal**, jamais une preuve. Toute transition vers `PAYE` est précédée d'une lecture serveur→Yavin de la transaction, et s'écrit en transition atomique conditionnée sur l'état attendu **et** sur l'identité du terminal estampillée sur la commande. »

---

### E5 — Y‑12 impose une réconciliation qu'aucune primitive documentée ne permet

**Citation.** Y‑12 (ligne 288) : « **Polling de réconciliation obligatoire** […] + réconciliation de fin de service via `/transactions`. » Y‑11 (ligne 285) : « re‑vérification systématique […] via l'endpoint de détail/liste de transactions ».

**Preuve.** `android-api-intent/.../v4/transactions/TransactionsRequestV4.kt:5‑17` : la requête officielle n'accepte que `startDate`, `endDate`, `limit` (défaut 20), `offset` — **aucun filtre par `cartId`, `reference` ou `transactionId`**. Le `cartId` n'existe que dans la **réponse** (`PaymentResponseV4.kt:17‑18`). Et le document classe lui‑même l'endpoint de détail en `❓` (ligne 58) et `/transactions` Cloud en `⚠️` (ligne 56), tout en interdisant en tête de fichier « d'inventer un endpoint marqué ❓ ».

**Conséquence.** Répondre à « le ticket 000123 a‑t‑il été payé ? » suppose de paginer une fenêtre datée par pages de 200 et de filtrer côté caisse, pendant qu'un client attend au comptoir — contre un critère de sortie produit de « temps moyen d'encaissement < 45 s » (`docs/specs/contraintes-business.md:86`). La remédiation prescrite n'est donc pas implémentable en l'état.

**Correction.** Écrire au § 2 : « il n'existe à ce jour **aucune lecture confirmée d'une transaction par `cartId` ou `transactionId`** ; toute la stratégie de réconciliation en dépend ». Faire remonter cette question au rang 1 du § 8. Tant qu'elle est ouverte, le mode Cloud n'est pas intégrable pour un encaissement synchrone.

---

### E6 — Trois valeurs de délai circulent pour la même attente, et aucune n'est sourcée

**Citation.** § 1, ligne 34 : « **Synchrone** (requête ouverte jusqu'à 5 min) » · § 2.1, ligne 112 : « **Timeout** ✅ : 120 s au total […] 60 s pour les écrans optionnels puis 60 s pour la lecture carte » · § 10, ligne 372 : « `client.local.ts` # API 16125, **timeout 5 min**, retry 0 ». Le § 3, seule section du mode retenu au comptoir, ne donne **aucune** valeur.

**Preuve.** `demo-cash-register/.../network/ApiModule.kt:80‑82` : `connectTimeout(1, MINUTES)`, `readTimeout(1, MINUTES)`, `writeTimeout(1, MINUTES)` — le client officiel abandonne à **60 s**. Divergence à trancher : le code date de 2022 et ne couvre que le paiement simple ; l'API a pu évoluer.

**Nuance retenue après contre‑expertise.** Le « 5 min » n'est pas nécessairement en contradiction avec le « 120 s » : ce sont deux grandeurs différentes (durée de vie de la transaction **côté terminal** vs délai de lecture HTTP **côté caisse**), et un plafond client supérieur au budget terminal est même la bonne configuration. Le défaut réel n'est donc pas la valeur, c'est que **le document ne distingue jamais les deux notions** et ne source ni l'une ni l'autre.

**Conséquence.** Un client réglé trop court (60 s, comme la démo officielle) coupe pendant que le porteur saisit son code : le TPE poursuit et peut débiter, la caisse conclut à un échec — état indéterminé sur une transaction réussie. Trop long, il immobilise un poste.

**Correction.** Séparer explicitement trois notions au § 3 : (a) durée de vie de la transaction côté terminal ⚠️ **à confirmer** ; (b) délai HTTP côté caisse, à fixer **strictement au‑dessus** de (a) ; (c) budget produit d'encaissement (< 45 s). Ajouter : « expiration côté client = état **INDÉTERMINÉ**, jamais ÉCHOUÉ ».

---

### E7 — `receiptTicketJson` est typé `String` dans le modèle officiel, pas objet

**Citation.** § 2.1, ligne 94 : « `receiptTicketJson` | Objet Ecommerce | — | même structure que l'API e‑commerce (items, TVA…) ».

**Preuve.** `PaymentRequestV4.kt:28‑29` — `@SerializedName("receiptTicketJson") var receiptTicketJson: String? = null`. Le suffixe du nom va dans le même sens. **Divergence à trancher** : code de 2022, la structure a pu être promue en objet depuis.

**Conséquence.** Deux formes de fil incompatibles. Selon la tolérance du terminal : soit un 400 en plein service, soit — plus insidieux — le champ ignoré en silence, donc un ticket imprimé sans détail ni ventilation de TVA, sans qu'aucune erreur ne le signale.

**Correction.** Annoter : « type à confirmer — `String` contenant du JSON échappé dans le modèle officiel v4 (`PaymentRequestV4.kt:28`), décrit comme objet dans la doc en ligne ». Tester les deux formes à la sonde.

---

### E8 — Trois champs de la requête officielle manquent aux tableaux du document

**Preuve.** `PaymentRequestV4.kt` déclare treize champs, dont trois absents de toute table du document :

| Champ manquant | Ligne | Enjeu |
|---|---|---|
| `currencyCode` | 16‑17 | présent en requête **et** en réponse ; le document ne le cite que dans les réponses et dans la piste d'audit (§ 10.7) |
| `prepayScreen` | 24‑25 | pilote très probablement les écrans amont que le § 2.1 (ligne 112) chiffre à **60 s** — le document décrit l'effet sans jamais nommer la cause |
| `idempotentUuid` | 36‑37 | cité au § 3 mais absent du tableau de paramètres du § 2.1 |

**Conséquence.** `prepayScreen` est le plus coûteux : le critère de sortie produit est un encaissement moyen sous 45 s, et livrer avec les écrans pourboire/référence actifs par défaut ajoute jusqu'à 60 s par passage carte. Le levier existe, le document ne le mentionne pas, personne ne le cherchera.

**Correction.** Ajouter les trois lignes au tableau du § 2.1, `prepayScreen` marqué `❓` sur ses valeurs acceptées, et le porter au § 8 comme question de performance du comptoir.

---

### E9 — La casse des valeurs de `transactionType` diverge entre requête et réponse

**Citation.** Exemple curl § 2.1 (ligne 71) : `"transactionType": "debit"` et tableau ligne 87 (`debit, reversal, refund, preauthorisation, closingbatch`) — contre l'exemple de webhook ligne 109 (`"type":"Debit"`) et l'exemple de réponse locale ligne 148 (`"transactionType":"Debit"`).

**Preuve.** `android-api-intent/app/src/main/res/values/strings.xml:31‑34` : la liste officiellement envoyée est `<item>Debit</item>` / `<item>Reversal</item>`, **capitalisée**, consommée telle quelle en `PaymentFragment.kt:90`. Seules ces deux valeurs sont attestées ; `refund`, `preauthorisation` et `closingbatch` n'apparaissent nulle part dans le code officiel.

**Conséquence.** Y‑03 relève le changement de **nom** du champ mais pas de **casse des valeurs**. Un `z.enum(['debit','reversal',…])` posé sur la réponse — réflexe naturel dans ce dépôt où tout contrat est en zod — rejetterait 100 % des réponses réelles : paiement réussi côté terminal, erreur de parsing côté caisse.

**Correction.** « Valeurs à envoyer capitalisées (`Debit`, `Reversal`) d'après le code officiel ; comparaison **insensible à la casse** obligatoire en lecture ; `refund` / `preauthorisation` / `closingbatch` marqués `❓` non attestés. »

---

### E10 — Y‑10 signale la paire de champs inoffensive et manque celle qui porte le justificatif CB

**Citation.** Y‑10 (ligne 282) : « `receiptTicket` vs `receipt_ticket` dans la réponse webhook Cloud […] Gérer les deux clés. »

**Preuve.** `PaymentResponseV4.kt:19‑22` et `LocalPaymentResponse.kt:14‑17` : les justificatifs s'appellent `clientCardTicket` / `merchantCardTicket` en Local et Android — alors que l'exemple de webhook Cloud du document (ligne 105) les nomme `client_ticket` / `company_ticket`. « company » contre « merchant » n'est pas une affaire de snake_case : **aucun convertisseur automatique ne rattrapera cet écart lexical**.

**Conséquence.** `receiptTicket` dans une réponse n'est que l'écho de ce qu'on a envoyé : le perdre ne coûte rien. Perdre `clientCardTicket`/`merchantCardTicket`, si, c'est perdre la pièce que le restaurateur produit en cas de contestation — et la règle 7 du § 10 ne les inscrit pas non plus dans les champs à conserver.

**Correction.** Réécrire Y‑10 autour de la bonne paire, et ajouter les deux tickets CB à la règle 7.

---

### E11 — Le document ne mentionne nulle part l'API Intent v1, qui transporte un jeton

**Citation.** § 1, ligne 41 : « **Local & Android : pas de clé** […] ✅ ».

**Preuve.** `android-api-intent/.../api/v1/payment/PaymentRequestV1.kt:33‑34` — `@SerializedName("vendorToken") var vendorToken: String? = null`, transmis en extra d'Intent (`PaymentFragment.kt:142`). L'affirmation est **exacte pour la v4** (`PaymentRequestV4.kt` ne porte aucun jeton) et pour l'API locale ; elle est fausse comme énoncé général sur « Android ».

**Nuance.** Le document se déclare v4 de bout en bout (bases `api/v4/pos/`, `/localapi/v4/`, URI `…/v4/…`). Le reproche est donc de **périmètre**, pas de fond : il ne prétend pas inventorier les générations. Reclassé en gravité **moyenne**.

**Correction.** Une ligne : « **Android Intent v1** : un `vendorToken` est transmis en extra d'Intent — statut de dépréciation `❓` à confirmer auprès de Yavin. »

---

### E12 — « Réconciliation triviale » (§ 0) est démenti par le § 7 du même document

**Citation.** § 0, ligne 20 : « API Local (`:16125`), synchrone, **réconciliation triviale**. » — contre Y‑13 (lignes 290‑291) : « `timezone` **n'est acceptée que côté Cloud** ➜ toute clôture de caisse […] doit passer par une conversion explicite », et la checklist ligne 398 « Coupure secteur du TPE en pleine transaction ».

**Preuve.** Contradiction interne, corroborée par `TransactionsRequestV4.kt:5‑17` : hors Cloud, la liste ne connaît ni `timezone`, ni `startTime`/`endTime`, ni `serialNumbers` — donc on ne peut demander que des journées entières, sans fuseau. La réconciliation locale est structurellement **plus** difficile que la Cloud, pas plus facile.

**Conséquence.** Le chantier sera chiffré sans écran « transaction en suspens », sans job de rattrapage et sans rapprochement du Z avec les totaux du terminal, puisque le document a déclaré le sujet réglé. Chez nous, `apps/pos/src/PosScreen.tsx:456‑465` vide le journal du service sans condition : le premier soir où une tablette se verrouille en pleine transaction, la seule trace locale disparaît à la clôture.

**Correction.** « API Local (`:16125`), synchrone. **Réconciliation à concevoir** : le rejeu du même `idempotentUuid` est le seul chemin de reprise après perte de la réponse ; la clôture impose une conversion de fuseau explicite (`timezone` n'existe pas en local, Y‑13) et une lecture de `/transactions` sur fenêtre fermée (Y‑15). »

---

### E13 — Y‑02 propose un remède que le document interdit ailleurs

**Citation.** Y‑02 (ligne 259) : « stocker le `transactionId` d'origine dans `reference`/**`cartId`** du remboursement ».

**Preuve.** Contradiction interne double : règle 2 du § 10 (ligne 358) — « `cartId` = identifiant interne du ticket, **unique et immuable** » ; et § 5 (ligne 192) — « `cart_id` […] unique par société ; si déjà pris → erreur `This cart_id already exists` ». Écrire dans `cartId` l'identifiant d'une autre transaction casse la clé et heurte l'unicité.

**Conséquence.** Un remboursement portant le `cartId` d'une vente existante fait compter deux fois le même ticket à la réconciliation, ou échoue en e‑commerce. Côté NF525, réutiliser l'identifiant de la vente d'origine, c'est réécrire la pièce — exactement ce que le patron append‑only du dépôt interdit (`packages/db/src/schemas.ts:1150‑1168`).

**Correction.** « Le remboursement est une **pièce nouvelle** : il reçoit son propre `cartId`, jamais celui de la vente, et porte l'identifiant de la vente remboursée dans `reference`. » Vérifier au préalable la longueur maximale et le jeu de caractères acceptés par `reference`.

---

### E14 — `cartId` et `idempotentUuid` : la règle de dérivation manque, et son absence est un piège

**Citation.** § 3, ligne 141 : « si la transaction a échoué (`ko`), le même UUID renvoie l'échec en boucle — il faut **changer l'UUID pour retenter**. » — contre § 10, règle 2 : « `cartId` […] unique et **immuable** ».

**Preuve.** `PaymentRequestV4.kt:14‑15` (`cartId`) et `:36‑37` (`idempotentUuid`) sont deux champs distincts, tous deux réémis en réponse (`PaymentResponseV4.kt:17‑18` et `:43‑44`). Le document ne dit **nulle part** que leurs cycles de vie sont opposés.

**Conséquence.** La caisse dispose déjà d'un UUID naturel par commande (`clientId`, `packages/contracts/src/index.ts:256`, index unique `{tenantId, clientId}` en `packages/db/src/schemas.ts:577`) : le réflexe sera d'en dériver l'`idempotentUuid`. Premier passage, carte refusée : le TPE mémorise `ko` sur cet UUID. Le caissier demande une autre carte, la caisse renvoie le même UUID, le TPE répond `ko` sans solliciter le lecteur. **Le ticket devient définitivement non encaissable par carte**, devant la file.

**Correction.** Écrire en § 3 **et** en règle 10 : « `cartId` = identité du **ticket**, immuable, un par commande. `idempotentUuid` = identité d'une **tentative**, régénérée à chaque nouvelle présentation de carte, **persistée avant** l'appel. Ne jamais dériver l'un de l'autre. »

---

### E15 — Le GET de paiement n'est assorti d'aucune réserve, alors qu'il viole quatre règles du document

**Citation.** § 3, ligne 132 : « | Paiement simple | `GET /localapi/v4/payment/<MONTANT_CENTIMES>` | » — présenté sur la même ligne de tableau que le POST, sans réserve.

**Preuve.** `YavinApiService.kt:11‑14` : `@GET`, sans corps. Cette requête ne peut donc transporter ni `idempotentUuid` (exigé § 0 ligne 25 et § 10 ligne 372), ni `cartId` (règle 2), ni `vendor` (règle 3), ni `reference`, ni `receiptTicket`.

**Nuance après contre‑expertise.** L'argument « le client officiel a dû se protéger du cache » ne tient pas : `retryOnConnectionFailure(true)` et `cache(null)` sont les **valeurs par défaut** d'OkHttp, et ils figurent dans un builder nommé `providesUnsafeOkHttpClientBuilder` qui installe par ailleurs un TrustManager acceptant tout (`ApiModule.kt:97‑116`) et un `hostnameVerifier { _, _ -> true }` (`:91`) — c'est du passe‑partout, pas une précaution. Reste le fait, suffisant : **un ordre de paiement porté par une méthode HTTP réputée sûre et idempotente est structurellement fragile**, et `retryOnConnectionFailure(true)` posé deux fois (`:83` et `:92`) signifie que ce client réémet la requête en cas de rupture de connexion.

**Correction.** « Paiement simple — **interdit en production Snack Manager** : ne transporte ni `idempotentUuid`, ni `cartId`, ni `vendor` ; réservé au diagnostic d'installation. Tout encaissement passe par `POST /localapi/v4/payment`. Ne pas recopier la configuration du client de démonstration : `retry 0` explicite. »

---

### E16 — Y‑14 s'arrête au sens sortant, et ignore l'usurpation du terminal

**Citation.** Y‑14 (lignes 293‑294) : « Toute machine du LAN peut déclencher un paiement ou une impression sur le TPE. ➜ VLAN dédié / isolation réseau. »

**Preuve.** Le constat de base est exact et prouvé (§ 1 du présent rapport). Trois angles morts, tous ancrés dans le code :
- **entrant** : `NsdHelper.kt:45` sélectionne le terminal sur une simple sous‑chaîne `"yavin"` dans le nom de service annoncé, sans aucune authentification. N'importe quelle machine du réseau peut annoncer un service « yavin‑… » et répondre `{"status":"ok","transactionId":"…"}` à la caisse ;
- **confidentialité** : `LocalPaymentResponse.kt:10‑17` fait transiter `cardToken`, `clientCardTicket` et `merchantCardTicket` en **HTTP clair** ;
- **déni de service** : le § 2.2 du document (ligne 121) indique qu'un `abort` sans `idempotentUuid` annule de force **toute** transaction en cours — sur une API non authentifiée, c'est une primitive d'arrêt de l'encaissement carte, exécutable en boucle.

**Contradiction non relevée** : la parade « VLAN dédié » de Y‑14 est incompatible avec la découverte NSD que le § 3 présente comme mécanisme d'adressage — le mDNS ne franchit pas les frontières de sous‑réseau.

**Correction.** Reclasser Y‑14 en **bloquant**, le compléter dans les deux sens (la caisse épingle adresse **et** numéro de série du terminal appairé, refuse toute réponse dont le `cartId` ne correspond pas à celui envoyé), et réconcilier explicitement Y‑07/§ 3 avec Y‑14 sur le plan réseau.

---

### E17 — `Vendor` change de forme entre l'aller et le retour, sans que le document le dise

**Citation.** § 6, ligne 234 : « Vendor (TPE) : { `softwareName`, `softwareVersion` } » — contre l'exemple de webhook du § 2.1, ligne 109 : `"vendor":{ "apiVersion":"v1" }`.

**Preuve.** Contradiction interne, la forme aller étant confirmée par `android-api-intent/.../model/Vendor.kt` (deux champs, rien d'autre).

**Conséquence.** Un mapper qui réutilise le type `Vendor` du § 6 pour parser le webhook produit deux champs nuls et perd `apiVersion` ; avec un parseur strict (zod `.strict()`), il **lève** sur un champ inconnu et le webhook est rejeté — une carte débitée, une commande jamais passée à `PAYE`.

**Correction.** Scinder l'entrée du § 6 en « Vendor (requête TPE) » et « Vendor (webhook Cloud) », et poser en règle de mapping : tout parseur d'événement entrant est **tolérant** aux champs inconnus, jamais strict.

---

### E18 — La légende de confiance est le défaut structurel du document

**Citation.** Ligne 11 : « `✅` documenté et **vérifié** ».

**Preuve.** Contradiction interne quintuple, avec le document lui‑même : ligne 60 (« Avant le premier dev, exécuter la sonde du § 9 »), ligne 321 (titre « Sonde de vérification **à exécuter** »), lignes 386‑398 (checklist de recette entièrement décochée), lignes 302‑303 (Y‑17 : pas de sandbox, « demander un TPE de test **avant tout développement** »). Aucun `✅` ne peut donc signifier « vérifié contre un terminal ». S'y ajoutent des `✅` de section qui écrasent des marqueurs de champ contraires : § 3 titré `✅` alors qu'une de ses lignes porte `⚠️` (ligne 137) et que Y‑07 établit que la doc source y est fautive ; § 5 titré `✅` alors que ses endpoints sont `❓` (ligne 186) ; § 6 titré `✅` alors qu'il contient `tax.rate ⚠️` que le § 8 déclare **bloquant**.

**Conséquence.** L'en‑tête (lignes 3‑5) destine explicitement ce fichier à un agent de génération de code, avec la consigne « Ne jamais inventer un endpoint marqué ❓ ». Cette consigne institue mécaniquement `✅` en **feu vert de génération**. Le document s'est doté d'une échelle à trois crans dont le cran haut est vide.

**Correction — à faire en premier, elle conditionne la lecture de tout le reste.** Redéfinir : `✅` = « lu dans la doc EN, **non testé** » · `⚠️` = « inféré, à tester » · `❓` = « inconnu ». Ajouter un quatrième cran `🧪` = « vérifié contre un TPE **ou** contre le code officiel Yavin », et n'y basculer un point qu'après preuve. Descendre tous les marqueurs au niveau de la **ligne**, jamais de la section.

---

> **Constats écartés après contre‑expertise.** Quatre reproches ne résistent pas à la vérification et ne figurent pas ci‑dessus :
> - « le document annonce trois modes mais en documente quatre » : le titre de la ligne 29 est « Les trois modes d'intégration **TPE** » ; l'e‑commerce n'implique aucun terminal et a sa propre section. Comptage **exact**.
> - « le port est placé dans l'adaptateur » : dans le bloc des lignes 370‑378, `ports.ts` est indenté sous `src/payments/`, **frère** de `yavin/`, et la ligne suivante énonce exactement la règle qu'on lui reprochait de violer. Reste le vrai défaut, traité en § 6 : le chemin `src/payments/` n'existe pas dans ce monorepo.
> - « `reference = n° de ticket` est une erreur » : le document ne fait nulle part de `reference` une clé unique — le § 0 écrit « `cartId` + `reference` » et la règle 2 tranche explicitement. Reclassé en **omission** (voir § 4).
> - « le critère “caisse locale sans websocket” désigne le mauvais discriminant » : en mode Cloud le résultat arrive par webhook sur un serveur, donc une caisse web a besoin d'un canal de poussée que le mode local rend inutile. Le critère est défendable ; la remarque est une préférence rédactionnelle.

---

## 3. Affirmations invérifiables — et lesquelles sont dangereuses

`api.yavin.com/docs` et le lien Notion étant inaccessibles depuis cette session, tout ce qui ne figure pas dans le code officiel de 2022 est **hors de portée de vérification**. Le tableau distingue l'invérifiable inoffensif de l'invérifiable qui porte une décision.

| Affirmation | Marqueur du document | Statut réel | Danger |
|---|---|---|---|
| Fenêtre d'idempotence de **24 h** (§ 3, ligne 141) | `✅` implicite (section `✅`), en gras | **Invérifiable** : `grep -rn "idempotent"` ne renvoie que les déclarations de champ, aucune durée | **Élevé** — décide de la conception de la reprise après panne ; notre file n'a ni âge maximal ni plafond d'essais (`sync-queue.ts:33‑34`, `:186`), un rejeu hors fenêtre redevient un débit neuf |
| Timeout de **120 s** (60 + 60), § 2.1 ligne 112 | `✅` explicite | **Invérifiable** ; le client officiel coupe à 60 s (`ApiModule.kt:80‑82`) | **Élevé** — calibre le timeout client et l'état INDÉTERMINÉ (cf. E6) |
| « Requête ouverte jusqu'à **5 min** » (§ 1, ligne 34) | aucun marqueur | **Invérifiable**, non sourcé | Moyen — à marquer `⚠️` |
| `acceptedPayment.acceptedMediumType` (§ 2.1, Y‑09, règle 9) | `✅` dans la table, `⚠️` en Y‑09 | **Invérifiable** : `grep -ril "acceptedPayment\|acceptedMediumType\|acceptedPaymentType"` → **0 occurrence** sur les cinq dépôts ; absent de `PaymentRequestV4.kt` | **Élevé** — toute la stratégie titres‑restaurant (règle 9 + checklist § 11) repose dessus ; et un nom de champ inconnu est en général **ignoré en silence**, donc la restriction ne s'appliquerait pas sans erreur visible |
| Paramètres NFC `NFCReaderRequestV4(timeout, readerIncentive)`, défaut 90 000 ms, min 10 000 (§ 4, ligne 180) | `✅` (section `✅`) | **Invérifiable** : `grep` → 0 occurrence ; la classe de réponse réelle s'appelle `YavinNFCReaderResponse`, pas `NFCReadResponse` ; la démo appelle l'action **sans** `?data=` | Faible — hors périmètre (aucun usage NFC prévu), mais le nom de classe erroné doit être corrigé |
| Medium de partage `yavin` (§ 2.2, ligne 119) | `✅` | **Divergence** : `ShareMedium.kt:3‑7` ne connaît que `print`, `sms`, `email`, plus une sentinelle `UNDEFINED`, et `fromCode` renvoie `UNDEFINED` sur valeur inconnue **sans lever** | Moyen — un partage avec un medium non supporté n'échoue pas, il ne fait rien |
| `abort` (Cloud comme local, verbe, paramètres, sémantique) | `⚠️` Cloud, `⚠️` local (Y‑04) | **Invérifiable** : `grep -ril "abort"` → **0 occurrence** dans tout le code officiel | **Élevé** — un `abort` sans `idempotentUuid` annulerait « toute transaction en cours » ; conséquence directe sur la sonde du § 9 (voir § 5) |
| Tout le § 5 (e‑commerce) : statuts, 72 h, script 05:00 GMT, capture automatique, codes 201/400, forme du webhook | `✅` de section, endpoints `❓` | **Intégralement invérifiable** : aucune ligne d'e‑commerce dans les cinq dépôts | Écarté du chemin critique (Stripe conservé), mais le `✅` de section doit tomber |
| Objets `Item`, `Tax`, `Store`, `Features`, `AcceptedPayment` (§ 6) | `✅` de section | **Invérifiable** : aucune data class correspondante | Moyen — `tax.rate` est déjà `⚠️`/bloquant au § 8, mais vit sous un titre `✅` |
| « ESCPOS supporté en Android / JS / Python (exemples sur le GitHub Yavin) » (§ 6, ligne 243) | affirmation nue | **Invérifiable** : l'énumération de l'organisation GitHub est refusée par le proxy ; sur les cinq dépôts locaux, une seule occurrence d'« escpos », une valeur de menu déroulant (`strings.xml:36‑38`) | Faible, mais c'est le seul appui de l'encodage hexadécimal du champ `data` |
| Y‑01 (la doc FR est en retard) et Y‑17 (mention « Sandbox Fake ticket ») | affirmations nues | **Invérifiables** ; Y‑17 est **corroboré indirectement** : aucun `buildType` de test, aucune base URL alternative, aucun numéro de série factice dans les dépôts officiels | Faible pour Y‑01 ; Y‑17 est une bonne question, à reformuler sur la preuve disponible |

**Où l'affichage est trompeur.** Le `✅` du § 1 couvre la sémantique du `401` et le comportement à 5 min, qu'aucune source ne soutient. Le `✅` du § 3 couvre cinq chemins locaux (`ping`, `print`, `share-receipt`, `transactions`, `abort`) qu'**aucun** code officiel ne corrobore — seul le paiement simple l'est. Le `✅` du § 4 couvre `acceptedPayment` et les paramètres NFC, absents de tout le SDK. Le `✅` du § 5 couvre une section dont le document déclare lui‑même les endpoints inconnus. Le `✅` du § 6 couvre `tax.rate`, que le § 8 classe bloquant.

---

## 4. Ce que le document oublie

### 4.1 Exploitation au comptoir

| Manque | Pourquoi ça compte chez nous | Gravité | Ce qu'on en fait |
|---|---|---|---|
| Autonomie réelle du mode local sans internet | Le § 0 justifie l'API locale par la synchronicité, jamais par l'autonomie réseau — la seule propriété qui compte. `docs/specs/contraintes-business.md:141` donne un **droit de veto** à toute fonctionnalité qui casse le service hors ligne | Bloquante | Question n° 2 à Yavin (§ 8) |
| Concurrence d'accès : deux caisses pour un TPE, une caisse pour plusieurs TPE | Aucun code « terminal occupé » dans la liste du § 1 ; le § 2.2 indique qu'un `abort` sans UUID annule toute transaction en cours — la caisse 2 peut tuer l'encaissement de la caisse 1. Notre commande n'a pas de `deviceId` (`packages/db/src/schemas.ts:479`) et `DEVICE_KINDS` ne connaît que `pos` et `kds` | Bloquante | Question n° 5 ; créer l'entité poste avant tout appairage |
| Coupure secteur / redémarrage du TPE en pleine transaction | Dernier item de la checklist § 11, sans une ligne d'explication ailleurs. Chez nous l'issue est aggravante : un refus 4xx au rejeu **supprime définitivement** l'entrée de la file (`sync-queue.ts:179‑184`) | Bloquante | Question n° 4 |
| Sort de la transaction quand **la caisse** lâche (timeout client, crash, rechargement) | Le document ne documente que le timeout côté terminal. Trois issues incompatibles restent ouvertes, et le geste du caissier diffère dans les trois | Bloquante | Question n° 4 |
| Rejeu du même `idempotentUuid` pendant que la première transaction est **encore en cours** | Le § 3 ne décrit que le cas d'une transaction terminée. C'est pourtant le cas qui suit un timeout | Bloquante | Question n° 4 |
| Fenêtre d'annulation (`reversal` avant télécollecte vs `refund` après) | Le geste le plus fréquent au comptoir — erreur de montant à 30 s — est indécidable : aucun champ de réponse n'indique si la transaction est encore annulable. Chez nous, `refunded` existe (`schemas.ts:515`) mais aucun chemin humain n'y mène | Forte | Question n° 7 |
| Télécollecte : heure de coupure, numéro de remise, totaux par schéma | Le Z existe pour être recoupé avec « le bordereau du TPE » (`apps/pos/src/pos-state.ts:237‑244`). Sommer `/transactions` n'est pas un bordereau | Forte | Question n° 8 |
| Transactions saisies **directement sur le terminal**, hors caisse | Inévitables au comptoir, sans `cartId`, mais dans la télécollecte : la colonne « Carte bancaire » du Z sera durablement inférieure au bordereau, sans imputation | Forte | Question n° 8 |
| Paiement partiel / mixte au comptoir (TR + complément CB) | Cas dominant du service du midi. `payment` est un sous‑document **unique** mono‑tender (`schemas.ts:506‑532`) | Forte | Refonte du modèle avant intégration |
| Échec d'impression du ticket de caisse par le TPE | La règle 1 délègue au terminal l'impression de la pièce fiscale ; `PrintResponseV4` ne rend que `status`/`message`. Un rouleau vide fait‑il échouer la transaction ? | Forte | Question n° 9 |
| Mode formation / transactions d'essai | La FAQ le promet nommément au gérant (`contraintes-business.md:255`) ; NF525 impose d'identifier les données d'essai | Moyenne | À porter au § 8 |

### 4.2 Conformité NF525 et fiscale

| Manque | Pourquoi ça compte chez nous | Gravité | Ce qu'on en fait |
|---|---|---|---|
| Inaltérabilité du journal d'encaissement | `AuditLogSchema` porte l'en‑tête « append‑only, socle NF525 » et **aucun hook** (`packages/db/src/schemas.ts:597‑614`), alors que le patron complet existe et fonctionne sur `AdminLogSchema` (`:1150‑1168`, huit opérations bloquées) | Bloquante | **Décision interne** : portage de ~18 lignes, plus empreinte + chaînage + numéro de séquence |
| Clôture Z persistée, mensuelle, annuelle, grand total perpétuel | « Clôturer le service » vide un état local du navigateur (`apps/pos/src/PosScreen.tsx:456‑465`) ; aucune collection de clôture n'existe | Bloquante | Décision interne, avant l'intégration |
| Archivage fiscal | Seule externalisation : dump nocturne R2 en rotation 30‑90 jours (`.github/workflows/sauvegarde.yml:33`) ; les CGA promettent au contraire la suppression 60 jours après le contrat (`docs/juridique/cga-brouillon.md:124‑129`) | Bloquante | Décision interne + question n° 12 (rétention Yavin) |
| Attestation NF525 / auto‑certification | Jalon déclaré « bloquant, pas cosmétique, AVANT le premier client facturé » (`contraintes-business.md:264‑276`), et la réponse commerciale affirmant la conformité est **déjà rédigée** | Bloquante | Décision interne |
| TVA de bout en bout | Aucun taux sur le produit (`schemas.ts:423‑432`), aucune ventilation sur le ticket (`ticket.service.ts:125‑131`), aucune dans le Z | Bloquante (pour le chemin itemisé) | Prérequis **chez nous** avant même de poser Y‑05 à Yavin |
| Mentions légales et duplicata sur le ticket | Ni SIRET ni n° de TVA au pied, alors que `tenant.billing` les porte (`schemas.ts:164‑190`) ; `printedAt` recalculé à chaque appel sur une route publique rejouable | Forte | Décision interne |

### 4.3 RGPD et PCI‑DSS

| Manque | Pourquoi ça compte chez nous | Gravité | Ce qu'on en fait |
|---|---|---|---|
| Périmètre PCI‑DSS : le mot n'apparaît pas une fois | L'API locale circule en HTTP clair et transporte `cardToken` et les deux tickets CB. Le SAQ applicable à l'intégrateur et au commerçant n'est pas établi | Forte | Question n° 11 |
| Yavin comme sous‑traitant RGPD (DPA, hébergement, durée, sous‑traitants ultérieurs) | Le document fait transiter prénom, nom, e‑mail, téléphone vers le terminal ; nos CGA n'énumèrent que Railway, R2, Brevo et Stripe, et le DPA est encore `[À RÉDIGER]` | Forte | Question n° 12 |
| Nature exacte de `cardToken`, que la règle 7 ordonne de conserver | Stable par carte ? réversible ? Notre `meta` d'audit est un `Mixed` libre (`schemas.ts:607`) et l'export nocturne part en clair sur R2 | Forte | Question n° 11 ; suspendre la règle 7 sur ce champ |
| Périmètre de la règle 6 (« journaliser le brut ») | Appliquée telle quelle, elle fait entrer PAN masqué, jeton et coordonnées client en base puis dans les sauvegardes, sans durée de conservation | Forte | Amender la règle : troncature explicite au mapping, rétention nommée |

### 4.4 Ingénierie

| Manque | Pourquoi ça compte chez nous | Gravité | Ce qu'on en fait |
|---|---|---|---|
| L'ordre de paiement ne doit **jamais** passer par la file offline | Le § 10 n'en dit pas un mot. `client.post` rend la main dès l'écriture disque (`sync-queue.ts:130‑150`) et rejoue indéfiniment ; un ordre de paiement rejoué = second débit. Le contre‑exemple à copier existe déjà : `client.direct` pour la remise (`PosScreen.tsx:414‑421`) | Bloquante | Règle 11 à ajouter au § 10 |
| État **INDÉTERMINÉ** dans la machine à états | La règle 5 ne prévoit que `PAYE|ECHOUE|ABANDONNE|EXPIRE` : aucun n'exprime « le délai a expiré, on ne sait pas » | Bloquante | Ajouter l'état, plus la règle « un état terminal ne s'écrase jamais » (jumelle de `mostAdvancedStatus`, `packages/contracts/src/index.ts:47‑61`) |
| Horodatage de la transaction en Local et Android | `LocalPaymentResponse.kt` et `PaymentResponseV4.kt` ne portent **aucune date** — alors que la règle 7 exige de conserver `createdAt`/`device_datetime` | Forte | Question n° 10 |
| `device_datetime` est une heure locale naïve | Vérifié arithmétiquement dans le document : `device_timestamp` 1664183489148 = 09:11:29 UTC, soit 11:11:29 à Paris (CEST) — exactement `device_datetime` (ligne 107). Or la règle 7 en fait l'horodatage de piste d'audit | Forte | Conserver `device_timestamp` comme référence ; `device_datetime` en libellé d'affichage seulement |
| Contraintes de forme sur `cartId` et `reference` (longueur, jeu de caractères, casse) | Notre clé naturelle est un UUID v4 de 36 caractères ; rien ne garantit qu'il soit accepté sans troncature | Forte | Question n° 10 |
| Tailles maximales de payload (`receiptTicket.data`, corps complet) | Notre ticket ESC/POS fait plusieurs kilo‑octets, doublés en hexadécimal, et transite par une URI en mode Intent | Forte | Question n° 10 |
| Quotas et limites de débit | Le document classe le sujet `❓` (Y‑15) tout en prescrivant un polling périodique + une réconciliation de clôture, toutes caisses en même temps | Forte | Question n° 8 |
| Versionnement et dépréciation de l'API | Le document fige `v4` sans dire depuis quand ni jusqu'à quand. Le code officiel prouve qu'un saut brutal a déjà eu lieu (`ApiVersion.kt` : V1 et V4, transports et types incompatibles) | Forte | Question n° 13 |
| Mise à jour de l'app Yavin Pay sur le parc | Le document affiche `app_version:"5.0.1"` (webhook) et `appVersion:"3.2.8"` (réponse locale) sans dire laquelle supporte quoi. Ces mises à jour sont poussées par Yavin, pas par nous — notre règle « aucun déploiement jeudi‑dimanche » ne les gouverne pas | Forte | Question n° 13 |
| État du terminal sans effet de bord (que contient le `ping` ? le terminal est‑il occupé ?) | Le seul outil laissé par le document est l'`abort` sans UUID, c'est‑à‑dire le geste destructeur | Forte | Question n° 5 |

### 4.5 Contrat et commercial

| Manque | Pourquoi ça compte chez nous | Gravité | Ce qu'on en fait |
|---|---|---|---|
| **Qui contracte, qui perçoit les fonds** | Aucune des neuf questions du § 8 ne l'aborde. Notre encaissement en ligne a été construit pour que la plateforme ne soit **jamais** dans le flux (`apps/api/src/modules/encaissement/encaissement.service.ts:33‑43` : « encaisser pour le compte d'autrui est un service de paiement réservé aux établissements agréés »), et c'est verrouillé par test | **Bloquante — la seule qui peut tuer le projet** | Question n° 1 |
| Rétrocession / commission d'apport | Collision frontale avec « 0 % commission », argument de vente n° 1, en méta‑description du site et objectif de trimestre | Forte | Question n° 1 |
| Réversibilité : accès à l'historique après changement d'acquéreur | « Sans engagement veut dire sans otage » est un engagement contractuel ; Y‑02 établit qu'un remboursement n'est pas lié à sa vente d'origine — sans accès à My Yavin, la queue historique devient non remboursable | Forte | Question n° 14 |
| Révocation / résiliation : événement dédié ? | Le § 1 range « clé invalide » et « terminal inaccessible » sous le même 401. Le précédent Stripe est explicite : sans `account.application.deauthorized`, les drapeaux resteraient « actif » pour toujours | Forte | Question n° 14 |
| Litiges, impayés, chargebacks | Le mot n'apparaît pas une fois dans 398 lignes. La pièce à produire est le `merchantCardTicket` — que la règle 7 n'inscrit justement pas dans les champs à conserver | Forte | Question n° 9 |
| Support et SLA : canal, horaires, escalade, page d'état | Notre engagement écrit au gérant est « réponse en moins de 5 minutes » sur un incident de service. Rien ne dit comment joindre Yavin un vendredi à 20 h | Forte | Question n° 15 |

---

## 5. La sonde du § 9 : ne pas l'exécuter telle quelle

Le § 9 est présenté comme l'étape préalable au premier développement (« Avant le premier dev, exécuter la sonde du § 9 », ligne 60). **Lu comme du code, c'est un script à effets monétaires irréversibles, sans un mot d'avertissement.** Analyse ligne à ligne du bloc des lignes 323‑349.

### Ce qu'il déclenche réellement

| # | Ce que la sonde fait | Ce qui se passe réellement |
|---|---|---|
| 1 | `# .env : YAVIN_API_KEY=… SN=… IP_TPE=…` | Le fichier **n'est jamais chargé** : aucun `source`, aucun `set -a`. Sans `set -u`, les trois variables s'interpolent en chaînes vides. L'en‑tête devient `Yavin-Secret: ` et l'URL locale `http://:16125/...`. Et `SN` — le seul paramètre obligatoire des appels Cloud — n'est **utilisé nulle part** |
| 2 | Boucle POST `{}` sur `payment/`, `print`, `transactions`, `abort`, `share-receipt` avec la clé de production | Deux de ces cinq chemins sont à effet de bord : `payment/` (démarrage de transaction) et `abort`. Le document classe lui‑même quatre d'entre eux `⚠️`/`❓`, c'est‑à‑dire qu'il **ne connaît pas leur contrat de requête** — et suppose pourtant que `{}` est inerte. Raisonnement circulaire |
| 3 | Table d'interprétation « 405/400 = le chemin existe ; 404 = mauvais chemin » | Ne couvre ni `401` (le cas le plus probable, cf. #1), ni `000` (ce que `curl -w '%{http_code}'` rend sur échec de connexion), ni `3xx` (redirection de normalisation d'URL). Or la boucle mélange `payment/` **avec** barre finale et les quatre autres **sans** : sur un backend sensible au slash, `print` et `transactions` renverront un 3xx ou un 500, jamais un 404, et seront déclarés inexistants à tort |
| 4 | Étape 4 : `-d "{\"amount\":100,…}"` sur `POST /localapi/v4/payment` | `amount:100` = **1,00 €**, pas 1 centime. Sur un terminal de production, appairé à un contrat monétique réel — alors que Y‑17 (lignes 302‑303) constate qu'aucun sandbox n'existe et recommande « un TPE de test **avant tout développement** ». Aucun `cartId`, aucune `reference` : le débit, s'il part, est irrattachable au Z |
| 5 | `sleep 3` puis `POST /localapi/v4/abort` | La requête de paiement ne demande **aucun** écran amont (ni `giftAmount`, ni `reference`, ni `prepayScreen`) : le terminal saute directement à « présentez votre carte ». À t+3 s, l'abort tombe donc **pendant la lecture de carte** — ce que le document interdit deux fois, au § 2.2 ligne 121 (« risque d'incohérence de données ») et en règle 10 du § 10 |
| 6 | `UUID=$(uuidgen)` | `uuidgen` **n'est pas POSIX** : absent des images Debian/Ubuntu minimales (paquet `uuid-runtime`), d'Alpine sans `util-linux`, de Git‑Bash. Sans `set -u`, la variable est vide et le corps devient `{"idempotentUuid":""}`. Un champ vide sera très probablement traité comme absent — or le § 2.2 du document indique qu'un abort sans `idempotentUuid` annule **de force toute transaction en cours**. *(La sémantique de l'abort local n'est pas documentée et `abort` n'apparaît nulle part dans le code officiel : c'est un risque, pas une certitude. Il suffit qu'il soit possible.)* |
| 7 | `curl … &` puis `sleep 3`, sans `wait` ni `trap` | Le script se termine ~3 s plus tard alors que la transaction peut vivre 120 s de plus sur le terminal. Un Ctrl‑C envoie SIGHUP au `curl` de fond : la requête meurt, la transaction continue |
| 8 | Aucun `--connect-timeout` / `--max-time` sur les quatre appels | Une IP fausse ou un TPE éteint bloque sur le timeout TCP du système (~2 min par appel) ; `curl -s` rend le tout muet |
| 9 | Aucune étape de vérification finale | Le script ne relit **jamais** `/transactions` : après exécution, personne ne sait si le débit de 1,00 € est passé, ni si l'abort a fonctionné. Et la règle 5 du même document pose pourtant que seule une lecture de l'API transactions fait foi |
| 10 | `-H "Yavin-Secret: $YAVIN_API_KEY"` en ligne de commande | La clé est visible dans `ps -ef` pendant l'appel, et finit dans l'historique du shell si l'opérateur colle la valeur littérale — ce que l'absence de chargement du `.env` rend probable |

### Ce que couvre — et ne couvre pas — la sonde

Elle teste **cinq chemins sur onze**. Ne sont testés : aucun des quatre endpoints e‑commerce (`❓`, ligne 186), ni le détail de transaction (`❓`, ligne 58), ni le repli `GET` de l'abort local que Y‑04 prescrit pourtant de tester, ni la découverte NSD. L'étape 3 annonce en commentaire « vérifier le port d'impression (doc erronée à `:6125`) » et ne teste qu'un seul port : elle **présuppose** la conclusion de Y‑07 au lieu de la démontrer — même si cette conclusion est par ailleurs juste (`TransactionRepositoryImpl.kt:32`).

### Version corrigée

**Scinder en deux.**

**(a) Sonde de terrain — sans risque, exécutable à tout moment.** Ne conserver que l'étape 2, la seule en lecture, sans effet de bord et dont la cible est indépendamment vérifiée :

```bash
#!/usr/bin/env bash
set -euo pipefail
set -a; . ./.env; set +a
: "${IP_TPE:?IP_TPE manquant}"
curl -sS --connect-timeout 3 --max-time 10 -w '\n%{http_code}\n' \
  "http://$IP_TPE:16125/localapi/v4/ping?showMessage=true"
```

Ce `ping` avant chaque encaissement carte est aussi le moyen le moins cher de distinguer « terminal injoignable » (repli espèces immédiat) de « terminal joignable, transaction refusée ».

**(b) Procédure d'atelier — TPE de prêt uniquement, hors service.** Avec, en tête du § 9, un encadré : *« Cette procédure a des effets de bord monétaires irréversibles. Ne jamais l'exécuter sur un terminal en service. Prérequis : TPE de prêt (Y‑17) et plage horaire hors ouverture. »* Puis :

- `#!/usr/bin/env bash` + `set -euo pipefail` ; `set -a; . ./.env; set +a` ; `: "${YAVIN_API_KEY:?}" "${SN:?}" "${IP_TPE:?}"` ;
- UUID portable et **vérifié** : `UUID=$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid)` puis `: "${UUID:?UUID vide — abandon}"`. **Ne jamais émettre d'abort avec un UUID vide** ;
- découverte des chemins Cloud **sans POST métier** : sortir `payment/` et `abort` de la boucle, et privilégier `OPTIONS`/`HEAD` avec lecture de l'en‑tête `Allow` ; injecter `SN` dans le corps pour les endpoints de lecture ; tester **les deux formes** de barre finale ;
- table de codes exhaustive : `2xx` = existe **et a été accepté** (danger : effet de bord réel) · `400/422` = existe, corps invalide · `405` = existe, verbe faux · `401/403` = authentification, **ne dit rien du chemin** · `404` = **ambigu** (chemin faux **ou** ressource métier introuvable, cf. § 1 du document) · `3xx` = normalisation d'URL, corriger le chemin, **ne pas suivre** (`followRedirects: false`) · `000` = pas de réponse réseau ;
- afficher le **corps** de la réponse, pas seulement le code — c'est ce qui lève l'ambiguïté du 404 ;
- montant de test : `amount:1` (1 centime), avec `cartId:"SONDE-<horodatage>"`, `reference:"SONDE"` et `transactionType:"Debit"` explicite ;
- pour tester l'abort **dans le respect de la doc**, forcer un écran amont (`reference` ou `prepayScreen`) et poser l'abort **pendant** cet écran, jamais après ;
- timeouts curl : `--connect-timeout 3` partout, `--max-time 10` sur ping/print/découverte, `--max-time 130` sur le paiement ; PID capturé (`pid=$!`), `trap 'kill $pid 2>/dev/null' INT TERM EXIT`, `wait $pid` ;
- **étape finale obligatoire** : `POST /localapi/v4/transactions` sur une fenêtre fermée encadrant la sonde, filtrage local sur le `cartId` de sonde, affichage du `status`, du `transactionId` et de l'`amount`. C'est la seule sortie qui fasse foi ;
- clé API hors `argv` (fichier de configuration curl en `chmod 600`), `.env` dans `.gitignore`, clé de sonde révoquée après l'audit ;
- toutes les sorties journalisées dans un fichier horodaté : une sonde d'audit sans trace écrite ne prouve rien.

---

## 6. Le document confronté à notre architecture

### 6.1 Le § 10 — ce qui est bon, ce qui ne s'applique pas

**Quatre règles sont justes et déjà nos règles maison.** La règle 1 (« le TPE n'est pas la caisse ») trace exactement la bonne frontière : le ticket de caisse reste émis, numéroté et journalisé par nous, et son point d'ancrage existe déjà (`apps/api/src/modules/ordering/ticket.service.ts:216‑222`, « la ligne que le gérant recoupe le soir avec son tiroir et son TPE »). La règle 4 (centimes entiers, aucun flottant) est la doctrine explicite du domaine (`packages/domain/src/shared/money.ts:4‑16`) et le code officiel Yavin la respecte (`PaymentRequestV4.kt:12‑13`). La règle 6 (journaliser le brut) comble un trou réel du dépôt. Le principe « le domaine n'importe jamais `yavin/*` » est celui que le compilateur fait déjà respecter (`packages/domain/src/ports/index.ts` : `export type *`, « la flèche des dépendances hexagonales rendue vérifiable par le compilateur »).

**Le découpage de fichiers, en revanche, n'est pas applicable.**

| Ce que propose le § 10 | Réalité du dépôt | Adresse correcte |
|---|---|---|
| `src/payments/` | **Aucun `src/` à la racine** : monorepo pnpm `apps/{api,kds,pos,web}` + `packages/{client-core,contracts,db,domain,supply}` | — |
| `ports.ts` (interface `PaymentTerminal`) | Les ports vivent dans `packages/domain/src/ports/`, exportés en `export type *`, avec un jeton d'injection dans `apps/api/src/infrastructure/tokens.ts` — le § 10 oublie le jeton, sans lequel Nest ne sait pas injecter une interface | `packages/domain/src/ports/payment-terminal.ts` + `PAYMENT_TERMINAL` dans `tokens.ts` |
| `types.ts # types issus de ce document` | Tout ce qui traverse une frontière réseau est décrit en zod dans `packages/contracts` et importé des deux côtés | `packages/contracts/src/paiement-terminal.ts` |
| `client.local.ts`, `client.cloud.ts`, `reconcile.ts` dans un seul dossier | Ces trois fichiers doivent vivre dans **deux processus différents** : le client LAN ne peut tourner que sur la tablette Expo, le webhook que dans l'API NestJS (seule à avoir une adresse publique et `rawBody: true`, `apps/api/src/main.ts:20`) | LAN → `packages/client-core/` ; Cloud + webhook → `apps/api/src/infrastructure/payments/yavin/` |
| `client.ecommerce.ts` | Prescrit d'implémenter quatre endpoints que le document marque `❓`, contre sa propre consigne d'en‑tête | À retirer (Stripe conservé) |

**Interface `PaymentTerminal` incomplète.** Le § 10 énumère `pay`, `refund`, `abort`, `printReceipt`, `shareReceipt`, `listTransactions` — il manque la seule méthode qui compte après une coupure : `getByMerchantKey(cartId | idempotentUuid)`. Or `TransactionsRequestV4.kt:5‑17` montre qu'aucune primitive de ce type n'est documentée (cf. E5).

**Machine à états incompatible avec le modèle stocké.** La règle 5 propose `INITIE → EN_COURS → (PAYE | ECHOUE | ABANDONNE | EXPIRE)`. Notre modèle ne connaît que `pending | paid | refunded` (`packages/db/src/schemas.ts:515`). Trois incompatibilités : pas d'état **REMBOURSÉ** dans la machine proposée alors que `refunded` existe chez nous ; pas d'état **INDÉTERMINÉ**, qui est pourtant l'issue exacte des trois pannes que le document redoute ; et surtout, `payment` est un sous‑document **unique** (`schemas.ts:506‑532`) : deux tentatives (refus puis succès) s'écrasent l'une l'autre. La vraie question d'architecture — une **collection de transactions** rattachée à la commande, plutôt qu'un enrichissement d'`order.payment` — n'est jamais posée.

**Règle 7 (piste d'audit) fausse dans les deux sens.** Elle demande `serialNumber` et `createdAt`, que la réponse locale **ne renvoie pas** (`LocalPaymentResponse.kt` : ni l'un ni l'autre) ; et elle **omet** `cartId`, `reference`, `medium`, `idempotentUuid` et les deux tickets CB. Sans `medium` persisté, un titre‑restaurant encaissé sur le TPE s'enregistre comme une carte : les lignes « Carte bancaire » et « Titres‑restaurant » du Z (`apps/pos/src/pos-state.ts:237‑264`) deviennent fausses tous les midis.

**Règle 10 inapplicable.** « Ne jamais annuler pendant la lecture de carte » interdit une action à un instant que la caisse **ne peut pas observer** : en mode local, l'unique canal est une requête HTTP restée ouverte ; rien n'indique la phase du terminal, et aucun `abort` n'est démontré dans le code officiel. Soit on n'expose jamais d'annulation (le caissier reste bloqué), soit on l'expose à l'aveugle.

**Règle manquante — la plus importante.** Le § 10 ne dit **rien** de la file de synchronisation offline, qui est l'invariant n° 1 du produit. `client.post` persiste puis rejoue jusqu'au succès (`packages/client-core/src/sync-queue.ts:130‑150`, `:170‑195`), sans âge maximal ni plafond d'essais (`createdAt` et `attempts` écrits, jamais relus). Un ordre de paiement branché sur ce chemin — le chemin naturel, puisque tout le reste du POS l'emprunte — serait présenté au terminal une seconde fois, des heures plus tard. Le contre‑exemple à copier existe déjà dans le dépôt : la remise passe par `client.direct`, hors file (`apps/pos/src/PosScreen.tsx:414‑421`).

### 6.2 Le § 11 — une demi‑checklist

Les treize items testent correctement le **fournisseur**. Aucun ne teste **notre** caisse.

**Ne sont pas testés, et devraient l'être :**

- caisse **hors ligne** + TPE joignable — le mode nominal annoncé du produit ;
- rejeu d'une commande **déjà encaissée** refusé en 4xx : aujourd'hui l'entrée est supprimée de la file (`sync-queue.ts:179‑184`) et il ne reste qu'un `lastError` écrasé au tour suivant. Argent pris, vente disparue ;
- rechargement ou verrouillage de la tablette pendant la transaction : rien de l'état du ticket n'y survit (`PosScreen.tsx:302‑317`) ;
- double appui sur « Carte » : le seul garde‑fou est `busy`, qui ne dure que le temps d'écrire dans la file (`apps/pos/src/TicketPanel.tsx:66`) — quelques millisecondes, contre 5 à 30 s de transaction ;
- second chemin d'encaissement via la barre compacte `TicketDock` (`TicketPanel.tsx:486‑503`) ;
- clôture de service avec des entrées encore en file : `closeService` vide le journal **sans condition** (`PosScreen.tsx:456‑465`), l'avertissement de la modale n'est pas bloquant ;
- désappairage d'une tablette portant des encaissements non remontés : `forgetPairedDevice` appelle `client.queue.clear()` (`apps/pos/src/client.ts:300‑311`) ;
- refus banque → retour au ticket **intact** : `resetTicket` est aujourd'hui inconditionnel ;
- neutralisation complète en mode démonstration (`?demo=1`, `apps/pos/src/client.ts:326‑332`) ;
- **rapprochement chiffré** de fin de service : total carte de la caisse = total du lot terminal, écart affiché et imputé (pourboires isolés, transactions annulées, transactions hors caisse). C'est le seul contrôle qui prouve que l'intégration sert à quelque chose ;
- l'item « Remboursement → rapprochement avec la vente d'origine » est **intestable** : il n'existe ni bouton, ni route staff, ni écriture de `refunded` hors du webhook Stripe. `order.refund` est un libellé déclaré (`packages/contracts/src/ordering.ts:400`) que rien n'écrit, et `cancel` laisse `payment.status = 'paid'` (`apps/api/src/modules/orders/orders.service.ts:254‑271`).

**Aucun item de conformité.** C'est un reproche de périmètre à moitié seulement : les chantiers NF525 sont les nôtres, pas ceux du document. Mais brancher un TPE est précisément ce qui fait franchir le seuil déclaré bloquant (`ARCHITECTURE.md:219`, `docs/specs/contraintes-business.md:264‑276`). Il faut donc une section **§ 11 bis — recette de conformité**, distincte, chez nous.

---

## 7. Ce qu'il faut faire du document

**Verdict d'usage : le garder, le corriger, et le scinder en deux.**

Le garder, parce que c'est le seul travail de synthèse disponible et que son socle technique tient. Le corriger, parce qu'en l'état il autorise à générer du code faux. Le scinder, parce qu'il mélange deux choses de nature différente : une **référence d'API fournisseur** (§ 1 à § 7, § 9), qui décrit Yavin, et un **contrat d'implémentation Snack Manager** (§ 8, § 10, § 11), qui décrit ce que nous en faisons. Le second doit vivre dans `docs/specs/` avec le reste de nos décisions produit, être versionné par nos ADR, et ne pas être réécrit à chaque mise à jour de la doc Yavin.

**En attendant la correction, poser en tête du fichier :** *« Document de travail. Aucune ligne de code d'intégration ne doit en être dérivée avant traitement des points 1 à 6 ci‑dessous. La sonde du § 9 ne doit pas être exécutée. »*

### Corrections à apporter à `/home/user/snack-manager/docs/yavin/YAVIN-API-REFERENCE.md`, par ordre

1. **Refondre la légende de confiance (ligne 11)** — elle conditionne la lecture de tout le reste. `✅` = « lu dans la doc EN, non testé » · `⚠️` = « inféré, à tester » · `❓` = « inconnu » · nouveau `🧪` = « vérifié contre un TPE ou contre le code officiel Yavin ». Descendre tous les marqueurs au niveau de la **ligne** : retirer les `✅` de section des § 3, § 4, § 5 et § 6. Tant qu'aucun `🧪` n'existe, retirer de l'en‑tête la consigne qui fait de `✅` une autorisation de générer du code.
2. **Neutraliser le § 9** — le remplacer par les deux blocs décrits en § 5 ci‑dessus, avec l'encadré d'avertissement en tête.
3. **Corriger les trois exemples copiables** : la réponse locale du § 3 (ajouter `cartId`, `reference`, `receiptTicket` ; marquer `message` en `❓`), l'exemple Kotlin du § 4 (`PaymentRequestV4`, avec `cartId` et `idempotentUuid`), l'exemple curl du § 2.1 (retirer ou marquer `acceptedPayment`, corriger la casse de `transactionType`).
4. **Réécrire la règle 5 du § 10** : le webhook est un signal, jamais une preuve ; toute transition vers `PAYE` passe par une lecture serveur→Yavin, en écriture atomique conditionnée sur l'état attendu **et** sur l'identité du terminal.
5. **Ajouter la règle 11 au § 10** : l'ordre de paiement ne transite jamais par la file de synchronisation ; il est joué en appel direct bloquant, sur le modèle de `client.direct`.
6. **Ajouter le registre des deux clés** (§ 3 et règle 2) : `cartId` = identité du ticket, immuable ; `idempotentUuid` = identité d'une tentative, régénérée après échec, persistée avant l'appel ; ne jamais dériver l'un de l'autre.
7. **Réécrire la ligne 43** en deux registres : transport HTTP d'un côté, issue métier (`status`) de l'autre ; un 200 avec `status:"ko"` est un refus.
8. **Corriger la règle 7** : ajouter `cartId`, `reference`, `medium`, `idempotentUuid` et les deux tickets CB ; retirer `serialNumber` et `createdAt` du chemin local (absents de la réponse) ; remplacer `device_datetime` par `device_timestamp` comme horodatage de référence.
9. **Ajouter l'état INDÉTERMINÉ** à la machine de la règle 5, plus la règle « un état terminal ne s'écrase jamais ».
10. **Corriger Y‑02** (le remboursement est une pièce nouvelle avec son propre `cartId`), **Y‑03** (ajouter la divergence de casse des valeurs), **Y‑09** (reclasser en `❓` : le champ est absent de tout le code officiel), **Y‑10** (viser `clientCardTicket`/`merchantCardTicket` vs `client_ticket`/`company_ticket`), **Y‑14** (reclasser en bloquant, ajouter le sens entrant et le déni de service par abort).
11. **Compléter les tableaux de paramètres** : `currencyCode`, `prepayScreen`, `idempotentUuid` ; typer `receiptTicketJson` en `String ⚠️`.
12. **Remplacer « réconciliation triviale » (§ 0, ligne 20)** par la formulation de E12, et ajouter au § 0 une ligne « Contrainte côté caisse » : le choix du mode Yavin est d'abord une décision sur la **cible de build** de `apps/pos`.
13. **Ajouter au § 3** un encart de prérequis : contenu mixte HTTPS→HTTP, absence d'API mDNS en navigateur, `usesCleartextTraffic` / `networkSecurityConfig` en build Android, CORS du serveur local `❓`. Et développer la découverte NSD (type `_http._tcp.`, filtrage par préfixe de nom, **port lu dans le service résolu — ne jamais présumer 16125**, aucun numéro de série dans l'annonce), en signalant qu'elle est **incompatible** avec l'isolation VLAN recommandée en Y‑14.
14. **Réordonner le § 7 par gravité pour le restaurateur** : Y‑11, Y‑12, Y‑08, Y‑14 et l'absence de geste d'annulation en rang 1 ; Y‑01, Y‑03, Y‑05, Y‑13, Y‑15 en rang 2 ; Y‑06, Y‑07, Y‑10 en rang 3. Ajouter à chaque constat une ligne « qui perd de l'argent, et quand ».
15. **Reclasser Y‑05** : bloquant uniquement pour le chemin itemisé (`items[]`, `receiptTicketJson`), sans objet pour l'intégration comptoir v1 — et noter que le vrai préalable est **chez nous** (aucun taux de TVA n'existe dans le modèle produit).
16. **Ajouter une mention de méthode** en tête du § 7 : « les affirmations ont été confrontées à la doc EN, non au code officiel Yavin ». Et joindre au dépôt un export de la doc EN (PDF/Markdown), pour que la source devienne relisible et « diffable » — le document demande déjà ce geste pour le lien Notion (ligne 9).

---

## 8. Questions à poser à Yavin, par ordre de blocage

| # | Question | Pourquoi elle bloque | Qui répond |
|---|---|---|---|
| 1 | Le contrat monétique est‑il signé entre le **restaurateur** et Yavin (ou son acquéreur), sans intervention de l'éditeur ? Les fonds sont‑ils versés **directement sur l'IBAN du restaurateur** ? Le programme ISV implique‑t‑il une rétrocession **prélevée sur les fonds encaissés**, ou une facturation hors flux ? | Seule question capable de tuer le projet. Encaisser pour le compte d'autrui est un service de paiement réservé aux établissements agréés ; notre encaissement en ligne a été bâti pour l'éviter, et c'est verrouillé par test. Une rétrocession assise sur le CA de nos clients heurte frontalement « 0 % commission » | Commercial / juridique Yavin |
| 2 | L'API locale `:16125` (ping, payment, abort, transactions) répond‑elle **intégralement quand le TPE n'a aucun accès à `api.yavin.com`** ? La session My Yavin qui l'autorise a‑t‑elle une durée de validité au‑delà de laquelle le terminal refuse les appels locaux ? | Le § 0 recommande l'API locale pour le comptoir sans jamais vérifier cette propriété. « Offline d'abord » est une règle de gouvernance à droit de veto. Si la réponse est non, le mode recommandé est le mauvais | Technique |
| 3 | Le webhook est‑il **signé** ? Algorithme, secret, tolérance d'horodatage. Sinon, quel endpoint exact permet de **revérifier** un événement, et est‑il disponible aujourd'hui ? Plage d'IP source stable ? Politique de rejeu et code de réponse attendu pour l'arrêter ? | La parade de Y‑11 repose sur un endpoint que le document marque `❓`. Sans réponse, le mode Cloud n'est pas intégrable : la règle 5 telle qu'écrite ouvre une route publique qui solde des commandes | Technique |
| 4 | `/transactions` accepte‑t‑il un filtre par **`cartId`, `reference` ou `idempotentUuid`** ? Existe‑t‑il un `GET` de détail par transaction, et est‑il adressable par `cartId` ? | Toute la stratégie de réconciliation (Y‑11, Y‑12, règle 5) en dépend. `TransactionsRequestV4` ne connaît que des bornes de dates : sans filtre par clé, répondre à « ce ticket a‑t‑il été payé ? » demande de paginer une journée pendant qu'un client attend | Technique |
| 5 | Si le client HTTP ferme la connexion avant la fin (timeout, crash, rechargement), la transaction est‑elle **annulée** sur le terminal, ou **menée à son terme** ? Dans ce second cas, par quel appel récupère‑t‑on son issue ? Un second appel portant le **même `idempotentUuid` pendant** que la première transaction est en cours démarre‑t‑il une seconde transaction, attend‑il, ou renvoie‑t‑il « en cours » ? Après une coupure secteur, le terminal restitue‑t‑il l'issue au redémarrage, et l'`idempotentUuid` est‑il persisté sur disque ? | C'est le scénario « argent pris, caisse qui ne le sait pas ». Trois mondes incompatibles restent ouverts et le geste du caissier diffère dans les trois. Notre file supprime définitivement une entrée refusée en 4xx | Technique |
| 6 | Que renvoie le terminal si une **transaction est déjà en cours** (code HTTP, corps) ? Un même terminal peut‑il être adressé simultanément par deux caisses ? Un `abort` ciblé par `idempotentUuid` peut‑il toucher la transaction d'une autre caisse ? Que contient exactement la réponse du **`ping`**, et existe‑t‑il un appel pour savoir qu'une transaction est en cours **sans** passer par l'abort sans UUID ? | Comptoir à deux postes = cas normal. Le seul geste de reprise laissé par le document est le geste destructeur | Technique |
| 7 | **Fenêtre exacte de rétention de l'`idempotentUuid`** (le document affirme 24 h, non vérifiable), et **comportement hors fenêtre** : rejet explicite « clé expirée » ou nouveau débit silencieux ? Cette mémoire survit‑elle au redémarrage du terminal ? Est‑elle partagée entre les terminaux d'un même compte ? | Décide de la conception de la reprise. Notre file n'a ni âge maximal ni plafond d'essais : un rejeu à J+2 sort de la fenêtre et redevient un débit neuf | Technique |
| 8 | Jusqu'à quel moment un **`reversal`** est‑il accepté sur une transaction du jour ? La télécollecte (`closingbatch`) est‑elle automatique, à quelle heure, et est‑ce paramétrable ? Existe‑t‑il un objet **remise** interrogeable (numéro, date de coupure, totaux par schéma, nombre de transactions) ? Une transaction porte‑t‑elle l'identifiant de la remise qui l'a emportée ? | Le geste le plus fréquent au comptoir (annuler une erreur de montant) est indécidable. Et sans données de remise, le Z ne se recoupe avec rien — c'est pourtant la promesse de l'intégration | Technique |
| 9 | Liste **close** des valeurs de `status` et des motifs de refus sur l'API locale. Comment distinguer refus banque / expiration / abandon porteur / terminal occupé ? Existe‑t‑il un code d'erreur distinct de `message` ? Comment sommes‑nous notifiés d'une **opposition ou d'un impayé**, sous quel délai devons‑nous répondre, quelles pièces exigez‑vous, et existe‑t‑il une API des litiges ? | La conduite au comptoir diffère radicalement selon le cas. Et la pièce à produire en cas de contestation (`merchantCardTicket`) n'est pas dans les champs que le document ordonne de conserver | Technique / support |
| 10 | **Quotas** (requêtes/minute, par clé / terminal / société, partagés entre marchands d'un intégrateur ?) et réponse au dépassement. **Tailles maximales** de `receiptTicket.data`, `receiptTicketJson` et du corps complet, par mode, et comportement au dépassement (erreur explicite ou troncature silencieuse). Contraintes de forme de `cartId` et `reference` (longueur max, jeu de caractères, casse significative, valeur renvoyée à l'identique). **Horodatage** : quel champ de la réponse de paiement Local/Android porte la date du terminal — et s'il n'y en a aucun, faut‑il relire `/transactions` pour dater chaque encaissement ? | Le document prescrit un polling périodique sur une API dont il ignore les quotas ; notre ticket ESC/POS fait plusieurs kilo‑octets ; notre clé naturelle est un UUID de 36 caractères ; et la règle 7 exige un horodatage que la réponse locale ne renvoie pas | Technique |
| 11 | Le terminal est‑il listé **P2PE** ? Attestation de conformité **PCI‑DSS**, et **SAQ applicable** au commerçant et à l'intégrateur en intégration semi‑intégrée par API locale. Que contient exactement **`cardToken`** : stable pour une même carte d'une transaction à l'autre ? d'un commerçant à l'autre ? réversible vers le PAN ? Le PAN masqué est‑il disponible séparément ? | L'API locale circule en HTTP clair et transporte le jeton et les tickets CB. Le § 10 ordonne de conserver `cardToken` sans savoir ce qu'il contient ; s'il est stable par carte, on constitue un fichier de porteurs sans base légale, dupliqué chaque nuit en clair | Sécurité / conformité |
| 12 | Fournissez‑vous un **DPA** (art. 28) ? Où sont hébergées les données de transaction et les coordonnées client, quels sont vos **sous‑traitants ultérieurs**, combien de temps conservez‑vous ces données ? Le consentement à l'envoi du ticket par SMS/e‑mail est‑il recueilli par le terminal ou reste‑t‑il à notre charge ? Quelle est la **profondeur maximale** d'historique consultable via `/transactions`, et existe‑t‑il un export exhaustif par exercice ? | Le document fait transiter des données personnelles vers le terminal et le cloud, et la règle 6 les fait entrer en base puis dans nos sauvegardes. Nos CGA n'énumèrent pas Yavin comme sous‑traitant et le DPA est encore à rédiger. Et une API bornée à quelques mois n'est pas une archive fiscale | Juridique / DPO |
| 13 | Quel est l'**engagement de support de l'API v4** (date de fin annoncée, préavis avant changement cassant), et existe‑t‑il un journal des changements versionné auquel s'abonner ? Les **mises à jour de l'app Yavin Pay** sur nos terminaux sont‑elles pilotables (fenêtre de maintenance, report, épinglage de version) ou poussées unilatéralement ? Quelle version minimale garantit `idempotentUuid`, `acceptedPayment` et `prepayScreen` ? | Le code officiel prouve qu'un saut de version brutal a déjà eu lieu (v1 et v4 cohabitent avec des transports et des types incompatibles). Une régression poussée un vendredi 19 h sur un contrat local non authentifié casse l'encaissement sans qu'aucune de nos procédures ne s'applique | Technique / contractuel |
| 14 | Existe‑t‑il un **événement ou un code d'erreur distinct** signalant une clé révoquée ou un contrat marchand résilié, discernable d'une clé mal configurée ? Dans quels cas Yavin peut‑il couper l'accès unilatéralement, avec quel préavis ? Après résiliation, le commerçant conserve‑t‑il un **accès en lecture** à son historique, pendant combien de temps, sous quel format exportable — et un remboursement d'une transaction antérieure reste‑t‑il possible ? | Le § 1 range « clé invalide » et « terminal inaccessible » sous le même 401 : la caisse ne saura pas distinguer une erreur de configuration d'un contrat résilié, et bloquera le comptoir au lieu de basculer proprement en mode déclaratif. « Sans engagement veut dire sans otage » est un engagement contractuel de notre côté | Contractuel |
| 15 | Par quel canal, à quels horaires et avec quel **délai de première réponse** ouvre‑t‑on un incident bloquant en plein service ? Quel identifiant exigez‑vous pour retrouver une transaction ? Existe‑t‑il une **page d'état publique** et un historique d'incidents ? Quel **taux de disponibilité** vous engagez‑vous à tenir, et les fenêtres de maintenance évitent‑elles les heures de service ? Accès **sandbox** et **TPE de prêt** (Y‑17) ? | Notre engagement écrit au gérant est « réponse en moins de 5 minutes » sur un incident de service. Et sans sandbox ni TPE de prêt, la recette des cas limites (§ 11) ne peut se faire qu'en production, un service ouvert, sur l'argent d'un client | Support / commercial |
| 16 | **Format exact de `tax.rate`** pour une TVA à 5,5 % : points de base (550), dixièmes (55), tronqué à 5 ? Le champ de restriction de médium (`acceptedPayment` / `acceptedPaymentType`) est‑il supporté par l'Intent v4 — il est **absent de `PaymentRequestV4`** dans l'app de démonstration officielle ? Valeurs acceptées par **`prepayScreen`** et moyen de supprimer les écrans amont ? | Y‑05 reste juste mais ne bloque que le chemin itemisé, et le vrai préalable est chez nous (aucun taux de TVA dans notre modèle produit). En revanche `acceptedPayment` conditionne tout le scénario titres‑restaurant du § 11, et `prepayScreen` conditionne le critère de sortie « encaissement < 45 s » | Technique |
