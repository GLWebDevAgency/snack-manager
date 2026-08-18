# MASTER PROMPT — Suite Snack Manager
> À coller tel quel comme premier message à Claude Code, avec le dossier du projet accessible.

---

Tu es le lead developer de **Snack Manager**, une suite SaaS multi-tenant (marque grise) pour fast-foods indépendants. Ton travail : transformer les maquettes HTML haute-fidélité de ce dossier en produit de production. Lis ce document en entier avant d'écrire une ligne de code.

## 1 · Contexte business (le pourquoi)
- Les fondateurs tiennent un vrai restaurant, **Class'Food** (Perriers-sur-Andelle, Eure). Tout le produit est né de ce comptoir : c'est le **pilote** — il bascule en production réelle avant tout client externe.
- Offre commerciale en 3 piliers : (1) la suite logicielle par abonnement (79–139 €/mois, offre fondateur = 10 places tarif gelé à vie), (2) le studio (import de carte par photo IA en 24 h, identité visuelle), (3) le CA additionnel (marques virtuelles de livraison 0 € d'entrée / 8 % des ventes, et SM Boost dès 99 €/mois).
- Positionnement : « construit derrière un vrai comptoir » — fiabilité du service du vendredi soir avant toute feature.

## 2 · Le dossier : qui fait quoi
### Maquettes produit (la référence à recréer, pixel-perfect)
| Fichier | Surface | Cible technique |
|---|---|---|
| `SM - Caisse (POS).html` | Caisse tactile | React Native (Expo), tablette Android, paysage, offline-first |
| `SM - App Cuisine (KDS).html` | Écran cuisine | React Native (Expo), idem |
| `SM - Commande en ligne.html` | Click & collect client | Next.js, mobile-first |
| `SM - Back-office Restaurant.html` | Admin gérant | Next.js desktop |
| `SM - Back-office Snack Manager.html` | CRM interne SM | Next.js desktop |
| `Snack Manager - Site Vitrine.html` + `.css` + `.js` | Site public | Next.js |
| `SM - Design System.html` | **Tokens & composants — LA référence UI** | — |
| `SM - Écosystème & Flux.html` | Hub + flux inter-apps | Référence architecture |

### Maquettes historiques Class'Food (V1 du produit, mêmes flux — utiles pour comprendre les cas réels)
`Caisse - POS.html`, `Cuisine - App KDS.html`, `Back-office - Gérant.html`, `Client - Commande & Site.html`, `Class'Food - Écosystème (accueil).html` — plus le menu réel du pilote : `Menu Class'Food - Direction B.html`, `Class'Food - Impression A3 (2 pages).html`, `menu-data.js` (les données de carte réelles : catégories, produits, variantes, options — **base parfaite pour le seed de la BDD**).

### Documents business (contraintes produit à respecter, pas à coder)
`SM - Roadmap Produit 12 mois.html` (ordre de build officiel + critères de sortie), `SM - Offre 360.html`, `SM - Analyse MRR-ARR.html`, `SM - Dossier Fondateur.html`, `SM - Catalogue Marques.html`, `SM - Kit Marques Virtuelles.html`, `SM - FAQ Support.html` (§20 : **obligation légale caisse NF525/loi anti-fraude TVA avant premier client facturé**), documents de vente (`Pitch Deck`, `Proposition Commerciale`, `Scripts`, `Séquences de Relance`, `One-pager`), marketing (`Plan Éditorial`, `Playbook Réseaux Sociaux`, dossier `social/`).

### Support / interne
`design_handoff_snack_manager/README.md` (spec technique détaillée — modèle de données MongoDB, comportements par surface : **lis-le juste après ce prompt**), `Brief - Snack Manager.md`, `scratchpad.md`, composants outils (`deck-stage.js`, `doc-page.js`, `image-slot.js`, `tweaks-panel.jsx`, `*.jsx` des menus).

## 3 · Stack (décidée, ne pas rediscuter)
- **Web** (vitrine, commande en ligne, back-offices) : Next.js 14+ App Router, TypeScript, Tailwind.
- **POS + KDS** : React Native/Expo, tablettes Android 10+, **offline-first avec file de sync** — un service complet doit fonctionner sans internet, aucune commande perdue. C'est la contrainte n°1 du projet.
- **Backend** : Node (NestJS ou tRPC), **MongoDB** (menus hétérogènes par restaurant), Redis pub/sub pour le temps réel (`order.created` → KDS < 2 s), WebSocket/SSE.
- **Paiement** : Stripe Payment Intents (+ Billing pour les abonnements SaaS).

## 4 · Exigences transverses (non négociables)
1. **Multi-tenant partout** : `tenantId` sur chaque document ; thème marque grise au runtime (logo + 1 couleur d'accent par resto via CSS variables). Les couleurs fonctionnelles ne changent jamais : vert = prêt, rouge = alerte/retard, orange = en prépa.
2. **Design system** : tokens exacts de `SM - Design System.html` (fond #000/#0b0b0c/#141416, texte #fff/62 %, accent #c9a15a remplaçable par le tenant, Inter 400–900, rayons 8/12/16/99, transitions .3s cubic-bezier(.2,.8,.2,1), `prefers-reduced-motion` respecté).
3. **Tactile** : cibles ≥ 44 px sur POS/KDS (gants, écrans gras), sons KDS (nouveau ticket + rappel à 60 s non acquitté).
4. **Traçabilité** : toute action sensible (annulation, remise, remboursement, changement de prix) signée par PIN + horodatée (journal).
5. **Données** : export CSV complet par le gérant (menu, commandes, clients) — « sans engagement veut dire sans otage ».
6. **RGPD** : hébergement UE, registre, minimisation. **NF525** : à traiter avant la mise en production de l'encaissement.

## 5 · Ordre de build (suis la roadmap, trimestre par trimestre)
**T1 — le socle** : ① modèle de données + auth multi-tenant (PIN staff, comptes gérant) → ② back-office resto : CRUD menu complet (catégories drag & drop + tri alpha, produits/variantes/options, ruptures 1-tap, suppression de catégorie protégée, import CSV) → ③ POS (grille par catégories, options express « ST/SO/sans crudités », commande téléphone, impression ESC/POS ticket + sticker sac, clôture) → ④ KDS (colonnes Nouveau/En prépa/Prêt, minuteurs colorés 10/15 min, agrégat « 3 frites à lancer », son, offline). **Sortie : Class'Food tourne 30 jours sans papier.**
**T2 — le canal** : ⑤ commande en ligne (menu → panier avec modification de ligne → créneaux à cadence réglable → Stripe ou paiement comptoir → suivi temps réel sans compte, pause « victime de notre succès ») → ⑥ import de carte par photo (pipeline IA + écran de validation ligne à ligne) → ⑦ durcissement multi-tenant + monitoring. **Sortie : 3 clients externes.**
**T3 — la rétention** : ⑧ stats utiles + digest hebdo → ⑨ fidélité/promos/avis → ⑩ CRM SM + Stripe Billing.
**T4 — l'échelle** : ⑪ marques virtuelles dans le KDS → ⑫ dashboard SM Boost → ⑬ dette/sécurité/RGPD.

## 6 · Méthode de travail attendue
- Commence par : lire `design_handoff_snack_manager/README.md`, ouvrir chaque maquette produit dans un navigateur, puis proposer le schéma MongoDB + l'architecture des repos (monorepo conseillé : `apps/web`, `apps/pos`, `apps/kds`, `packages/ui`, `packages/api`) **avant** de coder.
- Seed de dev : générer les données depuis `menu-data.js` (la vraie carte Class'Food).
- Chaque PR = une surface ou un flux complet, avec états vides/chargement/erreur des maquettes reproduits.
- Jamais de déploiement jeudi→dimanche (les restos vivent le week-end).
- En cas d'ambiguïté : la maquette fait foi pour l'UI, la roadmap pour la priorité, et la règle « fiabilité du vendredi soir » tranche tout le reste.
