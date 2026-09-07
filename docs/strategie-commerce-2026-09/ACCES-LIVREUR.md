# L2.1 — Accès opérationnel livreur

Lot du 7 septembre 2026, sur `codex/delivery-operator-access`, depuis `5695059`.
Ce document décrit l'implémentation et ses limites ; les preuves de déploiement
seront consignées sur la PR. **Ce n'est pas encore l'application de missions L2 complète.**

## Parcours livré dans ce sous-lot

- Back-office → Livraison → Vos livreurs : ajouter un livreur dédié par son nom
  ou habiliter un équipier existant. L'offre livraison suffit, sans option RH.
- Le gérant présente un QR personnel à usage unique, valable dix minutes.
  Émettre un nouveau QR révoque le téléphone précédemment associé.
- Sur `/livreur` du domaine plateforme : confirmer l'association du téléphone,
  vérifier l'identité et la durée de l'accès, se déconnecter.
- Révoquer l'accès depuis le back-office bloque les lectures suivantes. Une
  réactivation requiert une nouvelle association ; elle ne restaure aucun secret.
- Une liste paginée permet de retrouver les accès au-delà des 200 premières
  lignes. « Téléphone associé » ne signifie ni géolocalisé ni connecté en direct.

## Frontières d'autorisation

`DeliveryOperator` est distinct de `Staff`, avec un lien facultatif au membre
polyvalent. Aucun PIN, rôle caisse/cuisine, salaire ou pointage n'est copié.
Le domaine de session livreur n'est pas un JWT professionnel : les routes
générales de caisse/back-office le refusent. Ses routes dédiées relisent :

1. opérateur actif et version de session courante ;
2. restaurant existant, non suspendu, avec capacité `delivery` ;
3. membre Staff actif, du même tenant et de même version lorsqu'il est lié ;
4. expiration de la session (sept jours fixes au maximum).

Changer le PIN, le rôle ou l'état d'un Staff invalide conservativement son
ancien accès livreur. Le gérant doit le réhabiliter explicitement. Révoquer
seulement la livraison ne déconnecte pas la caisse de cet équipier.

## Reprise et confidentialité

- Création idempotente : même restaurant + même tentative = même accès ; un
  autre contenu sous la même tentative est refusé. Un Staff ne peut avoir deux
  accès livraison concurrents dans le même restaurant.
- Changements par comparaison de révision ; preuve et changement sont écrits
  dans le même document. Une ancienne action n'écrase pas une réactivation.
- L'invitation et la session sont des secrets de 256 bits, stockés hashés.
  Le lien contient le secret dans son fragment, jamais en query string. Il est
  retiré avant hydratation ; aucune invitation n'est sauvegardée côté navigateur.
- Échange atomique invitation → session : un seul téléphone gagne. Une réponse
  perdue se rejoue avec le même nonce pendant dix minutes après consommation,
  sans créer ni prolonger une session. La révocation ferme aussi cette reprise.
- Cookie de session HttpOnly, Secure en environnement déployé, SameSite strict,
  limité à `/livreur`. La session ne sort pas dans le JSON du navigateur.
- Origines plateforme contrôlées, payload borné, réponses privées `no-store`,
  quota partagé Redis et arrêt fermé si le quota ne peut pas être contrôlé.
- Mutation acquittée et preuve de reprise exigent une écriture/lecture
  majoritaire. Un succès visuel ne doit pas précéder la preuve serveur.
- Création gérant : intention minimale stockée temporairement dans l'onglet,
  isolée par restaurant. Aucun token dans ce stockage. Si ce stockage est refusé,
  ne pas envoyer une création que l'écran serait incapable de reprendre.

Ces choix suivent les [recommandations OWASP de gestion des sessions](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html),
adaptées au contrôle révocable déjà utilisé dans le projet. Ils ne constituent
pas une certification de sécurité globale.

## Vérification et exploitation

- Tests de contrats, protections des contrôleurs, quotas, garde livreur, cookies,
  origine, payload, états client et tentative gérant.
- Recette Mongo locale isolée : créations concurrentes, ACK perdu, nonce
  concurrent, révocation/réactivation, expiration, historique atomique,
  abonnement/suspension et pagination. Étape CI dédiée, pas un test ignoré.
- Captures et interactions rendues à contrôler à 390 px et sur bureau : focus,
  erreurs, interruption, QR, expiration, réseau et mouvement réduit.
- Vérifier ensuite la version réellement servie, les quatre services Railway
  et le smoke. Une CI verte n'est pas une preuve d'association sur un téléphone.
- Données additives dans `delivery_operators`. Pas de migration des commandes,
  de rôle Staff, de PIN, de portefeuille fidélité ou de paiement existant.
  Les index sont déclarés avec les modèles ; aucun bootstrap C15 à rejouer.
- Pas d'appel SMS, de dépense fournisseur ou de nouvelle activation livraison
  Classfood implicite. Production seulement après recette et GO dédié.

## Ce qui suit — L2.2 et L2.3

- Affectation et réaffectation d'une vraie commande, missions privées par livreur.
- Départ uniquement après préparation et paiement confirmé ; aucun droit de
  caisse accordé pour permettre un départ.
- Preuve de remise à usage unique (QR/PIN client), essais bornés, incident,
  client absent et dérogation gérant traçable.
- Application mobile installable, parcours complet et recette en conditions
  réelles. Pas de GPS ni de fonctionnement hors réseau promis par L2.1.

Le client d'association conserve invitation/nonce uniquement en mémoire de page.
Il faut garder la page ouverte pendant une reprise ambiguë ; après fermeture
avant réception du cookie, un nouveau lien gérant peut être nécessaire.
L'accès opérationnel ne dépend ni de Twilio ni de l'inscription fidélité L3.

## Recette locale exécutée avant PR

Node 24.20.0, sans installation ni mutation de staging :

- Module livraison : **135 tests réussis**, dont 38 tests du socle/CRUD et
  8 du banc HTTP. Les cas Mongo ont réellement tourné sur une base loopback
  isolée puis supprimée. Le quota Redis est simulé dans le banc HTTP seulement.
- Web : **1 229 tests réussis**, incluant six scénarios Chromium avec vrais
  composants, CSS et handlers Next. Seule l'API amont de ces six tests est simulée.
- Back-office : 28 tests automatisés et **11 parcours Chromium supplémentaires**
  dans un harnais local : QR, copie, expiration, focus, réponse perdue/reload,
  stockage refusé, erreur 409, pagination 201e entrée et révocation.
- Captures inspectées par l'agent principal : annuaire bureau, QR/révocation
  mobile, invitation et identité associée. Le gabarit mobile 320 px, le clavier
  et le mouvement réduit ont été testés. Pas de certification tactile matérielle.
- Compilation API, contrats et modèles réussie. La compilation complète Next
  et des applications Expo reste confiée à la CI (pression disque locale).

Une revue indépendante a fait corriger la pagination de l'annuaire et les
lectures majoritaires de reprise, avec tests de non-régression. Aucun parcours
de mission, paiement, GPS ou preuve de remise n'est revendiqué par cette recette.
