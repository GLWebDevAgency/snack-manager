# Yavin — Référence API + audit (intégration caisse « snack manager »)

> **Fichier de contexte pour Claude Code.** À placer dans `docs/yavin/YAVIN-API-REFERENCE.md`
> et à référencer depuis `CLAUDE.md` : « Pour toute intégration paiement, lire d'abord
> `docs/yavin/YAVIN-API-REFERENCE.md`. Ne jamais inventer un endpoint marqué ❓. »

- **Audit réalisé le** : 2026-08-29
- **Sources** : `https://api.yavin.com/docs/en` (**référence — la plus à jour**), `https://api.yavin.com/docs/fr` (traduction, **en retard**), `https://github.com/YavinAPI` (exemples).
- **Non lu** : le lien Notion `yavin.notion.site/yavin-api-documentation` (page rendue en JS, illisible par fetch). Si elle contient des specs spécifiques « Yavin Platform / partenaire », exporter en Markdown/PDF et diffuser ce fichier.

**Légende de confiance** — `✅` documenté et vérifié · `⚠️` inféré par cohérence, à tester · `❓` inconnu, à demander à Yavin.

---

## 0. TL;DR — décisions d'intégration

| Question | Réponse retenue |
|---|---|
| Doc de référence | **Version EN uniquement.** La FR est une version antérieure (voir Y-01). |
| Mode pour caisse tablette/comptoir | **API Local** (`:16125`), synchrone, réconciliation triviale. |
| Mode pour caisse web/SaaS multi-sites | **API Cloud** + webhook, avec **polling de secours obligatoire** (Y-12). |
| Mode pour caisse embarquée sur le TPE | **Android Intent** (APK à faire valider par le constructeur). |
| Paiement à distance / click & collect | **API E-commerce** (payment links). |
| Clé de rapprochement caisse ↔ paiement | `cartId` (obligatoire côté snack manager) + `reference` = n° de ticket. |
| Idempotence | `idempotentUuid` systématique en Local/Android. En Cloud : ❓ (Y-08). |

---

## 1. Les trois modes d'intégration TPE ✅

| | API Cloud | API Local | Android Intent |
|---|---|---|---|
| Transport | HTTPS vers `api.yavin.com` | HTTP LAN vers le TPE | Intent Android `yavin://` |
| Réponse | **Asynchrone** (webhook vers IP publique) | **Synchrone** (requête ouverte jusqu'à 5 min) | Synchrone (`onActivityResult`) |
| Réseau TPE | 3G/4G ou WiFi | LAN + **IP fixe** ou NSD/Bonjour | — (embarqué) |
| Cas d'usage | Caisse SaaS web | Caisse locale sans websocket | Food truck, prise de commande à table |
| Contrainte | IP publique joignable | Réseau stable, IP fixe | APK validé par le constructeur |

**Authentification**
- Cloud & E-commerce : header `Yavin-Secret: <API_KEY>` (clé dans My Yavin → onglet API). ✅
- Local & Android : pas de clé — le **commerçant doit être connecté dans l'app Yavin Pay** avec ses identifiants My Yavin. ✅ ⇒ conséquence : **l'API locale n'est pas authentifiée sur le LAN** (voir Y-14).

**Codes d'erreur HTTP** ✅ : `400` requête invalide · `401` clé invalide / terminal inaccessible avec cette clé · `404` · `405` · `500`.

---

## 2. API Cloud

Base : `https://api.yavin.com/api/v4/pos/`

| Action | Méthode + chemin | Confiance |
|---|---|---|
| Paiement | `POST https://api.yavin.com/api/v4/pos/payment/` | ✅ |
| Partage de ticket | `POST https://api.yavin.com/api/v4/pos/share-receipt` | ✅ |
| Impression | `POST .../api/v4/pos/print` | ⚠️ |
| Liste transactions | `POST .../api/v4/pos/transactions` | ⚠️ |
| Abandon | `POST .../api/v4/pos/abort` | ⚠️ |
| Détail d'une transaction | `GET` + param `transactionId` — chemin exact | ❓ |

> Avant le premier dev, exécuter la sonde du §9 pour figer les chemins ⚠️/❓.

### 2.1 Paiement — `POST /api/v4/pos/payment/`

```bash
curl -XPOST "https://api.yavin.com/api/v4/pos/payment/" \
  --header 'Yavin-Secret: YAVIN_API_KEY' \
  --header 'Content-Type: application/json' \
  --data '{
    "serialNumber": "123456789",
    "amount": 1000,
    "transactionType": "debit",
    "cartId": "TICKET-2026-000123",
    "reference": "T123",
    "vendor": { "softwareName": "snack manager", "softwareVersion": "1.0.0" },
    "customer": { "firstName": "John", "lastName": "Doe", "email": "john@exemple.fr" },
    "acceptedPayment": { "acceptedMediumType": "all" },
    "receiptTicket": { "data": "...ticket...", "format": "text" }
  }'
```

| Param | Type | Défaut | Notes |
|---|---|---|---|
| `serialNumber` | String | **obligatoire** | S/N au dos du TPE |
| `amount` | Integer | **obligatoire** | centimes, **hors pourboire**, **toujours positif** même pour `reversal`/`refund` |
| `giftAmount` | Integer | `0` | pourboire en centimes |
| `medium` | String | `card` | `card, qrcode, 2x, 3x, 4x, ancv, wechat, alipay, lydia, restoflash…` (liste non close ❓) |
| `transactionType` | String | `debit` | `debit, reversal, refund, preauthorisation, closingbatch` |
| `acceptedPayment.acceptedMediumType` | String | `all` | `all` \| `lunch_vouchers_only` \| `bank_cards_only` — **absent de la doc FR** |
| `customer` | Customer | — | pré-remplissage envoi ticket SMS/email |
| `vendor` | Vendor | — | `softwareName` / `softwareVersion` — à renseigner **toujours** (support Yavin) |
| `reference` | String | — | champ libre visible dans My Yavin |
| `cartId` | String | — | clé de rapprochement ticket ↔ paiement |
| `receiptTicket` | ReceiptTicket | — | imprime le ticket de caisse **avec** le ticket CB |
| `receiptTicketJson` | Objet Ecommerce | — | même structure que l'API e-commerce (items, TVA…) |

**Réponse immédiate = simple accusé de réception :**
```json
{ "status": "ok", "transactionId": "nvfkkFGFXr4Ew" }
```
Le **résultat réel arrive par webhook** (snake_case) :
```json
{ "status":"ok", "trs_id":"nvfkkFGFXr4Ew", "app_version":"5.0.1",
  "asked_amount":100, "gift_amount":0, "total_amount":100,
  "card_token":"F12345678", "cartId":"2", "currencyCode":"EUR",
  "client_ticket":"…", "company_ticket":"…",
  "receiptTicket":{ "data":"…", "format":"text" },
  "device_datetime":"2022-09-26T11:11:29.148", "device_timestamp":1664183489148,
  "medium":"card", "reference":"YOUR-REF-01", "serial_number":"bf075053ef08078a",
  "server_timestamp":1664183496498, "type":"Debit", "vendor":{ "apiVersion":"v1" } }
```

**Timeout** ✅ : 120 s au total à partir de la réception de la requête — 60 s pour les écrans optionnels (pourboire, référence…) puis 60 s pour la lecture carte. Dépassement pendant les 60 premières secondes ⇒ transaction avortée.

**❗ L'URL du webhook n'est pas un paramètre de la requête** ⇒ elle est configurée dans My Yavin, donc **globale au compte**, pas par transaction. ⚠️ À valider : comment router les webhooks en multi-tenant (voir Y-11).

### 2.2 Autres endpoints Cloud

- **Impression** : `serialNumber` + `format` (`text`|`escpos`) + `data`. Réponse `{"status":"ok"}`.
- **Partage de ticket** : `serialNumber`, `receiptTicket`, `transactionId` (**celui reçu de l'API paiement**), `medium` (`yavin`|`sms`|`email`|`print`), `customer`.
- **Transactions** : `serialNumbers[]`, `timezone` (**à toujours renseigner**), `startDate`, `endDate` (**exclusive**), `startTime`, `endTime`, `limit` (défaut 20, **max 200**), `offset`. Sans filtre ⇒ 30 derniers jours.
- **Abandon** : `serialNumber` + `idempotentUuid` (optionnel mais recommandé ; sans lui, **toute** transaction en cours est annulée de force). ⚠️ Ne jamais appeler pendant la lecture de la carte : risque d'incohérence de données.

---

## 3. API Local (LAN) ✅

Base : `http://<IP_TPE>:16125/localapi/v4/` — port **16125** (P=16, A=1, Y=25). Découverte possible via **Network Service Discovery / Bonjour**.

| Action | Appel |
|---|---|
| Ping | `GET /localapi/v4/ping[?showMessage=true]` |
| Paiement simple | `GET /localapi/v4/payment/<MONTANT_CENTIMES>` |
| Paiement complet | `POST /localapi/v4/payment` (JSON) |
| Impression | `POST /localapi/v4/print` |
| Partage ticket | `POST /localapi/v4/share-receipt` |
| Transactions | `POST /localapi/v4/transactions` |
| Abandon | `POST /localapi/v4/abort` (⚠️ la doc mentionne aussi `GET`, voir Y-04) |

Corps de paiement identique au Cloud **sans `serialNumber`**, **plus `idempotentUuid`** :

> `idempotentUuid` : si le TPE connaît déjà cet UUID dans les **24 h**, il renvoie la transaction correspondante au lieu d'en créer une. ⚠️ **Piège** : si la transaction a échoué (`ko`), le même UUID renvoie l'échec en boucle — il faut **changer l'UUID pour retenter**.

**Réponse (synchrone, camelCase)** :
```json
{ "status":"ok", "transactionId":"xPUyi4fmdibD", "amount":1000, "giftAmount":0,
  "currencyCode":"EUR", "scheme":"CB", "issuer":"…", "transactionType":"Debit",
  "cardToken":"1234567890", "clientCardTicket":"…", "merchantCardTicket":"…",
  "appVersion":"3.2.8", "idempotentUuid":"…", "customer":{…}, "message":"(erreur éventuelle)" }
```

---

## 4. API Android Intent ✅

Package cible : `com.yavin.macewindu`. Schéma : `yavin://com.yavin.macewindu/v4/<action>?data=<json url-encodé>`.

| Action | URI |
|---|---|
| Paiement | `yavin://com.yavin.macewindu/v4/payment` |
| Impression | `…/v4/print` |
| Partage ticket | `…/v4/share-receipt` |
| Transactions | `…/v4/transactions` |
| Lecture NFC | `…/v4/nfc-reader` |

Réponse : `startActivityForResult` puis `data.extras.getString("response")` → JSON à désérialiser.

```kotlin
val request = TransactionRequest(
  amount = 100,
  customer = Customer("John", "Doe", "john@exemple.fr"),
  vendor = Vendor("snack manager", "1.0.0"),
  receiptTicket = ReceiptTicket(data = "…", format = "text")
)
val intent = Intent(Intent.ACTION_VIEW).apply {
  data = Uri.parse("yavin://com.yavin.macewindu/v4/payment?data=${Uri.encode(Gson().toJson(request))}")
}
startActivityForResult(intent, REQUEST_CODE_PAYMENT)
```

**NFC** : `NFCReaderRequestV4(timeout, readerIncentive)` — `timeout` en ms, défaut 90 000, **minimum 10 000**. Réponse `NFCReadResponse(status: Boolean, tagInfo: TagInfo(serialNumber))` — ⚠️ `status` est ici un **booléen**, contrairement à tout le reste de l'API (voir Y-06).

---

## 5. API E-commerce (payment links) ✅

Convention **snake_case** (camelCase encore toléré). Endpoints : `/generate_link/`, `/cancel_link/`, `/capture_transactions/`, `/cart_information/` ❓ *(noms d'action confirmés, chemins complets à confirmer)*.

### `generate_link` — champs

| Champ | Requis | Notes |
|---|---|---|
| `cart_id` | **oui** | unique par société ; si déjà pris → erreur `This cart_id already exists` + lien existant |
| `return_url_success` / `return_url_cancelled` | **oui** | rappelées en `GET` avec `?cartId=…&status=…` (**camelCase conservé ici**) |
| `amount` | **oui** | centimes, **hors** `gift_amount` |
| `order_number` | **oui** (EN) | n° de commande visible du client — **absent de la doc FR** (Y-01) |
| `gift_amount` | non | pourboire si collecté par votre plateforme |
| `is_instant_capture` | non | défaut `True` ; `False` ⇒ pré-autorisation, capture via `/capture_transactions/` |
| `capture_min_delay` | non | 0→72 h d'attente avant capture auto (si `is_instant_capture=False`) |
| `order_source` | non | `pay_at_table` \| `click_and_collect` \| `delivery` \| `ecommerce` |
| `webhook_url` | non | doit commencer par `http`/`https` |
| `amount_without_tax`, `tax_amount`, `message`, `datetime`, `currency`, `reference`, `client_reference` | non | |
| `vendor`, `customer`, `items`, `features` | non | objets, voir §6 |

**Réponses** : succès `201 { "payment_link": "…" }` · erreur `400 { "errors": { "cart_id": [...] } }`.

### Cycle de vie ✅ — **critique pour la restauration**
- Statuts panier : `pending` (attente) · `ok` (payé) · `authorised` (payé, transactions à capturer) · `ko` (annulé). **Pas de statut « échec »** : le client peut toujours réessayer.
- Lien **non utilisé** : actif **72 h max**, puis panier + lien annulés.
- Panier **partiellement payé** : **annulé systématiquement** par le script quotidien (**05:00 GMT**) pour libérer les fonds — surtout les titres-restaurant.
- Ce même script capture automatiquement les paniers `authorised` complets.

### Webhook e-commerce
Déclencheurs : `payment`, `capture`, `cancel` — champs `action` + `reason` (⚠️ absents de la doc FR).
```json
{ "action":"capture", "reason":"triggered by daily script", "cart_id":"12345",
  "payment_link":"…", "requested_amount":2000, "asked_amount":2500,
  "paid_amount":2500, "gift_amount":500, "status":"ok",
  "transactions":[ { "total_amount":2500, "gift_amount":500, "currency_code":"EUR",
    "date_of_payment":"2023-10-16", "gateway":"conecs", "issuer":"UP FRANCE",
    "transaction_id":"abcd123", "pan":"4575******1234", "status":"ok" } ] }
```
⚠️ Un panier peut contenir **plusieurs transactions** (paiement partiel en titres-restaurant + complément CB). Toujours itérer sur `transactions[]`, jamais supposer 1 = 1.

---

## 6. Objets communs ✅

```jsonc
// Customer (TPE, camelCase)          // Customer (e-commerce, snake_case)
{ "firstName","lastName","email",     { "first_name"*, "last_name"*, "email",
  "phone" /* +33612345678 */ }          "telephone","address","city","postcode" }

// ReceiptTicket : { "format": "text" | "escpos", "data": "texte ou hex ESCPOS (1b401d6210…)" }
// Vendor (TPE)  : { "softwareName", "softwareVersion" }
// Vendor (ecom) : { "brand_name"*, "legal_name", "country", "merchant_id",
//                   "merchant_category_code", "software_name", "software_version", "store" }
// Store         : { "store_id"*, "address": { "address"*, "postcode"*, "city"* } }
// Item          : { "name"*, "total_amount"*, "total_amount_without_tax", "category",
//                   "eligible_titre_restaurant", "free_note", "quantity",
//                   "unit_price", "unit_price_without_tax", "tax", "items"[] /* imbriqués */ }
// Tax           : { "amount"*, "rate"* }   // ⚠️ rate = Integer → voir Y-05
// Features      : { "tips": true, "customer_contacts": true, "meal_vouchers": true,
//                   "share_link": { "method": "email"|"sms", "destination": "…" } }
```
`*` = requis. **ESCPOS** supporté en Android / JS / Python (exemples sur le GitHub Yavin).

---

## 7. AUDIT — anomalies, incohérences et pièges

### Bloquants / structurants

**Y-01 — La doc FR est une version antérieure de la doc EN.**
Manquants côté FR : `acceptedPayment` / `acceptedMediumType`, le **timeout 120 s**, le statut `authorised`, `order_source`, `order_number` (**pourtant requis en EN**), `capture_min_delay`, `action`/`reason` dans le webhook, l'endpoint de détail de transaction, toute la section « Key Information » (durée de vie 72 h, script 05:00 GMT), et le `share_link` dans `features` (la FR expose à la place `share_by_email`/`share_by_sms`).
➜ **Ne travailler que sur la version EN.** Toute génération de code basée sur la FR produira une intégration incomplète.

**Y-02 — `refund` n'est lié à aucune transaction d'origine.**
La doc EN précise : *refund to a customer (not linked to previous payment)*. Aucun paramètre ne permet de désigner la vente remboursée, et `amount` doit rester positif.
➜ Le rapprochement remboursement ↔ vente est **à la charge de snack manager** (stocker le `transactionId` d'origine dans `reference`/`cartId` du remboursement). Impact direct sur la piste d'audit NF525.

**Y-03 — Trois conventions de nommage cohabitent.** Requêtes TPE en camelCase, webhook Cloud en snake_case (`trs_id`, `asked_amount`, `serial_number`), e-commerce en snake_case sauf les query params de retour (`cartId`) restés en camelCase. Le champ type de transaction s'appelle `transactionType` dans les tableaux mais `type` dans les exemples JSON de liste et de webhook.
➜ Écrire **une couche anti-corruption** avec mapping explicite + tests sur les payloads réels. Ne jamais faire de `JSON.parse` direct vers le modèle métier.

**Y-04 — Verbe HTTP ambigu sur `abort` local.** L'exemple est un `POST` avec corps JSON, la ligne de référence indique `GET '…/localapi/v4/abort'`.
➜ Implémenter `POST`, prévoir un fallback `GET`, tester les deux.

**Y-05 — `tax.rate` est un Integer.** La TVA restauration française inclut **5,5 %** (produits à emporter/consommation différée) et **10 %** (sur place). Un entier ne représente pas 5,5.
➜ **Question bloquante à poser à Yavin** avant d'utiliser `items[]` en e-commerce ou `receiptTicketJson` : le taux est-il en points de base (550) ? en dixièmes (55) ? tronqué à 5 ?

### Pièges d'implémentation

**Y-06 — `status` change de type.** `"ok"`/`"ko"` (String) partout, sauf la réponse NFC où c'est un **Boolean**. Parseur strict = crash.

**Y-07 — Coquille de port dans la doc.** Les exemples d'impression locale indiquent `:6125` au lieu de `:16125` (présent en FR **et** en EN). Le bon port est **16125**.

**Y-08 — Pas d'`idempotentUuid` sur le paiement Cloud**, alors que l'`abort` Cloud accepte ce champ. Incohérence : comment annuler par UUID une transaction qu'on n'a pas pu identifier par UUID ?
➜ À clarifier. En attendant, sur Cloud, s'appuyer sur `cartId` unique + garde-fou applicatif contre le double-appel.

**Y-09 — `acceptedMediumType` vs `acceptedPaymentType`.** La doc utilise les deux noms selon la section (objet Kotlin `AcceptedPayment.acceptedMediumType`, tableau Android `acceptedPaymentType`, exemple local `acceptedPaymentType`).
➜ Tester les deux ; envoyer `acceptedMediumType` (nom présent dans la data class) en priorité.

**Y-10 — `receiptTicket` vs `receipt_ticket`** dans la réponse webhook Cloud : l'exemple JSON montre `receiptTicket`, le tableau descriptif dit `receipt_ticket`. Gérer les deux clés.

**Y-11 — Webhook Cloud non paramétrable par requête** et **non signé** : aucune signature HMAC, aucun secret partagé, aucune politique de retry documentée.
➜ URL de webhook longue et non devinable, filtrage IP si Yavin fournit une plage ❓, et **re-vérification systématique** de chaque événement via l'endpoint de détail/liste de transactions avant de valider un encaissement.

**Y-12 — Aucune garantie de livraison du webhook.** Sur le mode Cloud, un webhook perdu = un ticket payé jamais clôturé en caisse.
➜ **Polling de réconciliation obligatoire** : job toutes les N secondes sur les paiements `pending` de plus de X s, + réconciliation de fin de service via `/transactions`.

**Y-13 — `endDate` est exclusive** et `createdAt` est en **UTC**, alors que `timezone` n'est acceptée que côté Cloud.
➜ Toute clôture de caisse (service du soir à cheval sur minuit, heure d'été) doit passer par une conversion explicite. Ne jamais comparer des dates brutes.

**Y-14 — L'API locale n'est pas authentifiée.** Toute machine du LAN peut déclencher un paiement ou une impression sur le TPE.
➜ VLAN dédié / isolation réseau à documenter dans les prérequis d'installation client.

**Y-15 — Pagination par `offset`, `limit` max 200**, pas de curseur, pas de rate limit documenté ❓. Sur un gros volume, l'export peut dériver si des transactions arrivent pendant la pagination.
➜ Paginer sur une fenêtre temporelle **fermée** (service terminé), pas sur « les 30 derniers jours ».

**Y-16 — Panier partiellement payé = annulé à 05:00 GMT.** En click & collect avec titres-restaurant, un client qui ne finit pas son paiement voit sa commande annulée le lendemain matin, silencieusement (webhook `cancel` avec `reason`).
➜ Traiter `action: "cancel"` comme un événement métier de premier plan (remise en stock, notification client).

**Y-17 — Pas de sandbox documenté.** Une réponse d'exemple mentionne pourtant « Sandbox Fake ticket ».
➜ Demander explicitement un accès sandbox + un TPE de test avant tout développement.

---

## 8. Questions à poser à Yavin (avant dev)

1. Format exact de `tax.rate` pour une TVA à 5,5 % (Y-05). **Bloquant.**
2. Chemins exacts : `print`, `transactions`, `abort` Cloud, détail de transaction, et les quatre endpoints e-commerce.
3. Webhook : signature/secret, plage d'IP source, politique de retry, ordre de livraison (Y-11, Y-12).
4. Multi-tenant : une URL de webhook par compte marchand ou une seule pour l'intégrateur ? Comment identifier le marchand dans le payload ?
5. `idempotentUuid` sur le paiement Cloud : supporté mais non documenté, ou réellement absent ? (Y-08)
6. Liste close et à jour des valeurs de `medium` réellement activables (`ancv`, `restoflash`, `2x/3x/4x`…).
7. Documentation de `closingbatch` et `preauthorisation` (aucun exemple, aucun flux décrit).
8. Sandbox + TPE de prêt (Y-17). Rate limits. SLA.
9. Statut du programme **Yavin Platform / ISV** : conditions, MDM, validation d'APK, grille tarifaire, et ce que couvre exactement le lien Notion transmis.

---

## 9. Sonde de vérification (à exécuter avant le premier dev)

```bash
# .env : YAVIN_API_KEY=…  SN=…  IP_TPE=…
BASE=https://api.yavin.com/api/v4/pos

# 1. Confirmer les chemins Cloud (405/400 = le chemin existe ; 404 = mauvais chemin)
for p in payment/ print transactions abort share-receipt; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -XPOST "$BASE/$p" \
    -H "Yavin-Secret: $YAVIN_API_KEY" -H 'Content-Type: application/json' -d '{}')
  echo "$p -> $code"
done

# 2. Vérifier le TPE sur le LAN
curl -s "http://$IP_TPE:16125/localapi/v4/ping?showMessage=true"

# 3. Vérifier le port d'impression (doc erronée à :6125 — Y-07)
curl -s -XPOST "http://$IP_TPE:16125/localapi/v4/print" \
  -H 'Content-Type: application/json' \
  -d '{"format":"text","data":"TEST SNACK MANAGER\n"}'

# 4. Vérifier idempotence + abort en local
UUID=$(uuidgen)
curl -s -XPOST "http://$IP_TPE:16125/localapi/v4/payment" -H 'Content-Type: application/json' \
  -d "{\"amount\":100,\"idempotentUuid\":\"$UUID\",\"vendor\":{\"softwareName\":\"snack manager\",\"softwareVersion\":\"dev\"}}" &
sleep 3
curl -s -XPOST "http://$IP_TPE:16125/localapi/v4/abort" -H 'Content-Type: application/json' \
  -d "{\"idempotentUuid\":\"$UUID\"}"
```

---

## 10. Règles d'implémentation — snack manager

**Contrat interne (à respecter dans tout le code généré)**

1. **Le TPE n'est pas la caisse.** Les tickets `clientCardTicket` / `merchantCardTicket` sont des justificatifs CB, **pas** le ticket de caisse. Le ticket de caisse reste émis, numéroté et journalisé par snack manager (conformité anti-fraude / attestation).
2. **Toute transaction porte un `cartId`** = identifiant interne du ticket, unique et immuable. Aucun appel de paiement sans `cartId`. `reference` = numéro de ticket lisible par le commerçant.
3. **`vendor` toujours renseigné** (`softwareName: "snack manager"`, `softwareVersion` = version du build) — c'est ce qui permet à Yavin de tracer les incidents.
4. **Montants en centimes, entiers, positifs**, y compris pour `reversal` et `refund`. Aucun float dans le domaine paiement.
5. **Machine à états du paiement** côté snack manager : `INITIE → EN_COURS → (PAYE | ECHOUE | ABANDONNE | EXPIRE)`. Seul un webhook confirmé **ou** une lecture via l'API transactions fait passer à `PAYE`. Jamais l'accusé de réception du Cloud (Y-12).
6. **Journaliser le brut** : conserver le payload webhook/réponse tel quel (JSON) à côté de l'objet mappé. Indispensable pour l'audit et pour rejouer un bug de mapping (Y-03).
7. **Champs à conserver pour la piste d'audit** : `transactionId`, `cardToken`, `scheme`, `issuer`, `amount`, `giftAmount`, `currencyCode`, `createdAt`/`device_datetime`, `serialNumber`, `appVersion`.
8. **Pourboires séparés du CA** : `giftAmount` ne fait jamais partie du chiffre d'affaires ni de la base TVA. Comptabiliser sur un compte distinct.
9. **Titres-restaurant** : `acceptedMediumType: "lunch_vouchers_only"` pour le split, `eligible_titre_restaurant` sur les items e-commerce. Prévoir le cas « panier multi-transactions » (Y-16).
10. **Ne jamais annuler pendant la lecture de carte** — l'abort est réservé aux écrans amont (saisie montant, pourboire, référence).

**Découpage suggéré**
```
src/payments/
  yavin/
    client.local.ts        # API 16125, timeout 5 min, retry 0, idempotentUuid obligatoire
    client.cloud.ts        # API v4/pos, ack + webhook
    client.ecommerce.ts    # generate_link / cancel / capture / info
    mapping.ts             # anti-corruption : snake↔camel, type↔transactionType, status bool/string
    reconcile.ts           # polling de secours + clôture de service
    types.ts               # types issus de ce document
  ports.ts                 # interface PaymentTerminal — le domaine ne connaît que ça
```
Le domaine métier ne doit **jamais** importer `yavin/*` directement : uniquement l'interface `PaymentTerminal` (`pay`, `refund`, `abort`, `printReceipt`, `shareReceipt`, `listTransactions`). Cela permet de brancher un second acquéreur plus tard sans réécrire la caisse.

---

## 11. Checklist de recette

- [ ] Paiement nominal CB, ticket de caisse imprimé en même temps que le ticket CB
- [ ] Paiement avec pourboire → `giftAmount` bien isolé du CA
- [ ] Paiement titre-restaurant seul, puis split TR + CB (multi-transactions)
- [ ] Timeout 120 s : client qui ne présente pas sa carte
- [ ] Abandon via `abort` **avant** lecture carte
- [ ] Rejeu du même `idempotentUuid` (succès puis échec — vérifier le piège du `ko` figé)
- [ ] Coupure réseau après le paiement, avant le webhook → réconciliation par polling
- [ ] Webhook reçu deux fois → traitement idempotent côté snack manager
- [ ] Remboursement → rapprochement avec la vente d'origine (Y-02)
- [ ] Clôture de service à cheval sur minuit → `endDate` exclusive + UTC (Y-13)
- [ ] Lien e-commerce non payé → expiration 72 h, webhook `cancel`
- [ ] Panier partiellement payé → annulation 05:00 GMT, remise en stock
- [ ] Coupure secteur du TPE en pleine transaction
