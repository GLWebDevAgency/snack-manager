# Domaines Stripe des wallets

`PaymentDomainsModule` démarre un réconciliateur indépendant de la commande et du
raccordement marchand. Il ne manipule aucun paiement et ne bloque ni le démarrage
de l'API ni le formulaire carte si Stripe ou Redis ne répond pas.

Configuration existante : `STRIPE_SECRET_KEY` (`sk_` ou `rk_`, mode test/live),
`WEB_PUBLIC_URL` HTTPS et `PUBLIC_ROOT_DOMAIN`. Une configuration absente, locale
ou invalide désactive uniquement ce worker avec un avertissement. La clé restreinte
doit disposer des droits Stripe Payment Method Domains nécessaires.

La source Mongo est relue : compte connecté avec `chargesEnabled=true`, restaurant
non suspendu. `payoutsEnabled` et `detailsSubmitted` ne changent pas cette règle
d'encaissement existante. Les seuls hôtes sont le hostname public web, le
sous-domaine `slug.PUBLIC_ROOT_DOMAIN` et les domaines personnalisés actifs du
restaurant. Aucun Origin de requête, hôte d'iframe tiers ni alias `www` n'est inféré.

Un passage commence au démarrage puis toutes les 30 s (les passages qui chevauchent
un travail en cours sont ignorés). Il traite au plus 10 hôtes, avec 2 appels Stripe
simultanés, chacun limité à 5 s sans retry implicite. Une page contient au plus
10 restaurants ; le curseur partagé conserve aussi la position dans les hôtes
d'un restaurant. Aucun domaine n'est abandonné à cause de cette borne.

Redis coordonne les instances avec un bail de 120 s, renouvelé toutes les 30 s.
La perte du bail arrête les nouveaux appels. Les écritures de résultat/curseur et
la libération vérifient atomiquement le propriétaire du bail. Un crash est repris
après expiration du bail, à la dernière position publiée. Mongo n'est jamais
modifié par le réconciliateur.

Les caches sont séparés par environnement public, mode, compte Connect et hôte :
succès 24 h ; erreur ou validation wallet encore inactive 5 min ; domaine désactivé
manuellement 1 h. Un domaine désactivé n'est jamais réactivé automatiquement. Aucun
domaine Stripe n'est supprimé quand un domaine est retiré du restaurant. Un domaine
absent est créé avec une clé d'idempotence mode/compte/hôte ; un domaine actif est
relu, puis validé uniquement si ses wallets restent inactifs.

Fenêtre de rattrapage : pour au plus 10 hôtes, un nouveau compte ou DNS actif est
observé au prochain passage, normalement sous 30 s hors durée des appels. Pour un
parc de H hôtes, prévoir environ `ceil(H/10) × 30 s` par balayage, plus les durées
des passages qui dépassent 30 s et au plus un passage de fin de pagination. Après
une erreur Stripe, la prochaine tentative suit les 5 min de cache puis au plus
un balayage complet. Une panne durable de dépendance n'a pas de délai garanti.

Les journaux `Payment domains sweep` donnent les résultats actifs/en attente et
les erreurs de stockage sans sérialiser les erreurs SDK ou leurs secrets. Une
validation PMD ne garantit pas qu'un wallet sera proposé sur tous les appareils :
Stripe Elements conserve sa détection navigateur, appareil, compte et carte.

Sources officielles :
- https://docs.stripe.com/payments/payment-methods/pmd-registration
- https://docs.stripe.com/api/payment_method_domains/create
- https://docs.stripe.com/api/payment_method_domains/validate

Recette locale isolée (aucun appel Stripe réel) :

```sh
PAYMENT_DOMAINS_TEST_MONGO_URL=mongodb://127.0.0.1:27048/snackmanager_payment_domains_test_local \
PAYMENT_DOMAINS_TEST_REDIS_URL=redis://127.0.0.1:6387/15 \
pnpm --filter @sm/api exec vitest run src/modules/payment-domains
```

Les cibles d'intégration sont refusées hors localhost et sans préfixe Mongo de
recette. Chaque exécution possède une base Mongo aléatoire et deux clés Redis
uniques, seules ressources nettoyées. Sans ces variables, seuls les tests
d'intégration sont ignorés ; les tests unitaires restent exécutés.
