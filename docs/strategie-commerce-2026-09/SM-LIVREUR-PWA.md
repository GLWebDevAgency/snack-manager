# SM Livreur — installation et accès téléphone

Demande du 8 septembre 2026. Lot en préparation sur `codex/sm-livreur-pwa`,
après la continuité des sessions #140 et le correctif de créneaux #141.
La préparation locale n'est pas une livraison staging ni une installation sur téléphone physique.
Revue indépendante sans bloqueur ; suite web locale complète : **1 913/1 913**.
Typage et lint ciblé verts. Next réel sur `127.0.0.1:3100` : **11 contrôles passés**
aux largeurs 320/390/1440, captures inspectées, manifeste parsé par Chromium,
worker activé, rechargement hors ligne puis reconnexion explicite. L'unique
erreur console attendue est le `503` du document hors réseau provoqué par le test.
Ces preuves ne comportent aucune association, mission ou dépense réelle.

## Parcours retenu

1. Le gérant attribue l'accès livreur depuis le back-office et transmet son
   invitation personnelle, selon le protocole [L2.1](ACCES-LIVREUR.md).
2. Le livreur ouvre `/livreur` sur l'origine plateforme utilisée par le lien.
   L'application porte le nom **SM Livreur**, conserve la charte SnackManager et
   propose une installation secondaire, sans empêcher l'association ni les missions.
3. Quand le navigateur fournit une véritable invitation d'installation, le
   bouton la déclenche après un geste. Sinon, une aide explique le menu du
   navigateur ; iPhone/iPad reçoivent l'indication Safari → Partager → écran d'accueil.
   Aucun refus ni absence d'événement ne devient une installation supposée.
4. Depuis l'application déjà installée, **Coller mon invitation** permet de
   préparer un lien sans quitter l'app. La confirmation **Associer ce téléphone**
   reste distincte ; le serveur puis une nouvelle lecture du cookie confirment l'accès.
5. À chaque réouverture, l'accès et les missions sont revérifiés. Le gérant garde
   la révocation et les attributions existantes ; installation ≠ droit d'accès.

Le collage ne transfère pas une session depuis Safari ou un autre navigateur.
Si le lien y a déjà été consommé et que l'app n'est pas reconnue, demander une
nouvelle invitation au gérant. WebKit documente une copie initiale des cookies à
l'installation depuis iOS 17.2, puis des contextes séparés : ce comportement
ne remplace pas notre contrôle serveur ni une recette physique.
[Source WebKit](https://webkit.org/blog/14787/webkit-features-in-safari-17-2/).

## Frontières techniques

- Manifeste propre `/livreur/manifest.webmanifest` : nom court et complet
  `SM Livreur`, `id`, `start_url` et `scope` stables `/livreur`, affichage
  `standalone`, icônes de marque existantes 192/512 et masque séparé. Aucun lien
  d'invitation, compte, téléphone, tenant ou mission dans ce document public.
  Le manifeste vitrine reste `browser` ; les domaines restaurant ne deviennent
  pas des points d'installation de la marque plateforme.
- Worker `/livreur/sw.js`, portée autorisée `/livreur`. Les seuls événements
  fetch traités sont les navigations GET exactes `/livreur` et `/livreur/` sur
  la même origine. Les routes accès, missions, preuves de remise, API et RSC
  restent hors interception, même lorsqu'elles sont visitées comme documents.
- **Aucun cache de données privées, aucune file de départ/remise hors ligne,
  aucun rejeu automatique.** Si la navigation échoue après activation du worker,
  un document statique autonome indique « Connexion nécessaire ». Il ne contient
  aucun nom, adresse, ancien statut ou actif réseau. Réponse `503`, `no-store`,
  `no-referrer`, scripts interdits. Une erreur HTTP du serveur n'est pas remplacée
  par ce repli. Le retour en ligne se fait par un geste explicite.
- L'import manuel valide une URL absolue HTTPS de la même origine, son chemin
  exact, l'absence de query/userinfo et le fragment strict. Ni navigation vers
  l'URL collée, ni accès automatique au presse-papiers, ni stockage du secret.
  Le champ est effacé après traitement/fermeture ; le secret reste dans la closure
  de la tentative existante. Aucun jeton de session dans le JavaScript.
- Le client refuse l'import pendant lecture, session existante, association
  incertaine ou déconnexion incertaine. L'absence de session doit être confirmée,
  pas déduite d'une panne. Le même échange incertain conserve son token et son
  nonce. Ces gardes d'interface ne remplacent pas les autorisations serveur.

## Recette et limites

Le lot doit passer : manifestes et règles du worker, vrai worker Chromium avec
perte/retour réseau, absence de CacheStorage, événements d'installation contrôlés,
collage strict, association BFF/cookie/reload sur API de fixture, régressions des
missions et rendu aux largeurs 320/390/1440. Une passe Next locale contrôle aussi
le manifeste réellement rendu et parsé par Chromium. Les résultats exacts sont
consignés dans la PR, puis reliés à la révision effectivement servie sur staging.

Restent obligatoires avant de promettre une compatibilité terrain certifiée :

- Android et iPhone physiques : installer, fermer, relancer depuis l'icône,
  associer dans ce contexte, retrait d'accès par le gérant, reconnexion et mode avion.
- Tester la version réelle du navigateur, l'affichage des icônes et la gestion
  de la session à l'installation. Un événement simulé n'est pas un dialogue OS validé.
- Valider la chaîne commande → mission → départ → remise avec les intervenants
  et les données de recette autorisées. Ce lot ne prétend pas refaire cette recette.

Pas de notifications push, GPS en arrière-plan, transfert inter-origines, ni
confirmation de remise sans réseau ajouté implicitement. Aucune migration,
nouvelle dépendance, dépense SMS ou modification d'accès réel. Flux de livraison :
PR → develop → staging ; production uniquement après recette et GO distinct.
