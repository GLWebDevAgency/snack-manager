# Compte client — clé d’accès et code de secours

Décision du fondateur, 8 septembre 2026 : **clé d’accès + code de secours** pour
la reconnexion, en conservant la vérification initiale du téléphone. Ce document
décrit la cible et distingue le socle testé du parcours qui reste à raccorder.
Il ne vaut ni ouverture du pilote, ni autorisation de consommation Verify.

## Lot préparé : primitives et reçu de session commun

La migration additive `0005_customer_session_publications` porte un reçu
immuable lié au parent, au restaurant, à la session, à l’intention et à la
génération du navigateur. Ses méthodes `phone`, `passkey` et `recovery` ne sont
pas des autorisations : seul un cas d’usage ayant vérifié sa preuve peut publier
dans la même transaction. Aucun faux challenge SMS n’est créé pour les deux
nouvelles méthodes. Les routes privées et la clôture d’intention utilisent ce
reçu ; les contrôles existants de session et de publication attendue demeurent.

Le vérificateur stateless repose sur SimpleWebAuthn 14. La page doit être en
HTTPS, l’origine est exacte et le RP correspond à son seul hostname. Présence
et vérification de l’utilisateur sont requises ; clé découvrable demandée,
attestation `none`, algorithmes explicitement fixés à ES256, RS256 et EdDSA.
L’alias du compte et le userHandle ne contiennent ni nom ni téléphone. Les
identifiants sont comparés avant vérification ; aucun message cryptographique
brut n’est renvoyé. La bibliothèque navigateur est une dépendance de test de
l’API, pas un formulaire déjà intégré au web.

Le générateur de secours produit 128 bits aléatoires via le CSPRNG système,
présentés en huit groupes hexadécimaux préfixés `SM1`. Seules les variantes de
casse et séparateurs ASCII sont admises. Son empreinte HMAC possède une clé
dérivée dédiée et lie parent et restaurant. **Ces primitives ne stockent,
n’activent et ne consomment aucun code.** L’usage unique reste à réaliser dans
le protocole transactionnel, pas dans une fonction de hash.

Preuves locales : 293 tests customer avec PostgreSQL, API identité 609, runner
dédié 109 PG puis 6 HTTP, bootstrap 94 dont upgrade réel, WebAuthn 47 dont 15 avec authentificateur
virtuel Chromium, secours/crypto 107 inclus dans customer. Ces chiffres se
recouvrent, ne pas les additionner. Ni téléphone physique ni SMS réel dans ces
preuves ; aucune authentification publique passkey/secours disponible encore.

## Préparation suivante : journal local perdu

Le lot `customer-browser-restore` ajoute une lecture explicite du seul sélecteur
de navigateur, à partir du cookie HttpOnly existant. PostgreSQL exige le parent,
le restaurant, l'empreinte exacte, une préparation déjà confirmée et son
échéance SQL non dépassée. Aucune ligne n'est créée, confirmée ou prolongée ;
aucun quota SMS ni reçu de session n'est modifié. Aucune nouvelle migration.

Le BFF ne rend que les quatre champs publics de préparation et ne réémet ni
ne supprime de cookie. `restoreMissingJournal()` reste une opération explicite,
non raccordée à un bouton public : verrou natif, journal strictement absent,
transaction IndexedDB CAS vers `ready` **sans intention ni publication**.
Un journal corrompu ou apparu entre-temps n'est jamais remplacé. L'expiration
est recontrôlée après le dernier commit local ; en cas d'incertitude, le
sélecteur conservé n'est pas annoncé prêt. Les journaux de commande et de
fidélité sont hors de ce chemin.

Preuves du lot : 118 tests PostgreSQL et 8 HTTP signés réels, sans skip dans
ces exécutions ; les ports fournisseur y sont simulés. Les 16 tests navigateur
de préparation utilisent les vrais cookies, IndexedDB, Web Locks et handlers
BFF, avec un amont API isolé. La contre-revue a identifié puis fait corriger
le franchissement de l'expiration pendant le commit IndexedDB. Ce socle ne
rétablit toujours ni profil, ni carte, ni historique et ne remplace pas la
preuve forte de reconnexion. Un cookie remplacé hors protocole peut rendre un
sélecteur inutilisable ; les appels suivants le refusent sans adopter un compte.

## Parcours à livrer ensuite, avant ouverture

1. **Créer mon compte** : téléphone → code SMS → inscription provisoire bornée.
   Elle n’autorise ni ancien profil, ni commandes privées, ni historique. Une
   inscription abandonnée peut recommencer vide après une nouvelle preuve
   téléphone ; elle ne reprend jamais un compte actif. Les comptes existants ne
   sont pas transformés implicitement en inscriptions provisoires.
2. **Protéger mon compte** : créer la clé d’accès, recevoir le code de secours,
   confirmer sa sauvegarde, puis activer atomiquement le compte protégé. Ne pas
   annoncer la protection comme terminée après une réponse perdue. Aucun code
   dans l’URL, les logs, le journal public ou un stockage navigateur automatique.
3. **Me reconnecter** : clé d’accès proposée par l’appareil ; Face ID, empreinte
   ou code de déverrouillage sont des exemples, pas une biométrie imposée. Le
   serveur recherche le credential dans le restaurant ET le RP courant, vérifie
   le challenge de cette intention, puis consomme et publie atomiquement.
4. **Utiliser mon code de secours** : vérifier la version active et consommer
   une seule fois, sous limites d’essais durables, avec un reçu récupérable par
   la preuve privée de l’intention. Réponse perdue : lire ce reçu, sans consommer
   une seconde fois ni prolonger une session. La remise en protection et le
   remplacement explicite du code doivent être inclus au parcours livré.
5. **Journal navigateur perdu** : action explicite pour retrouver seulement la
   préparation confirmée liée au cookie encore valide, sans réémettre le cookie
   ni allonger sa durée. Aucune publication personnelle n’est restaurée par ce
   geste ; une nouvelle authentification forte reste nécessaire. Ne jamais
   effacer les journaux de commande pour résoudre ce cas.

La seule correspondance du téléphone et le QR fidélité ne donnent aucun accès
à un historique existant. Une clé liée au domaine personnalisé ne devient pas
valide sur le domaine plateforme. Plusieurs restaurants hébergés sur une même
origine exigent toujours une recherche de credential isolée par tenant.

## Réception du parcours complet

- Interrompre chaque étape d’inscription ; prouver l’absence d’accès privé avant
  activation et le refus d’un ancien compte après OTP seul.
- Deux activations simultanées et deux consommations du même code : un seul
  succès ; état et reçu atomiques, aucune suppression opportuniste d’historique.
- Reconnexion après déconnexion, changement d’appareil et perte du seul journal.
- Réponse A tardive après publication B : aucune substitution de compte.
- Challenge expiré, autre origine/tenant, credential révoqué, userHandle erroné,
  signature fausse, vérification utilisateur absente : refus fermé.
- Compteurs WebAuthn à zéro : aucune dépendance au seul compteur pour empêcher
  le rejeu ; le challenge durable est consommé une seule fois.
- Formulaire réel dans le Sheet Mon compte, identité du restaurant préservée,
  essais 320/390/1440 px, clavier/focus, erreurs locales et réduction des motions.
- Recette fournisseur explicitement budgétée, puis seulement ouverture ciblée.

## Références techniques

- [SimpleWebAuthn — serveur](https://simplewebauthn.dev/docs/packages/server) :
  génération et vérification des options/réponses.
- [W3C WebAuthn](https://www.w3.org/TR/webauthn-3/) : portée du RP et vérification
  d’une preuve cryptographique, distincte de l’autorisation métier.
- [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html) : référence de
  conception pour les risques PSTN et codes de récupération à usage unique ;
  aucune certification de conformité n’est revendiquée pour ce socle.
