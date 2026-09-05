# L'écran de salle autonome — plan d'exécution

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La coquille de l'écran de salle et les photos de la boucle sont installées sur l'appareil et rejouées sans réseau ; elles ne se renouvellent que quand elles changent.

**Architecture:** Un service worker servi par une route Next sous `/board` (même montage que la carte de fidélité), deux caches versionnés (coquille, médias), un précache commandé par l'affichage à chaque nouvelle empreinte de contenu.

**Tech Stack:** Next 16 (route handler), Service Worker API, Cache API, vitest, Playwright (`e2e/reel`).

**Spec:** `docs/superpowers/specs/2026-09-05-ecran-autonome-design.md`

## Global Constraints

- Plan de travail `scratchpad/wt`, branche `feat/ecran-autonome`. Node 24.20 via nvm dans le PATH.
- Aucune couleur, aucune règle de rendu : ce lot ne touche pas aux scénographies.
- Rien de privé dans un cache : le contenu (`localStorage`) reste où il est ; le worker ne met en cache que la coquille HTML publique, les actifs `_next/static` et des images.
- Commits en français, pied `Co-Authored-By` + `Claude-Session`. Portail `pnpm turbo lint test build` avant PR, fusion squash, sonde, parcours réel.

---

### Task 1 : La route du worker et ses règles pures

**Files:**
- Create: `apps/web/src/app/board/sw.js/route.ts`
- Test: `apps/web/src/app/board/sw.js/route.test.ts`

**Interfaces:**
- Produces: `NOMS_CACHES_ECRAN = { coquille, medias, prefixe }`, `estCheminCoquilleEcran(pathname)`, `estReponseCoquilleEcranCacheable(response, origin)`, `GET()`.

- [ ] Écrire le test : noms versionnés et préfixe commun ; `/board` et `/board/display` (avec ou sans `/` final) sont la coquille, `/board/sw.js` et `/board/x` ne le sont pas ; une réponse redirigée, non HTML ou d'une autre origine n'est pas cacheable ; `GET` rend du JavaScript avec `Service-Worker-Allowed: /board` et `Cache-Control` sans cache.
- [ ] Lancer, échec attendu. Implémenter la route sur le modèle de `r/[slug]/fidelite/sw.js/route.ts` : caches `sm-board:v1` et `sm-board:media:v1`, `install` précache `/board` et `/board/display`, `activate` purge `sm-board:` d'autres versions, `fetch` : navigation coquille → réseau d'abord ; `/_next/static/` → cache d'abord ; `destination === "image"` → cache d'abord dans le cache médias (réponses opaques acceptées) ; `message` `sm-board:precache` → `addAll` des manquantes en `no-cors` puis purge des absentes.
- [ ] Lancer, vert. Commit : `écran de salle : un service worker sous /board, coquille et photos sur l'appareil`.

### Task 2 : L'affichage enregistre le worker et commande le précache

**Files:**
- Create: `apps/web/src/components/board/board-autonomie.ts`
- Test: `apps/web/src/components/board/board-autonomie.test.ts`
- Modify: `apps/web/src/components/board/board-display.tsx`

**Interfaces:**
- Produces: `mediasDuContenu(content: ScreenContent | null): string[]`, `useServiceWorkerEcran(): void`, `precacherMedias(urls: string[]): void`.

- [ ] Test de `mediasDuContenu` : photos de toutes les scènes, logo de l'en-tête, quatre emplacements du masque, dédoublonnés, `null`/vide/`data:` ignorés, contenu `null` ⇒ liste vide.
- [ ] Implémenter ; `useServiceWorkerEcran` enregistre `/board/sw.js` avec portée `/board` et se tait en cas d'échec ; `precacherMedias` poste le message au contrôleur, ou à `ready.active`.
- [ ] `BoardDisplay` : `useServiceWorkerEcran()` ; effet sur `content?.contentHash` ⇒ `precacherMedias(mediasDuContenu(content))`.
- [ ] Typage, lint, tests. Commit : `écran de salle : les photos de la boucle sont précachées à chaque contenu frais`.

### Task 3 : Le parcours réel hors ligne

**Files:**
- Create: `e2e/reel/ecran-hors-ligne.test.mjs`
- Modify: `e2e/README.md`

- [ ] Écran créé par l'API (`scenography: "ardoise"`), suppression notée ; ouverture de `${web}/board?code=<code>` ; attendre `/board/display` et une couche qui n'est pas la plaque de chargement ; attendre `navigator.serviceWorker.ready` et `caches.open("sm-board:v1").match("/board/display")` ; `context.setOffline(true)` ; `page.reload()` ; attendre à nouveau une couche de scène ; `setOffline(false)` ; suppression.
- [ ] Lancer contre staging après déploiement. Commit : `e2e : l'écran de salle continue sans réseau`.

### Task 4 : Portail, PR, fusion, staging

- [ ] `pnpm turbo lint test build` vert (paire `EXPO_PUBLIC_*` exportée).
- [ ] Push, PR vers `develop`, CI verte, fusion squash, sonde `SM_REVISION_ATTENDUE`, parcours réel hors ligne contre staging, compte rendu.
