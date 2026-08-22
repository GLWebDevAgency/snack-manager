# Provenance des photographies libres

**Ce fichier existe pour qu'on n'ait plus jamais à inspecter des métadonnées.**

Le 18 août 2026, vingt-quatre fichiers de `design_handoff_snack_manager/photo-base/`
se sont révélés inutilisables : vingt et un aperçus Getty en 612×612, une image
récupérée sur Facebook, l'image promotionnelle filigranée d'un vendeur
d'affichage, la vidéo de démonstration d'un prestataire. Le problème n'était pas
qu'on avait mal choisi — c'est que **rien ne disait d'où elles venaient**. Tout
fichier ajouté dans ce dossier s'inscrit donc ici, avec son adresse source, sa
licence, sa date et ce qu'on a vu **en ouvrant l'image**, pas ce que son titre
promettait.

Ces vingt-quatre fichiers restent un **plan de prises de vue** — le fondateur y a
choisi les scènes — et rien d'autre. Ils ne sont jamais copiés dans `public/`.

- **Sources admises :** Pexels et Unsplash uniquement, dont les licences
  autorisent l'usage commercial **sans attribution**. L'attribution portée
  ci-dessous est une courtoisie et une trace de vérification, pas une obligation.
- **Sources refusées :** Getty, iStock, Shutterstock, Adobe Stock, Freepik, et
  toute image trouvée dans un article de blog ou sur un réseau social.
- **Chaîne de téléchargement :**
  `https://images.pexels.com/photos/{ID}/pexels-photo-{ID}.jpeg?auto=compress&cs=tinysrgb&w=1800`
- **Format de livraison :** WebP qualité 82, redimensionné à ce que le rendu
  demande et jamais plus.

Toutes les images ci-dessous ont été téléchargées le **21 août 2026** et ouvertes
une par une avant d'être retenues.

---

## Les cinq fichiers retenus

### `ambiance-salle-nuit-bokeh.webp`

| | |
|---|---|
| Source | https://www.pexels.com/photo/4551154/ — « Blurred shimmering lights in cafe at night », Roman Odintsov |
| Licence | Pexels — usage commercial, sans attribution |
| Livré | 1800 × 1000 (1,80:1), 199 Ko |
| Destination | Landing, bande à fond perdu de `#commander` |
| Texte alternatif | **Aucun** — `decorative` (pose `alt=""` **et** `aria-hidden`) |

**Ce que montre l'image :** une salle de restaurant photographiée entièrement
**hors mise au point**. On distingue des lampes ambrées en pastilles de bokeh, la
masse sombre d'une suspension en haut, un comptoir et deux tables en bas. Aucun
texte, aucun visage, aucune enseigne, aucun prix — il n'y a strictement **rien à
lire** dans le cadre, à aucune définition.

**Ce qu'elle ne montre pas, et il faut le savoir :** ni client, ni trottoir, ni
téléphone. La scène demandée — un client devant une devanture allumée, son
téléphone à la main — n'existe pas en libre de droits sans enseigne lisible : les
vingt-trois devantures nocturnes ouvertes pour ce besoin portaient toutes une
marque (KFC, Burger King, Nando's, Tim Hortons, A&W), un nom d'établissement
(« MAITRE KEBABIER », « SIDE KEBAB », « TAQUERIA ZORRO », « LE 116 ») ou des prix
déchiffrables. **L'argument reste donc au texte ; l'image ne fait que poser
l'ambiance.** C'est un choix assumé, pas un oubli.

**Pourquoi elle convient techniquement :** le flou de profondeur est total, ce qui
règle le seul point dur du fond perdu — au-delà de 1800 px de large,
l'agrandissement ne se voit pas, puisqu'il n'y a aucun détail fin à étirer.
Luminance moyenne 69, centile 99,9 à **244** (les pastilles de bokeh). Sous un
voile noir d'alpha **0,75**, le pixel le plus clair retombe à 61 et le blanc y
conserve **10,5:1** — au-delà des 8:1 exigés, sur toute la hauteur des trois
rangées et pas seulement dans un angle.

---

### `comptoir-vignette.webp`

| | |
|---|---|
| Source | https://www.pexels.com/photo/19445084/ — « Lamps over Counter in Food Bar », Vladyslav Dukhin |
| Licence | Pexels — usage commercial, sans attribution |
| Livré | 1800 × 1118 (1,61:1), 74 Ko |
| Destination | Offres, texture à fond perdu de `#services` (opacité ≈ 22 %, flou léger, voile noir) |
| Texte alternatif | **Aucun** — `decorative` |

**Ce que montre l'image :** un passe-plat de cuisine vu depuis la salle, dans une
lumière très basse. Deux abat-jour cuivrés suspendus éclairent le plan ; derrière,
une vitrine réfrigérée à néon, un four à micro-ondes, des plantes retombantes
au-dessus du passe ; à droite, une pile de cartons à pizza vierges. **Un
avant-bras** apparaît au bord gauche du cadre — c'est tout ce qu'on voit d'une
personne : aucun visage.

**Ce qu'il y a à lire, et c'est déclaré :** un panneau de liège porte trois notes
manuscrites de service — une liste de prénoms avec des chiffres, et une feuille
« HOT LIST / SALA 29.11–10.12 » suivie d'une énumération. Ce n'est **ni une
enseigne, ni une adresse, ni une note étoilée, ni un prix** : c'est un planning
d'équipe. Le liège occupe le tiers droit et ne peut pas être recadré hors champ
sans descendre sous les 1430 px que la bande doit couvrir. À 22 % d'opacité sous
un flou léger — le traitement que la section impose de toute façon — il ne reste
rien de lisible.

**Pourquoi elle convient :** luminance moyenne **29**, maximum **229**. C'est la
photo la plus sombre du lot et la plus proche de la charte : cuivre et ambre sur
noir, à un cheveu du `#c9a15a`.

---

### `blog-telephone-main-nuit.webp`

| | |
|---|---|
| Source | https://www.pexels.com/photo/11341268/ — « A Person Holding a Smartphone », Towfiqu barbhuiya |
| Licence | Pexels — usage commercial, sans attribution |
| Livré | 1560 × 780 (2:1), 18 Ko |
| Destination | Blog — article **« Mettre votre lien de commande sur votre fiche Google »** : en-tête d'article **et** bandeau de sa carte d'index |
| Texte alternatif | **Aucun** — `decorative` |

**Ce que montre l'image :** deux mains en gros plan, de nuit. La gauche tient un
téléphone, l'index droit s'apprête à toucher l'écran. **L'écran est un aplat blanc
vierge** — aucune interface, aucune application reconnaissable, aucun logo sur
l'appareil. Derrière, des lumières de ville en bokeh rouge et ambre. Aucun visage,
aucun texte.

**Sur la double destination :** livrée à 1560 px, elle couvre les deux emplois —
l'en-tête d'article demande 1440 px de source pour 720 px rendus, la carte
d'index en demande 1560 pour 780. Un seul fichier, deux usages, 18 Ko sur le
réseau.

---

### `blog-burger-frites-fond-noir.webp`

| | |
|---|---|
| Source | https://www.pexels.com/photo/28828555/ — « Delicious Cheeseburger with Fries in Dark Setting », Lucas Porras |
| Licence | Pexels — usage commercial, sans attribution |
| Livré | 1560 × 780 (2:1), 101 Ko |
| Destination | Blog — article **« Pourquoi le même kebab coûte plus cher sur l'appli »** : en-tête **et** carte d'index |
| Texte alternatif | **Aucun** — `decorative` |

**Ce que montre l'image :** un double cheeseburger au bacon et à la tomate, posé
sur une planche de bois, avec un cornet de grosses frites, sur **fond noir plein**.
Éclairage rasant chaud, dominante dorée. Aucun emballage, aucune serviette
imprimée, aucun gobelet, aucune marque, aucun texte. Le tiers gauche est noir pur
— de la place pour un titre si l'en-tête en superpose un un jour.

**Une réserve honnête :** l'article parle de kebab, l'image montre un burger. Les
scènes de kebab libres de droits ouvertes pour ce besoin étaient toutes prises en
boutique, avec broche, enseigne (« Antalya ») ou carte étrangère dans le cadre.
Un produit de snack sur fond noir tient le même rôle sans nommer personne.

---

### `blog-fenetre-service-nuit.webp`

| | |
|---|---|
| Source | https://www.pexels.com/photo/32897258/ — « Nighttime food truck window with worker », 女子 正真 |
| Licence | Pexels — usage commercial, sans attribution |
| Livré | 1560 × 780 (2:1), 68 Ko |
| Destination | Blog — article **« Ouvrir le click and collect sans se tromper »** : en-tête **et** carte d'index |
| Texte alternatif | **Aucun** — `decorative` |

**Ce que montre l'image :** une fenêtre de service éclairée, la nuit, vue de
l'extérieur — un long bandeau chaud découpé dans une carrosserie bleu sombre. À
l'intérieur, un jeune homme **de profil, tête baissée, casquette et lunettes**,
derrière une caisse de rangement noire ; devant lui, un bac inox et une vitre de
protection. Il occupe moins d'un dixième du cadre et ne regarde pas l'objectif.

**Vérifié au pixel :** ce qui ressemble à une inscription sur la vitre sombre, à
gauche, est en réalité un alignement de pinces de service en reflet — agrandi ×2,
il n'y a **aucune lettre**. Aucune enseigne, aucun prix, aucun logo dans le cadre.

**Une réserve honnête :** c'est un camion, pas une devanture fixe. Le cadrage est
serré sur la fenêtre et ne montre ni roue, ni hayon, ni plaque — mais quiconque
connaît le sujet reconnaîtra une remorque. Elle est retenue parce que la scène
qu'elle décrit est la bonne : **le guichet de retrait, éclairé, en service.**

---

## Les besoins non servis, et pourquoi

Trois des huit besoins repartent sans image. Ce n'est pas un abandon : c'est
l'application de la règle « en cas de doute sur une source, on ne prend pas ».

### Landing `#commander`, rangée « Votre identité visuelle » — le menu papier daté

Le besoin le plus argumentatif de la page, et le seul introuvable proprement. Les
menus visiblement datés existent en quantité sur Pexels — mais **toujours attachés
à un établissement identifiable** : le chippy britannique (`17993843`) affiche ses
prix en livres, ses logos VISA/Mastercard et sa marque d'alarme ; le snack
américain (`29560600`) est constellé de logos Pepsi ; le comptoir russe
(`785541`) mêle prix en cyrillique et Pepsi ; le porte-menu rétroéclairé turc
(`14672960`), esthétiquement parfait, est intégralement en turc.

Un cas mérite d'être nommé parce qu'il était tentant : `12040643` montre une
**vraie devanture de snack française** — « VENTE À EMPORTER », « Sandwichs Crêpes
Paninis » — avec son panneau photo jauni, à l'heure bleue. C'est exactement la
scène demandée. **Elle est refusée** : l'enseigne « LE 116 » y est parfaitement
lisible, et légender un établissement réel et nommable comme « l'AVANT qu'on vient
moderniser » serait bien pire qu'une photo de banque anonyme.

### Landing `#materiel` — les écrans de menu numériques en situation

Chaque écran de menu photographié appartient à quelqu'un, et ce quelqu'un est
presque toujours une chaîne. Ouvertes et écartées : `26954008` (comptoir IKEA à
Berlin, logo IKEA et allemand à l'écran), `32832544` (Burger King, « WHOPPER »),
`12700809` (Tim Hortons en drive), `35195180` et `30151719` (McDonald's),
`19069608/09/12/13` (même snack turc, cartes en turc), `tYAU0T6uytg` sur Unsplash
(signalétique chinoise). Le flou et le voile prévus par la maquette effaceraient
la lisibilité au rendu — mais **le fichier resterait, lui, une photo de marque
concurrente déposée dans `public/`**. On ne l'y met pas.

### Landing `#materiel`, voie « On vous équipe et on installe »

La scène — deux mains fixant une tablette sur son support, imprimante ticket à
côté — n'existe pratiquement qu'en photographie **commanditée par un fabricant de
caisse**, et elle porte alors sa marque. C'est le piège déjà connu : `12935090`
montrait des mains chargeant un rouleau thermique, et l'écran portait le logo
**« imin »** du fabricant, plus « Please scan the QR code » et « TOTAL: 68.88 ».
Vérification faite, **toute la série `12935xxx` est une campagne iMin** (`12935047`
en porte trois occurrences) et **toute la série `37594xxx` une campagne SpotOn**
(`37594412`). Les deux séries sont à considérer comme brûlées.

Les seules alternatives sans marque (`3570235`, `3570241`) sont des terminaux de
paiement photographiés en studio sur fond gris clair, en pleine lumière froide —
et `3570241` ajoute des billets en couronnes tchèques et une interface en tchèque.
La charte tranche : « c'est un critère de SÉLECTION, pas de retouche ».

### Landing `#lancement` — la tablette de commande sur place

Écartée **par le texte, pas par la photo**. Le cadre posé était explicite : cette
image n'est admissible que dans un jalon annonçant noir sur blanc que la tablette
de commande client est **au programme**. Or `MILESTONES` (`content.ts`) contient
quatre jalons — « La démonstration », « La configuration », « On est là », « On
reste » — et **aucun ne mentionne la tablette sur place**, ni au présent ni au
futur. La condition n'est pas remplie ; aucune recherche n'a donc été lancée.

---

## Journal des vérifications

Quarante-huit images ont été téléchargées et **ouvertes une par une**. Motifs
d'exclusion, par fréquence :

1. **Marque tierce lisible** — IKEA, Pepsi, Coca-Cola, McDonald's, Burger King,
   Tim Hortons, KFC, Nando's, A&W, Starbucks, VISA/Mastercard, Mercedes, Nike,
   BAPE, iMin, SpotOn, MackBear, Rocket, eufy, beltur.
2. **Nom d'établissement lisible** — « MAITRE KEBABIER », « SIDE KEBAB »,
   « TAQUERIA ZORRO », « Antalya », « THE WAFFEL TRUCK », « KING OF CHICKEN
   BURGER'S », « PALETAS », « LE 116 ».
3. **Texte en langue étrangère** — turc, allemand, tchèque, russe, chinois,
   portugais, espagnol, slovaque, anglais avec prix en £ ou $.
4. **Prix déchiffrables dans le cadre.**
5. **Dominante froide** — bleu, sarcelle, magenta : incompatible avec `#c9a15a`
   sur noir, quel que soit le voile.
6. **Visage net au premier plan.**

Le cas d'école du chantier reste `12935090` : un titre irréprochable — « des mains
installant un rouleau thermique dans une caisse tactile » — et, à l'ouverture, un
logo de fabricant, une phrase en anglais et un montant à l'écran. **On n'a jamais
écarté une image sur son nom de fichier ; on l'a toujours ouverte.**
