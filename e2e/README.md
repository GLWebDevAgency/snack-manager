# Tests de bout en bout — « est-ce que ça MARCHE ? »

`scripts/smoke.mjs` répond « est-ce que ça RÉPOND ? ». Ce dossier répond à
l'autre question, celle qui coûte de l'argent à un commerçant quand la réponse
est non.

Une régression qui casse la prise de commande sert des pages 200 avec le bon
titre. Elle passe le typage, l'analyse statique, les tests unitaires, la
compilation, le déploiement et le contrôle de santé. Puis elle arrive chez un
restaurant en plein service.

---

## Lancer

```bash
pnpm e2e                 # tout, contre staging
pnpm e2e:demo            # seulement ce qui tourne sur fixture (≈ 3 s)
pnpm e2e:reel            # seulement ce qui touche une vraie API (≈ 70 s)
pnpm e2e:local           # contre les serveurs de développement
pnpm e2e:navigateur      # installe Chromium (une fois)
```

Surcharges utiles :

| Variable | Effet |
|---|---|
| `SM_E2E_CIBLE` | `staging` (défaut) · `production` · `local` |
| `SM_E2E_WEB` `SM_E2E_POS` `SM_E2E_KDS` `SM_E2E_API` | viser une seule surface ailleurs |
| `SM_E2E_TETE=1` | ouvrir une vraie fenêtre pour regarder le scénario se jouer |
| `SM_E2E_DELAI` | plafond d'une attente d'écran (défaut 30 000 ms) |
| `SM_E2E_DELAI_PROPAGATION` | plafond d'attente du cache de la vitrine (défaut 120 000 ms) |

---

## Les parcours

| Fichier | Ce qu'il prouve | Durée mesurée |
|---|---|---|
| `demo/caisse.test.mjs` | produit, option **requise**, supplément payant, retrait d'ingrédient, ajout au ticket, encaissement espèces, **rendu de monnaie**, numéro de retrait confirmé par le serveur | ≈ 1,7 s |
| `demo/cuisine.test.mjs` | un ticket du comptoir arrive au passe et avance : accepter → prêt, colonnes à jour | ≈ 1,5 s |
| `demo/commande-en-ligne.test.mjs` | le parcours client complet **sur 390 px**, de la carte au numéro de retrait | ≈ 2,4 s |
| `demo/back-office.test.mjs` | un prix changé est **enregistré et relu**, et `?demo=1` survit à la navigation interne | ≈ 1,5 s |
| `reel/prix-public.test.mjs` | connexion réelle → changement de prix → **le client le voit sur la vitrine** | ≈ 8 s |
| `reel/suspension.test.mjs` | un restaurant suspendu **ne peut plus ouvrir sa caisse**, et **son site se ferme proprement** | ≈ 62 s |
| `reel/ecran-hors-ligne.test.mjs` | un écran appairé par son adresse de démarrage, **le réseau coupé, la page rechargée, la carte encore affichée** | ≈ 20 s |
| `reel/ecran-apparence.test.mjs` | un écran créé, son tiroir « Apparence », **un téléviseur miniature qui joue sa boucle**, une scénographie changée puis **relue par l'API** | ≈ 15 s |

Les totaux ne sont pas « vérifiés à l'absence d'erreur » : chaque montant est
comparé au centime, à chaque étape qui le recalcule. Un supplément perdu entre
le panier et la caisse fait tomber le test en nommant l'écart.

---

## Deux séries, deux régimes

**`demo/`** joue les démonstrations `?demo=1`, qui tournent **entièrement dans le
navigateur** sur une fixture figée. Aucun compte, aucune base, aucun état
partagé entre exécutions — donc aucune fragilité, et les fichiers s'exécutent en
parallèle.

**`reel/`** exige une vraie API : suspendre un établissement et voir un prix
ressortir côté client ne se simulent pas. Ces scénarios **écrivent dans une
vraie base**, tournent **en file**, et **remettent le parc en état** — vérifié,
pas supposé. Sans identifiants, ils s'annoncent **IGNORÉS** avec leur raison et
la série reste verte.

Identifiants lus dans l'environnement, jamais écrits ici : `SEED_ADMIN_PASSWORD`
et `CAPTURE_OWNER_PASSWORD` (le `.env` racine les fournit en local, les secrets
`SM_E2E_MDP_EQUIPE` / `SM_E2E_MDP_GERANT` en intégration continue).

---

## La règle qui tient tout : on n'attend jamais une durée

`waitForTimeout` est absent de tous les scénarios. On attend un **état de
l'écran** — un bouton qui apparaît, un montant qui s'affiche, une carte qui
quitte sa colonne. Une durée fixe est fausse dans les deux sens : trop courte
elle rougit sans panne, trop longue elle fait payer l'attente à toutes les
exécutions.

Deux exceptions, toutes deux documentées à leur emplacement :

- `cliquerJusqua` réessaie un clic tant qu'il ne produit pas son effet — c'est la
  seule parade à l'hydratation d'une page Next.js, où rien dans l'écran ne
  distingue « pas encore interactif » de « interactif » ;
- `rechargerJusqua` sonde la vitrine publique, servie avec un cache de 60 s
  (`SITE_TTL`) qu'aucun état du navigateur ne peut annoncer.

---

## Quand un test tombe

Chaque échec dépose dans `e2e/rapports/` (non versionné) :

- `<scénario>.png` — la capture pleine page au moment de la chute ;
- `<scénario>.txt` — l'arbre d'accessibilité, l'adresse, les erreurs de console.

En intégration continue, ces fichiers partent en artefacts de l'exécution.

Un scénario qui échouerait **au hasard** n'a pas sa place ici : il apprend à
ignorer le rouge. Retirez-le et signalez-le plutôt que de le laisser clignoter.

---

## Le filet sous la remise en état

Un `Ctrl-C` ou un runner coupé entre l'écriture et la restauration laisserait le
parc modifié. Avant toute écriture, le scénario note le geste inverse dans
`e2e/rapports/parc-a-remettre.json` ; la prochaine exécution le rejoue avant de
lire quoi que ce soit, bruyamment. C'est arrivé pendant la mise au point de ce
dossier — un prix resté à 7,63 € sur staging.

---

## Intégration continue

`.github/workflows/e2e.yml` — déclenché quand « Déploiement » a fini en vert sur
`develop` ou `main`, ou à la main (`workflow_dispatch`). Sur `main`, seules les
démonstrations sans secret et sans écriture sont jouées automatiquement ; le
parc réel reste strictement limité à staging.

⚠️ **Il ne fait pas encore échouer le déploiement** : il tourne à côté, après.
Le rendre bloquant tient en trois lignes dans `deploy.yml`, que ce workflow
prévoit déjà (`workflow_call`) — voir l'en-tête de `e2e.yml`.

La production a d'abord été validée par `workflow_dispatch` avec les quatre
démonstrations vertes. Ce passage manuel est la condition préalable à toute
évolution future de la série automatique ; il ne donne jamais l'autorisation
de lancer les scénarios du parc réel en production.
