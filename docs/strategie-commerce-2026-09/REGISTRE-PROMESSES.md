# Registre des promesses et de leur preuve

État code de la branche de travail au 5 septembre 2026. « Présent » signifie implementation identifiable, pas certification de tout matériel ni validation production. La recette staging et les limitations contractuelles restent nécessaires.

| Domaine | État et formulation vendable | Preuve / validation restante |
|---|---|---|
| POS / caisse | Présent ; prise de commande et enregistrement de moyens de paiement. Le TPE habituel reste un équipement distinct. | `apps/pos`, `apps/api/src/modules/orders`. Tester clôture et rapprochement sur configuration client ; ne pas affirmer une certification fiscale non documentée. |
| KDS / suivi cuisine | Présent, réception et traitement des tickets selon modules activés. | `apps/kds`, module `orders`. Scénarios simultanés POS/KDS, reconnexion et statuts à valider. |
| Hors-ligne | POS : stockage local et renvoi après reconnexion. KDS : conservation des tickets déjà reçus. | Les nouvelles communications inter-tablettes et paiements/commandes Internet ne fonctionnent pas sans connexion. Aucun Bluetooth maillé promis. Tester pertes réseau réelles et protocole papier de secours. |
| Tickets / stickers | Fonction logicielle à proposer sur matériel compatible validé. | Sélection imprimante, format, réseau local, pilote/bridge et tiroir ; chaque combinaison doit être testée. Ne pas annoncer qu'une imprimante ticket imprime forcément des stickers. |
| Commande directe / retrait | Présent ; identité, menu/options, créneaux, paiement et suivi. Doit pouvoir fonctionner avec back-office seul. | `apps/api/src/modules/ordering`, `apps/web/src/app/admin/orders`. Recette de traitement sans POS/KDS et droits limités requise. |
| Livraison restaurant | En cours de raccordement dans ce lot ; tarif prévu 119 €, activation après recette pilote. | Vérifier serveur et UI pour zones/frais/minimum, adresse, créneaux, paiement, traitement et remboursements. Pas de livraison tierce, de dispatch intelligent ou de garantie de délai promis. |
| Fidélité autonome ou incluse | **Pilote accompagné uniquement** : cartes, administration des membres, programme points/tampons et récompenses configurables. Le tarif autonome proposé est 39 € ; il ne vend pas un parcours de récompense terminé. | `loyalty-member.controller.ts:redeem()` renvoie `GoneException` / `loyalty_redemption_requires_order` : la consommation sécurisée liée au ticket reste à raccorder. Attribution automatique de points après commande en ligne absente. Ne promettre ni utilisation des récompenses ni cumul automatique web dans ce pilote, y compris avec collect/Boost. Recette QR, reconnexion et opérations assistées à documenter avant accord pilote. |
| Stripe Connect | Paiements restaurant distincts de l'abonnement Snack Manager. | Module `encaissement`, `ordering/payments.service.ts`. Vérifier onboarding complet, capacités, paiements échoués, événements répétés et remboursement. Frais selon contrat/moyen de paiement. |
| Abonnement plateforme | Catalogue et calculs à raccorder à tous devis, conversions et factures. | Modules `crm`, source `packages/contracts/src/commerce.ts`. Le paiement Connect d'une commande ne facture pas l'abonnement SaaS. Réconcilier plateforme, factures et droits. |
| Menu / identité / vitrine | Menu personnalisé dans le module. Vitrine sur mesure séparée avec CTA vers celui-ci. | `ordering/site.service.ts`, admin/site. Domaine, propriété, hébergement et maintenance du site spécifiés au devis. Pas de catalogue doublonné dans la vitrine. |
| Planning / équipe | Modules existants, distincts des horaires/créneaux de vente. | Module `planning`, `staff`. Tester les fonctions réellement vendues ; pas de paie réglementaire ni planification IA automatique garantie. |
| Stocks / coût matière | Modules ingrédients/supply existants dans Complet ; audit métier et usage terrain nécessaires. | Module `supply`. Ne pas assimiler inventaires et fiches techniques à achats autonomes, prévisions fiables ou réapprovisionnement automatisé. |
| Menu boards / écrans | Fonction existante à cadrer au devis, pas incluse implicitement dans l'offre web seule. | Module `screens` ; isoler appairage et publication des simples réglages du site. |
| Statistiques / exports | Données et exports disponibles selon modules/droits ; réversibilité contractuelle à documenter. | Modules `stats`, `orders`. Pas d'export universel CSV promis pour toute donnée sans test. |
| Support / installation | Accompagnement planifié, horaires et périmètre au devis. | Pas de support 24/7, SLA ou présence midi et soir systématique promis pour une équipe d'une personne. Définir contact d'incident et procédure de reprise. |
| IA conseil / HACCP / IoT | Feuille de route, non inclus ni facturés comme disponibles. | Nécessitent expertise métier, traçabilité, sécurité des capteurs, maintenance, qualité des mesures et validation réglementaire dédiée. Aucune garantie de conformité automatique. |

## Recette commerciale minimale

Pour chaque offre : un propriétaire limité à ses capacités, un salarié sans privilèges, un autre restaurant isolé, une session expirée, une URL directe de page verrouillée et un appel API sans capacité. Aucun chargement de données derrière un overlay commercial. Le verrou de souscription et le refus de rôle sont deux réponses différentes.

Pour la livraison : tant que la recette E2E n'est pas validée et documentée, la carte marketing est une discussion de pilote ; elle est exclue des offres structurées SEO « en stock ». Ce garde-fou public ne remplace pas les contrôles d'activation serveur.

Pour la fidélité : l'offre autonome est également exclue des offres structurées SEO « en stock » tant que le parcours de consommation sécurisé n'est pas livré et validé. Collect et Boost ne transforment pas cette limite en fonction disponible : leur fidélité incluse reste un pilote accompagné. Le devis précise les opérations administratives réellement accessibles, la charge d'accompagnement et l'absence de consommation de récompenses et de cumul automatique web ; aucun contournement par ajustement manuel de points ne remplace une consommation sécurisée.

Critère de sortie fidélité : récompense liée à une vente réelle, contrôle des droits et de l'établissement, protection contre la double consommation, solde cohérent, annulation/remboursement et reprise après échec testés de bout en bout. L'activation commerciale et les promesses de cumul automatique exigent leur propre recette, pas seulement un test unitaire vert.

## Changements marketing de ce lot

Prix partagés fidélité/collect/livraison, applications autonomes visibles sur accueil/offres/commande, vitrine indépendante, frais tiers explicités, comparateur à taux concurrent non sourcé retiré, simulateur de coût déclaré sans gains prédéterminés, formulations hors-ligne limitées et promesses support/export/onboarding bornées. Identité visuelle existante conservée ; aucune certification ni preuve de production ajoutée.
