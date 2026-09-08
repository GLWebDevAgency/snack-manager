# Identité client privée — stockage du pilote fermé

Ce package fournit des transactions PostgreSQL, pas une route ou une activation
Twilio. Il utilise le pool runtime partagé et ne possède ni identité POS/KDS, ni
carte fidélité, ni association aux anciennes commandes. Le parent fournisseur
et le tenant sont déterminés par le serveur, jamais par le navigateur.

Les migrations ont leur propre journal `drizzle.__drizzle_customer_migrations`.
Les comptes, contacts chiffrés, challenges, essais et sessions sont soumis à RLS
forcée parent **et** tenant. Les quatre tables opérationnelles de budget, garde
téléphone et preuves de réservation/fournisseur sont isolées au parent serveur
pour permettre le budget partagé entre tenants ; elles ne contiennent aucun
téléphone ou nom clair. Elles ne sont jamais des projections publiques.

Le verrou du budget parent sérialise les transactions locales, jamais l'appel
fournisseur. Chaque réservation est définitivement comptée, y compris échec ou
réponse perdue. Les plafonds lifetime sont le minimum des observations reçues :
une observation, un service ou une preuve plus récents ne remettent rien à zéro.
Cette borne conservatrice peut fermer le pilote avant épuisement fournisseur ;
ce n'est pas une réconciliation de facture. Le plafond absolu est 50 envois.

Les challenges expirent au plus tard après 10 minutes et les sessions après
7 jours absolus selon l'horloge PostgreSQL. La garde téléphone reste au moins
10 minutes + 5 secondes après réservation, indépendamment d'une expiration
applicative plus courte ; un résultat d'envoi connu prolonge monotonement cette
garde à au moins 10 minutes après son observation. **Activation interdite tant
que la validité Verify de 10 minutes n'a pas été attestée.** Une durée fournisseur
différente exige de modifier cette politique avant activation, pas un nouvel SMS
de test. Aucun renvoi ne libère automatiquement un check resté incertain.

Le SID fournisseur est une preuve immuable `(parent, service, SID)` ; un checkId
ne s'exécute qu'une fois. Seule une réponse `pending` certaine permet un autre
checkId. L'approbation consomme atomiquement challenge, contact, compte et session.
Une collision téléphone exige une session de continuité valide du même compte ;
le téléphone seul ne récupère aucun compte. L'unicité tenant/téléphone empêche
aussi un doublon après changement de parent fournisseur, sans divulguer l'ancien
compte. Une migration de parent relève d'une procédure explicite non livrée ici.

`recoverCheck` ne restitue qu'une session originale encore valide, corrélée au
browserHash, challengeId, checkId et sessionHash exacts. Aucune extension de TTL.
Les expirations sont relues après attente des verrous. Un rollback échoué détruit
la connexion au lieu de la remettre dans le pool.

## Validation locale et CI

`pnpm --filter @sm/customer build`, puis `test:integration` avec
`CUSTOMER_TEST_DATABASE_URL` visant uniquement un PostgreSQL loopback, base
`postgres` ou `snackmanager_*_test_ci` existante. La fixture crée une base et un
rôle UUID neufs et supprime uniquement ces deux cibles. Le rôle utilisé par le
repository n'est ni superuser, ni propriétaire, ni BYPASSRLS. Sans cible sûre,
le runner échoue avant connexion. Les tests orchestration utilisent le vrai
service API mais un fournisseur simulé : aucun SMS, aucune dépense, aucun HTTP
public ou navigateur n'est validé par cette suite.
