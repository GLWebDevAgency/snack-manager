**Relecture des scénographies « studio » et de l'apparence des écrans — 5 septembre 2026**

**Verdict : conserver, et corriger quatre points avant de mettre ces modèles en avant.** Les PR 107, 109 et 110 sont fusionnées, la CI est verte, les trois parcours de bout en bout passent contre staging, et deux apports sont justes : la simulation midi/soir dans l'aperçu, et les « Incontournables » par catégorie. Mais les treize modèles du studio et Ardoise en portrait descendent sous les planchers de lisibilité que le cahier fixe, Comptoir a changé de caractère sans décision, la charge d'animation a été multipliée sans mesure, et le tiroir promet quinze modèles là où il y en a deux plus treize variantes.

Périmètre : `develop` à `0c628d2`, lu en entier pour les fichiers cités ; rendus statiques de chaque modèle en paysage 1920 × 1080 sur le masque Néon, scènes de 8 produits et de sélection (méthode : `renderToStaticMarkup` de `BoardStage`, donc sans les photos, qui se chargent après montage) ; captures du tiroir sur staging ; parcours `e2e/demo/ecran-apparence`, `e2e/reel/ecran-apparence`, `e2e/reel/ecran-hors-ligne` joués contre staging. Références : le cahier [scénographies](../superpowers/specs/2026-09-05-scenographies-tv-design.md) §4 et §5, et [DIRECTION-ARTISTIQUE.md](../DIRECTION-ARTISTIQUE.md).

**1. Les planchers de lisibilité sont cassés — à corriger avant tout.**

Le cahier §4 fixe, à huit lignes : paysage nom 42, description 24, prix 46, titre 76 px ; portrait 56 / 30 / 62 / 96. Comptoir les tient par une table testée ([composition.ts](../../apps/web/src/components/board/scenographies/comptoir/composition.ts) lignes 59–66, [composition.test.ts](../../apps/web/src/components/board/scenographies/comptoir/composition.test.ts) lignes 43–58). Le studio n'a pas de garde, et le calcul descend dessous :

| Où | Nom | Prix | Plancher | Source |
|---|---|---|---|---|
| Studio, plus de 4 produits, paysage | 44 px | 39 px (36 en éditorial) | 42 / 46 | [profiles.ts](../../apps/web/src/components/board/scenographies/studio/profiles.ts) lignes 30–39 |
| Studio, plus de 4 produits, portrait | 48 px | 42 px (39 en éditorial) | 56 / 62 | idem |
| Studio, nom long (facteur 0,84) | 37 px paysage, 40 px portrait | | 42 / 56 | [Studio.tsx](../../apps/web/src/components/board/scenographies/studio/Studio.tsx) ligne 53 |
| Studio, description | 28 px fixes | | 30 en portrait | [studio.css](../../apps/web/src/components/board/scenographies/studio/studio.css) ligne 39 |
| Ardoise, 8 lignes en portrait | 40 px, descriptions masquées | | 56 | [board.css](../../apps/web/src/components/board/board.css) lignes 685–686 |
| Comptoir, ligne à prix large | nom divisé par l'échelle des prix | | 56 | [comptoir.css](../../apps/web/src/components/board/scenographies/comptoir/comptoir.css) ligne 504 |

Le prix est le second élément le plus fort de l'écran ; un prix à 39 px sur un téléviseur lu à quatre mètres ne se lit pas. Ta propre relecture du kit posait la règle juste : quand une rangée ne tient pas, on change de composition ou on pagine davantage, on ne réduit pas la lisibilité pour garder la grille.

Correction attendue : exporter `PLANCHERS` de `comptoir/composition.ts` comme source unique, faire passer `studioComposition` et les règles portrait d'Ardoise par elle, retirer le facteur 0,84 sur le nom (un nom long se replie sur deux lignes ou change de composition), et copier le test de Comptoir pour chaque disposition atteignable du studio et d'Ardoise. Un test qui échoue aujourd'hui sur ces valeurs est le résultat attendu.

**2. Comptoir a changé de caractère sans que le cahier le dise.**

Le cahier §5 reprend la règle du kit : *capitales pour les noms, bas de casse pour les descriptions*. [comptoir.css](../../apps/web/src/components/board/scenographies/comptoir/comptoir.css) lignes 423–429 pose `text-transform: none` sur les noms de boîte. La description publiée du modèle a aussi été remplacée par « Photos mises en avant, prix bien visibles » ([screens.ts](../../packages/contracts/src/screens.ts) ligne 115), qui ne dit plus ce que le modèle fait ni ce qui le distingue.

Ce n'est pas une faute de code, c'est une décision de direction artistique prise dans une PR de fiabilisation. Correction attendue : soit revenir aux capitales et à la description qui nomme le comptoir et l'étiquette collée, soit inscrire le changement dans le cahier avec sa raison. Pas entre les deux.

**3. La charge d'animation a été multipliée sans mesure.**

Le contrat (§4) n'anime que `transform` et `opacity`, et c'est tenu — les gardes CSS sont vertes. Mais le nombre d'animations infinies a explosé : dans [studio.css](../../apps/web/src/components/board/scenographies/studio/studio.css) lignes 307–319, deux lumières, deux plans, un flottement et une respiration par produit, plus le pied de page ; une scène dense de huit produits fait tourner en continu une vingtaine d'animations. [board.css](../../apps/web/src/components/board/board.css) ligne 64 met le halo de Comptoir en boucle infinie, qui était statique, et les lignes 54 et 60 rendent les photos d'Ardoise animées en continu sous `motion: subtle` et `expressive`.

La cible est une clé HDMI à trente euros ou le navigateur intégré d'un téléviseur, douze heures par jour. Une transformation composée par le processeur graphique n'est pas gratuite quand il y en a vingt en permanence, et « subtle » devrait alléger, pas ajouter.

Correction attendue : mesurer sur la clé du pilote une heure durant — images perdues, charge, température — avant de proposer ces modèles par défaut ; poser un budget par scène, de l'ordre de quatre animations infinies ; faire que `subtle` en retire et que `off` n'en laisse aucune, y compris le halo.

**4. Le tiroir annonce quinze modèles ; il y en a deux, plus treize variantes.**

[Studio.tsx](../../apps/web/src/components/board/scenographies/studio/Studio.tsx) est un seul composant ; [profiles.ts](../../apps/web/src/components/board/scenographies/studio/profiles.ts) le décline en treize combinaisons de disposition, d'ambiance et d'entrée. La structure est la même partout : en-tête, produits, prix. Dans mes rendus de huit produits, aucun des treize n'affiche les descriptions, et plusieurs profils sont à peine distinguables entre eux (Affiche et Galerie, Éditorial et Colonne). Rien de faux, mais un gérant qui lit « 15 modèles » attend quinze mises en scène.

Correction attendue : le dire tel quel dans le tiroir — deux scénographies, et un studio de treize ambiances — ou faire de trois d'entre elles de vraies compositions distinctes, avec descriptions, testées comme Comptoir l'est (`Comptoir.test.ts` : les six cas rendus).

**Ce qui est juste, et à garder.** La simulation midi/soir dans l'aperçu, indispensable pendant la coupure. Les Incontournables : trois par catégorie, insérés après la catégorie, doublons et ruptures écartés, testés. Le chargement des photos après décodage et l'affichage à taille native des petites sources. L'annulation des aperçus périmés. La garde sur un masque de cache corrompu. La séparation `presentation` versionnée, avec son repli pour les documents antérieurs.

**Méthode pour la suite.** Les planchers sont dans le cahier depuis le premier jour ; un modèle qui ne les tient pas n'est pas fini. Toute nouvelle scénographie doit arriver avec le test de ses dispositions atteignables contre `PLANCHERS`, et une mesure sur la clé du pilote quand elle ajoute du mouvement continu.
