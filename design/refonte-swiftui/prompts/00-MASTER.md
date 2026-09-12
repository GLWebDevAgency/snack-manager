# Mission maîtresse — refonte UI sans régression

Tu travailles dans GLWebDevAgency/snack-manager. Lis le HEAD de develop, les branches/PR en cours, ce dossier, le manifeste des écrans et les fichiers ACTUELS. La base de référence de ce kit est 2c879899adc0e7c3b98817ef76cf026ea5d22bf8. Ne supposes pas que le graphe de commits indique l’intégration fonctionnelle.

But : appliquer la direction visuelle Apple/RestoPilot du studio aux applications existantes Expo/React Native et Next.js, sans migration de framework, sans modification de backend, de schéma, de contrat, de prix, de paiement, de disponibilité, de droits ou de logique offline. La maquette est une référence visuelle, jamais une source de vérité métier.

Avant d’écrire : inventorie routes, props, handlers, formulaires, raccourcis, variantes, paramètres, gardes, états asynchrones, refus, erreurs et tests de la surface. Complète docs/PARITE.csv. Capture l’écran existant. Toute fonctionnalité absente de la maquette doit être conservée et recevoir le même système visuel.

Implémente d’abord les adaptateurs, puis les primitives contrôlées, puis les compositions. Garde les providers, hooks métier, clients API, journal, tokens de session, modales, file offline, politiques de photo et réconciliation existants. Ne copie aucun fichier studio dans apps. Ne remplace pas les tests par des snapshots moins stricts. Ne change aucune version sans chantier séparé justifié.

Pour chaque lot : petite PR, chemins explicites, rapport avant/après, tests existants + tests ajoutés, thème clair/sombre, 390/768/1024/1440 px, réduction de mouvement/transparence, clavier/focus, zoom texte, erreurs et reprise. Sur native, inclure rotation, clavier logiciel et appareils iOS/Android. Un typecheck syntaxique ou un screenshot DOM ne vaut pas une recette native.

Ne prétends pas qu’un paiement, crédit fidélité, départ ou livraison a réussi avant son acquittement métier. Le KDS prêt reste passif. Ne crée pas de seconde intention pour réessayer une opération incertaine. Affiche la fraîcheur réelle des données.

La sortie doit préciser ce qui a été modifié, ce qui reste inchangé, les preuves exécutées et les blocages. Ni fusion, ni déploiement, ni promotion de dépendance automatique. Si une garantie n’est pas vérifiée, indique-la au lieu d’inventer un succès.
