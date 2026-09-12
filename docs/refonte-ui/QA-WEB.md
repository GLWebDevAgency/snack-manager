# Recette visuelle web — avant et après

Ces captures montrent les routes Next existantes avant leurs traitements de surfaces. Elles ne constituent pas un export pristine du commit initial : les icônes partagées étaient déjà en cours d'intégration. Le serveur Next dev du root (`http://127.0.0.1:3092`, session 50217) est utilisé ; aucun `next build` n'a été lancé pendant son fonctionnement.

`apps/web/AGENTS.md` a été lu et préservé. Le manifeste web et les recettes existantes `e2e/demo/commande-en-ligne.test.mjs`, `e2e/demo/back-office.test.mjs`, les fixtures navigateur livreur et les sources de routes ont été lus. Cette première phase de capture ne modifiait aucun fichier applicatif. L'intégration suivante est décrite dans les documents de lots.

## Isolement et données

- Commande : `/r/demo?demo=1`, transport de démonstration existant, produits/photos/options du dépôt. La route répond 404 sans le paramètre explicite ; aucune base ni Stripe n'intervient.
- Fidélité : `/r/demo/fidelite?demo=1`, composants visuels partagés avec la vraie carte et valeurs fictives existantes. Cette capture ne prouve pas le flux sécurisé de carte/QR réel.
- Livreur : `/livreur`, accès et mission n°12 repris des fixtures de `delivery-missions.browser.test.ts`. Les dates fixes de cette fixture expliquent son retard important à la date de capture ; aucun trajet réel n'est inventé ni effectué.
- Restaurant : `/admin/dashboard?demo=1`, vrai dashboard et transport de démonstration existant.
- Snack Manager : `/sm`, vraie coque avec JWT local factice de rôle sm_admin et réponses CRM vides conformes à la forme du contrat. Tous les chiffres nuls décrivent cette fixture locale, jamais l'état du parc réel.

Le harnais `e2e/local/refonte-web-visual.mjs` bloque les origines externes, ferme les WebSockets hors du serveur Next local, bloque les service workers et intercepte tous les endpoints livreur/API utilisés. Les mutations de ces fixtures sont refusées avec 405 ; seul le panier de démonstration est modifié. Contextes Playwright jetables, aucune session réelle. Le HMR Next loopback reste accessible.

## Exécution

```sh
REFONTE_PHASE=avant-surfaces /Users/limameghassene/.nvm/versions/node/v24.20.0/bin/node e2e/local/refonte-web-visual.mjs
```

Résultat : **12/12 scénarios réussis**, 24 captures dans `captures/web-avant-surfaces/`, détail `resultats.json`. Playwright Chromium 1.62.1 déjà installé ; plugin Browser/skill browser absent. Aucun package installé.

| Surface | Tailles/thèmes exécutés | Parcours réellement vérifié |
| --- | --- | --- |
| Commande | 1440×1000, 390×844, marque de démo par défaut | Carte → Kebab → option Galette → total 8,00 € → panier |
| Fidélité | 1440×1000, 390×844, apparence de démo par défaut | Solde/récompenses rendus ; lien Commander conserve `/r/demo?demo=1` |
| Livreur | 1440×1000, 390×844, sombre et clair | Accès associé → missions → détail n°12 → Escape → paramètres compte |
| Restaurant | 1440×1000, 390×844, apparence de démo par défaut | Dashboard Aujourd'hui avec données de démo |
| Snack Manager | 1440×1000, 390×844, thème existant | Coque/identité/navigation/KPI et états vides du dashboard local |

Les douze pages ont un titre et une URL attendus, du contenu significatif, aucune exception JS et aucun débordement horizontal de page. Les quatre scénarios livreur produisent chacun le seul avertissement attendu « Service Worker registration blocked by Playwright ». Les autres consoles sont sans avertissement/erreur. Aucune origine externe n'a été requise dans ces parcours ; la règle de blocage est néanmoins installée.

Le premier essai HQ a mis en évidence deux propriétés manquantes dans le fixture `founderSeats` (`clients`, `reserved`) ; le fixture a été complété d'après `CrmOverview`. Aucun code produit n'a été assoupli. Le harnais complet a ensuite été rejoué avec succès.

Captures réellement regardées avec l'outil image : carte commande desktop, panier commande mobile, fidélité mobile, missions livreur mobile clair, détail livreur mobile sombre, restaurant desktop, Snack Manager desktop et mobile.

## Limites

Le PIN/identité réelle, compte client, consentements, carte/QR fidélité sécurisé, scan caméra, checkout intégral/créneaux/Stripe/reprise incertaine, départ/remise/incident livreur, historique paginé et mutations des back-offices ne sont pas exécutés par ce harnais. Les écrans secondaires, tableaux chargés de données CRM, tous les masques de marque, appareils natifs et lecteurs d'écran restent à vérifier. Les thèmes des surfaces tenant proviennent de la marque ; ils n'ont pas été artificiellement remplacés par une préférence système dans ces captures.

Les tests/typecheck/build web sont suivis par le root et ne sont pas déclarés réussis ici. Après intégration, rejouer ce harnais avec une phase après distincte, compléter les thèmes/largeurs nécessaires aux surfaces modifiées et regarder les captures.

## Recette après intégration

Commande :

```sh
REFONTE_PHASE=apres-surfaces /Users/limameghassene/.nvm/versions/node/v24.20.0/bin/node e2e/local/refonte-web-visual.mjs
```

Le harnais après ajoute le masque de démo Brasserie clair pour commande et fidélité (en plus du masque par défaut), une capture du catalogue sous les incontournables, la navigation Équipe et son formulaire membre dans le back-office restaurant, puis la navigation Prospection et le formulaire nouveau prospect dans Snack Manager. Les vues desktop et mobile restent séparées. Aucun formulaire n'est enregistré.

La recette HQ a détecté un défaut de retour du focus préexistant : l'effet de `HqDrawer` mémorisait le champ `autoFocus` déjà monté au lieu du bouton déclencheur. L'échec est conservé dans `preuves/web-visuel-apres-focus-hq-avant.log`. Le root a corrigé cette couche de dialogue via `useDialogLayer`, avec isolation temporaire du focus ; la garde de brouillon et l'historique sont conservés. La recette finale vérifie désormais avec succès que le brouillon survit à Échap, au retour navigateur et au clic sur le fond desktop, que 16 tabulations restent dans le tiroir et qu'Annuler rend le focus au bouton, sur desktop et mobile.

**Résultat final : 16/16 scénarios réussis, 42 captures**, listées dans `captures/web-apres-surfaces/resultats.json`. Log : `preuves/web-visuel-apres.log`. Zéro exception JavaScript, zéro débordement horizontal de page, aucune requête vers une origine externe (règle de blocage installée). Les quatre consoles livreur présentent chacune le seul avertissement attendu de service worker bloqué ; toutes les autres consoles sont sans avertissement/erreur. Les anciens fichiers `*-failure` documentent l'essai de focus HQ et ne sont pas comptés dans les 42 captures finales.

| Surface | Tailles et thèmes après | Parcours supplémentaire réellement exécuté |
| --- | --- | --- |
| Commande | 390×844 et 1440×1000, masque par défaut et Brasserie clair | Catalogue, option Galette, total 8 €, panier ; photo et prix natifs du dépôt |
| Fidélité | 390×844 et 1440×1000, masque par défaut et Brasserie clair | Solde/récompenses et lien Commander de la démo partagée |
| Livreur | 390×844 et 1440×1000, sombre et clair | Missions, détail, fermeture Escape, compte |
| Restaurant | 390×844 et 1440×1000, thème du back-office | Dashboard → navigation Équipe → formulaire membre, saisie locale, Tab/Shift+Tab, Escape puis retour focus ; volet Plus mobile |
| Snack Manager | 390×844 et 1440×1000, thème du back-office | Dashboard → Prospection → nouveau prospect, champ et garde de brouillon, clavier et retour focus ; feuille Plus mobile |

Captures après réellement inspectées : commande mobile clair carte/configuration, catalogue mobile sombre et desktop clair ; fidélité mobile sombre et desktop clair ; livreur mobile clair missions ; restaurant desktop dashboard et mobile formulaire ; Snack Manager desktop et mobile formulaire. Les contenus sont lisibles dans ces cadres ; les formes et polices tenant restent distinctes. Cette inspection ne vaut pas une preuve de toutes les routes ni de tous les états serveur.

Le serveur de développement 3092 peut être arrêté après cette recette pour le build coordonné par le root. Aucun processus inconnu n'a été arrêté par ce harnais.

Les captures de développement comportent l'indicateur Next en bas à gauche. Il provient du serveur de recette et ne fait pas partie du produit exporté.


## Validation du build compilé

Après arrêt de Next dev, `NEXT_PUBLIC_API_URL=http://localhost:3001 API_URL=http://localhost:3001 NEXT_TELEMETRY_DISABLED=1 pnpm --filter @sm/web build` a réussi (Turbopack et TypeScript, 62 pages statiques). `next start --hostname 127.0.0.1 --port 3092` sert ce build local.

Root a rejoué `REFONTE_PHASE=build-final node e2e/local/refonte-web-visual.mjs` : **16/16**, **42 captures** dans `captures/web-build-final`, aucune exception JS, aucun débordement horizontal. Seuls quatre avertissements attendus de service worker bloqué sont présents pour Livreur. Root a inspecté aussi le formulaire Nouveau prospect mobile de cette version compilée.

Suite web complète `pnpm --filter @sm/web test --no-file-parallelism` : **185 fichiers, 2 861 tests réussis** en 286,55 s. Typecheck complet réussi ; ESLint des 19 fichiers TypeScript/TSX modifiés : 0 erreur, 0 avertissement. Journaux : `preuves/web-{tests,typecheck,build}-final.log`, `web-visuel-build-final.log`, `web-eslint-fichiers-modifies.log`.
