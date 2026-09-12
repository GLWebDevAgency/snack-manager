# Commande, fidélité, livreur — comparaison et finition V2

Branche `refactor/ui-handoff-fidelity`, base `develop` `a01f857`. Ce lot prolonge les applications en place après la correction des icônes. Il ne remplace aucune surface par le studio.

## Références et décisions

Captures du kit inspectées : `online-menu.png`, `online-product.png`, `loyalty-card.png`, `courier-tour.png`, `courier-account.png` dans `design/refonte-swiftui/maquettes/captures/`. Les prompts 06, 07, 08, la charte et le handoff ont guidé la comparaison avec les routes Next réelles.

Le kit propose une hiérarchie calme, des cartes opaques et des contrôles séparés. Les identités des restaurants restent prioritaires : le masque Brasserie conserve notamment sa palette crème/rouge, sa police et sa forme ; les masques sombres gardent leurs propres couleurs. Aucun accent, rayon ou visuel de produit n’a été déduit de son nom. Les cartes livreur conservent les trois formes restaurant `net`, `doux`, `rond`, même si elles sont moins rondes que l’exemple générique du kit.

- **Commande** : le visuel réel de la fiche produit est contenu dans un plateau en retrait, sans voile décoratif. `photoCover` et le comportement d’absence de média restent inchangés. Les options radio/checkbox sont des contrôles distincts de 56 px au moins, avec contour de sélection et focus. Les choix restent sur une colonne pour préserver les libellés et suppléments longs ; les règles, groupes, limites, exclusions, prix et édition de ligne restent ceux du modèle existant. La géométrie sticky et les seuils de grille du catalogue ne changent pas.
- **Fidélité** : les récompenses partagées entre la carte réelle et la démo présentent le coût à droite et leur description en dessous. La taille des titres/descriptions est améliorée ; à 320 px la description reprend toute la largeur disponible. L’état Acquise, la fête, les unités et le coût utilisent les mêmes valeurs et règles. Solde, QR, consentements, stockage et droits restent intacts. La démo ne gagne ni vrai QR de fidélité ni faux compte.
- **Livreur** : titre de page et compte à 30 px ; carte « Commande #… », état, délai, adresse et indices de paiement/consigne séparés, filet de statut supérieur. L’accès à la mission reste l’unique bouton de carte. La destination restaurant utilise `store`, et les libellés de thème clair/sombre utilisent les vecteurs soleil/lune. Le choix Système est textuel : aucune icône d’appel téléphonique ne lui est attribuée.
- **Apparence livreur** : un groupe opaque réunit Clair/Sombre/Système et deux préférences locales, Réduire les mouvements et Réduire la transparence. Les anciens réglages son, vibration, navigation et écran allumé, l’accès et l’installation restent présents. Les nouvelles valeurs s’ajoutent à `sm.delivery.preferences.v2` ; les anciens champs sont conservés et les booléens sont validés indépendamment. Les formes ne sont jamais enregistrées comme préférence du livreur.
- **Navigation partagée** : deux options facultatives de `SMTabBar` et une option du hook de transition purement visuel raccordent les préférences. La réduction locale s’ajoute au réglage système, elle ne peut pas le désactiver. Les transitions JS, retaps et transitions CSS respectent cette réduction ; la transparence réduite supprime le flou et utilise la surface opaque du thème. Les couleurs forcées du navigateur restent prioritaires. Les autres appelants conservent leurs valeurs par défaut.

## Fichiers

- `apps/web/src/app/livreur/{delivery-access.tsx,delivery-missions.tsx,delivery-preferences.tsx,livreur.css}`.
- `apps/web/src/app/livreur/{delivery-brand-shape.browser.test.tsx,delivery-preferences.browser.test.tsx}`.
- `apps/web/src/components/ui/SMTabBar.{tsx,hooks.ts,module.css,browser.test.tsx}`.
- `apps/web/src/components/order/{ProductSheet.tsx,product-configuration.module.css}`.
- `apps/web/src/components/loyalty/{carte-visuelle.tsx,carte-visuelle.module.css}`.
- `e2e/local/refonte-web-visual.mjs` : variante 320 px facultative, contrôle des préférences, persistance, libellés entiers et surface de navigation réellement opaque.

## Preuves exécutées

- **108/108 tests PASS, 11 fichiers**, sans parallélisme de fichiers : `preuves/client-v2-tests-final.log`. Ils couvrent les reprises de départ livreur, les permissions/refus/réponses incertaines existants, les six couples forme/thème, la relecture de marque, le stockage des préférences, audio/veille/historique, navigation au clavier/scrub/retour navigateur, configuration et édition produit à 320/390 px, retraits, options et prix, catalogue étroit, raccord sticky, paliers et gardes de session fidélité.
- **12/12 tests de navigation rejoués PASS** après le dernier ajustement de couleurs forcées : `preuves/client-v2-navigation-final.log`. Ces 12 tests font partie des 108, ils ne s’y ajoutent pas.
- **Typecheck web PASS** : `preuves/client-v2-typecheck.log`. Ce passage inclut aussi les back-offices V2 et les autres changements présents dans le worktree à cet instant.
- Avant : **12 scénarios PASS**, `captures/web-client-v2-avant`, `preuves/client-v2-visuel-avant.log`.
- Après final : **18 scénarios PASS, 54 captures**, `captures/web-client-v2-final`, `preuves/client-v2-visuel-final.log`. Trois surfaces × deux apparences × 1440/390/320 px. Vraies routes `/r/demo`, `/r/demo/fidelite`, `/livreur` du serveur Next local 3093 ; données démo/fixtures exclusivement locales et requêtes externes bloquées.
- Le parcours commande sélectionne la Galette payante et vérifie le panier à 8 €. Le parcours fidélité conserve le lien de commande démo. Le parcours livreur ouvre la mission, la ferme par Escape, change les deux préférences, recharge et vérifie leur application, y compris sans réduction système et avec la surface du bon thème. Aucune mutation HTTP livreur n’est autorisée dans ce harnais.
- Inspection des captures : mission livreur mobile claire ; Apparence à 390 px clair et 320 px sombre ; fiche produit claire 390 px et sombre 320 px ; fidélité claire 390/320 px et sombre desktop. Le contrôle a détecté puis corrigé les mots Sombre/Système coupés à 320 px.

Les captures exposent les vrais états de fixture : le retard de mission est calculé depuis sa date de recette, sans falsifier le délai. Les captures Next dev portent le petit marqueur de développement. Aucun appel, SMS, départ, remise ou paiement réel. Aucun compte de production, aucune mise à niveau, aucun push, fusion ou déploiement. Le build global web et sa recette après compilation sont coordonnés avec root après arrêt du serveur dev ; ils constituent une preuve distincte. Aucun essai sur appareil iOS/Android ni WebKit dans ce lot.

Serveur dev local 3093 démarré par cet agent arrêté après la recette ; le build Next global peut être lancé par root sans concurrence sur `.next`.

Validation compilée du gel avant PR178 : **2 915 tests PASS sans skip, typecheck et lint PASS, build Next PASS, 26 parcours PASS et 76 captures**. Voir [VALIDATION-WEB-V2.md](VALIDATION-WEB-V2.md). Ces preuves ne couvrent pas l’adaptation à PR178 demandée ensuite.
