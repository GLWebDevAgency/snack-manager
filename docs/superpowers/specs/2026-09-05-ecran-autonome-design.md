# L'écran de salle autonome — téléchargé une fois, rejoué sans réseau, mis à jour quand ça change

*Spec de conception · 5 septembre 2026 · approche validée en séance*

## 1 · La décision

Le Menu Board n'est pas une vidéo : c'est une scénographie calculée sur la clé HDMI à partir de quelques kilooctets de données et des photos de la carte. Ce modèle est le bon, et il a déjà sa moitié : le jeton d'appairage et le dernier contenu sont gardés sur l'appareil, un battement de cœur par minute ne rapporte qu'une empreinte, le contenu complet ne se retélécharge que si elle a bougé.

Il lui manque l'autre moitié : **l'application elle-même et les photos ne sont pas stockées sur la clé.** Au démarrage à froid sans réseau, le code vient du serveur, et les photos passent par un cache navigateur qui ne promet rien. Cette spec les installe sur l'appareil, une fois, et ne les renouvelle que quand elles changent.

| Question | Décision | Pourquoi |
|---|---|---|
| Des fichiers vidéo par écran ? | **Non.** | Cinq minutes de 1080p par écran et par changement de prix, des minutes de calcul, et un écran qui ne suit plus la carte dans la minute. |
| Où vit la coquille ? | **Un service worker sous `/board`** | Le même mécanisme que la carte de fidélité installable, déjà dans le dépôt. Le code, les feuilles et les polices sont servis depuis l'appareil. |
| Et les photos ? | **Précachées à chaque changement d'empreinte, servies cache d'abord** | Les adresses de la médiathèque sont immuables (empreinte SHA-256 dans l'adresse) : une photo changée est une adresse nouvelle, une adresse connue ne change jamais. |
| Le contenu ? | **Inchangé** : `localStorage` | Quelques kilooctets, déjà rejoués avant tout réseau. |

## 2 · Périmètre

**Dedans.** La route `/board/sw.js` et son worker. L'enregistrement depuis l'affichage. Le précache des médias de la boucle à chaque contenu frais, avec purge de ce qui n'y est plus. Les tests des règles pures. Un parcours réel qui coupe le réseau et vérifie que l'écran continue.

**Dehors.** La notification poussée par le serveur (la minute reste la promesse). Les scènes vidéo. Une application native pour téléviseur.

## 3 · Le worker — `apps/web/src/app/board/sw.js/route.ts`

Servi comme la carte de fidélité : une route qui rend le script, `Service-Worker-Allowed: /board`, jamais mis en cache HTTP. Portée `/board`.

Deux caches, versionnés par une constante :

- `sm-board:v1` — **la coquille** : `/board` et `/board/display` (navigations, réseau d'abord, cache en repli, seules les réponses HTML de notre origine et non redirigées sont écrites) ; `/_next/static/*` (cache d'abord, immuable par construction).
- `sm-board:media:v1` — **les photos** : toute requête dont la destination est `image`, cache d'abord, réseau en repli avec écriture. Les réponses opaques (photos servies par l'API, autre origine) sont acceptées : une image demandée par `<img>` est une requête `no-cors`, et une réponse opaque se sert telle quelle.

Un message `{ type: "sm-board:precache", urls: string[] }` déclenche l'ajout de toutes les adresses manquantes (requêtes `no-cors`) puis la **purge** des entrées absentes de la liste : le cache ne grandit pas avec l'historique de la carte.

`install` précache la coquille et passe en attente courte (`skipWaiting`) ; `activate` supprime les caches d'anciennes versions et prend les clients. Une nouvelle version du worker ne casse rien : les actifs sont adressés par URL, la page en cours garde les siens jusqu'au rechargement de nuit.

## 4 · L'affichage — `components/board/board-autonomie.ts`

- `mediasDuContenu(content: ScreenContent): string[]` — pure : toutes les `photoUrl` de toutes les scènes, le `logoUrl`, les quatre emplacements de logo du masque, dédoublonnés, adresses absolues ou relatives à notre origine seulement.
- `useServiceWorkerEcran()` — enregistre `/board/sw.js` au montage de l'affichage ; silencieux si l'appareil ne sait pas.
- `precacherMedias(urls)` — envoie le message au worker actif, s'il y en a un.

`BoardDisplay` appelle le premier au montage et le second à chaque nouvelle empreinte de contenu.

## 5 · Tests

- Route : les noms de cache, la reconnaissance de la coquille, la cacheabilité d'une réponse, l'en-tête `Service-Worker-Allowed`.
- `mediasDuContenu` : dédoublonnage, adresses ignorées (`data:`, vides), logos du masque.
- Bout en bout réel : un écran est créé, appairé par l'adresse de démarrage, joue une scène ; le worker et le précache sont prêts ; le réseau est coupé ; la page est rechargée ; **une scène s'affiche encore** ; le réseau revient ; l'écran est supprimé.
