# Lot commande et fidélité

Branche : `refactor/apple-ui-integration`, worktree `SnackManager-refonte-ui`. Aucun commit, push, merge ni déploiement effectué par ce lot.

## Décisions et intégration

Intégration dans les composants Next/React existants, après inventaire `PARITE-WEB.md` et captures `web-avant-surfaces`. Handoff, prompts 00/06/07, charte et invariants lus. `apps/web/AGENTS.md` préservé ; guide CSS du Next 16.3.1 installé lu dans `node_modules/next/dist/docs/01-app/01-getting-started/11-css.md` (paquet hoisté à la racine).

La direction RestoPilot se traduit par des contenus opaques, une hiérarchie de titres en casse de phrase, des cartes produit plus lisibles et un solde fidélité immédiatement lisible. Le masque du restaurant reste l'autorité pour la palette, les polices, les rayons, les contrastes, les ombres et le rythme des animations. Aucun thème client n'est remplacé par une palette Snack Manager.

Fichiers applicatifs du lot :

- `apps/web/src/components/order/order-v2.css` : cartes opaques, noms/descriptions plus lisibles, contrôles de formats sur surface secondaire, focus clavier visible et survol discret. Grille, container query 184 px, seuils responsive, rayons tenant et raccord sticky conservés.
- `apps/web/src/components/order/primitives.tsx` : titres sans double filet décoratif, `Surface` et en-têtes de `Sheet` opaques, bouton fermer lisible sur photo. Seules classes et décoration changent ; pile, focus, drag, fermeture verrouillée, transition et callbacks conservés.
- `apps/web/src/components/order/ProductSheet.tsx` : repli sans photo simplifié en bandeau neutre ; média réel et cadrage du catalogue conservés. Pas de photo ni d'illustration inventée depuis un nom produit.
- `apps/web/src/components/loyalty/carte-visuelle.tsx` et `carte-visuelle.module.css` : mêmes pièces partagées avec la carte réelle et la démo ; solde agrandi, surfaces opaques, titres et badge acquis lisibles, lien Commander conservé. Animation confirmée, ARIA du solde réel et jauge restent inchangés.
- `apps/web/src/components/loyalty/LoyaltyCardApp.tsx` : seulement surfaces d'accueil sans carte et de repli hors ligne opaques ; aucun contrôleur modifié.

Le SDK, les contrats, transports API, consentements, mémoire client, jetons QR, suppression locale, calculs, paiement, devis et créneaux ne sont pas réécrits. Aucun test supprimé ou affaibli. Aucun changement de dépendance dans ce lot.

## Vérification exécutée

Commande depuis la racine avec Node 24.20.0 :

```sh
pnpm --filter @sm/web exec vitest run src/components/order/menu-layout.browser.test.tsx src/components/order/order-header-joint.browser.test.tsx src/components/order/ProductSheet.browser.test.tsx src/components/order/ProductSheet.test.ts src/components/loyalty src/components/masque/styleDuMasque.test.ts --maxWorkers=1 --fileParallelism=false
```

**176/176 tests, 14/14 fichiers réussis** ; log `preuves/commande-fidelite-tests-apres.log`.

Ces preuves couvrent notamment les prix/formats longs à 320–430 px et 820 px, les trois formes tenant réellement rendues, le raccord sticky avec hauteur fractionnaire et changements d'identité, la fiche produit et ses options/retraits/variantes, les paliers, feedback de scan, mouvement, copie locale minimale, relais, installation et gardes de session fidélité.

La recette visuelle commune est suivie dans `QA-WEB.md` et `captures/web-apres-surfaces/resultats.json`. Elle rend les routes réelles avec les démos existantes et les fixtures locales uniquement ; les requêtes externes sont bloquées. Le masque Brasserie clair est demandé uniquement par le mécanisme de capture de démo existant.

## Limites et prochaine tranche

Typecheck global et build Next sont coordonnés par le root, après gel des autres surfaces ; ce lot ne déclare pas leur résultat avant exécution. Le harnais visuel ne valide pas un vrai crédit fidélité, une carte/QR privée, un paiement Stripe, une mutation de back-office ou une livraison réelle. Les scénarios bout en bout avec reprise de checkout, caméra, carte hors ligne et consentement réel restent des recettes distinctes ; les contrôleurs correspondants ne changent pas ici.

Prochaine tranche précise : inspection des états authentifiés fidélité (copie locale ancienne, erreur QR, suppression en cours), puis tunnel commande au clavier/zoom texte avec devis périmé et reprise processing/uncertain, toujours sous fixtures locales. Ces états restent disponibles et ne sont pas déclarés entièrement recettés par les captures de démo.
