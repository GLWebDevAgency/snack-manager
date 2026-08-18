# Handoff : Suite Snack Manager — développement production

## Overview
Snack Manager est une suite SaaS multi-tenant (marque grise) pour fast-foods indépendants : caisse (POS), écran cuisine (KDS), commande en ligne click & collect, back-office restaurateur, back-office plateforme (CRM), et site vitrine. Les maquettes HTML de ce projet sont la référence visuelle et fonctionnelle complète ; ce document décrit comment les recréer en production.

## About the Design Files
Les fichiers de ce bundle sont des **références de design en HTML** — des prototypes montrant l'apparence et le comportement attendus, pas du code à copier. La tâche : **recréer ces designs dans les environnements cibles** en suivant leurs conventions.

## Stack cible (décidée)
- **Site vitrine + commande en ligne + back-offices** : Next.js 14+ (App Router), TypeScript, Tailwind CSS, déployé Vercel ou VPS.
- **POS + KDS** : React Native (Expo), cible tablettes Android 10+, mode paysage verrouillé, fonctionnement offline-first avec file de synchronisation.
- **Backend** : API Node (NestJS ou tRPC) + MongoDB (les menus varient par restaurant → documents flexibles) + Redis (pub/sub tickets temps réel via WebSocket/SSE).
- **Paiement en ligne** : Stripe (Payment Intents + Connect si encaissement pour compte des restos plus tard).
- **Temps réel** : chaque commande créée (en ligne, POS, téléphone) publie un événement `order.created` → KDS abonné par `restaurantId`. Latence cible < 2 s.

## Fidelity
**High-fidelity.** Couleurs, typographie, espacements et copies sont finaux. Recréer au pixel en utilisant les tokens ci-dessous.

## Multi-tenant / marque grise (exigence centrale)
Chaque restaurant (tenant) a : `logoUrl`, `brandColor` (1 couleur d'accent), `name`, horaires, menu. Toutes les surfaces client (commande en ligne, POS, KDS, back-office resto) appliquent le thème du tenant au runtime via CSS variables. Les couleurs FONCTIONNELLES ne se personnalisent pas : vert = prêt/validé, rouge = alerte/retard, orange = en préparation. Seul l'accent de marque change.

## Surfaces & fichiers de référence
| Surface | Fichier maquette | Cible |
|---|---|---|
| Site vitrine SM | `Snack Manager - Site Vitrine.html` (+ `.css`) | Next.js, statique + formulaire contact |
| Commande en ligne (client) | `SM - Commande en ligne.html` | Next.js, mobile-first |
| Caisse POS | `SM - Caisse (POS).html` | React Native tablette |
| Écran cuisine KDS | `SM - App Cuisine (KDS).html` | React Native tablette |
| Back-office restaurateur | `SM - Back-office Restaurant.html` | Next.js desktop |
| Back-office Snack Manager (CRM) | `SM - Back-office Snack Manager.html` | Next.js desktop, interne |
| Design system | `SM — Design System.html` | Référence tokens/composants |
| Flux inter-apps | `SM - Écosystème & Flux.html` | Référence architecture |

## Design tokens (source : SM — Design System.html)
- Couleurs : fond `#000` / surfaces `#0b0b0c`, `#141416` ; texte `#fff`, secondaire `rgba(255,255,255,.62)` ; lignes `rgba(255,255,255,.1)` ; accent SM `#c9a15a` (laiton — remplacé par `brandColor` du tenant sur les surfaces marque grise) ; succès `#3fae6a`, alerte `#d8514a`, prépa `#e8923a`.
- Typo : Inter (400–900). Échelle : 12.5 / 14 / 16 / 20 / 26 / 34 / 48px. Titres : weight 800–900, letter-spacing −0.02em.
- Rayons : 8 (contrôles), 12 (cartes), 16–22 (panneaux), 99 (pills). Ombres : `0 18px 40px rgba(0,0,0,.45)` sur survol carte.
- Interactions : transitions 0.3–0.35s cubic-bezier(.2,.8,.2,1) ; hover = translateY(−4 à −6px) ; respecter `prefers-reduced-motion`.

## Modèle de données (collections MongoDB)
- `tenants` : nom, logo, brandColor, horaires (par jour, midi/soir), adresse, plan (essentiel/complet/boost), place fondateur.
- `categories` : tenantId, nom, ordre (drag & drop), active.
- `products` : tenantId, categoryId, nom, description (liste d'ingrédients affichée), prix, variantes (ex. simple/double/triple), options (groupes : sauces, suppléments, retraits "sans X"), tags (nouveau, mega burger…), rupture (bool), photo.
- `orders` : tenantId, canal (`online` | `pos` | `phone`), type (`surplace` | `emporter` | `pickup`), lignes (produit, variante, options, note), statut (`new` → `preparing` → `ready` → `delivered`), paiement (`paid_online` | `pay_at_counter`), numéro de retrait, horodatages par transition (pour les minuteurs KDS), client (nom/tél pour pickup).
- `staff` : tenantId, rôle (gérant/caisse/cuisine), PIN, pointages (in/out).
- `leads` (CRM SM) : resto, contact, étape pipeline, relances (séquences A/B/C), notes.

## Comportements clés à implémenter (détaillés dans les maquettes)
1. **Import de carte par photo (IA)** : upload photos → extraction produits/prix/options → back-office pré-rempli → relecture ligne à ligne. Prévoir file asynchrone + écran de validation (diff modifiable).
2. **KDS** : colonnes Nouveau / En prépa / Prêt ; cartes à hauteur stable ; minuteur par commande (vert < 10 min, orange < 15, rouge au-delà) ; agrégat "à lancer" (ex. 3× frites) en bandeau ; alerte sonore sur `order.created` ; boutons larges ≥ 44px (gants/écrans gras).
3. **POS** : grille produits par catégorie, options express (« ST » sans tomates, « SO » sans oignons, sauces), commande téléphone (nom + heure de retrait), impression ticket cuisine + sticker sac (ESC/POS), totaux automatiques.
4. **Commande en ligne** : parcours menu → panier (modifier une ligne = rouvrir la config) → créneau de retrait → paiement Stripe ou au comptoir → suivi statut en temps réel (Reçue / En prépa / Prête) sans compte obligatoire.
5. **Back-office resto** : CA du jour en direct, gestion menu (CRUD complet, drag & drop catégories, tri alphabétique, rattachement produits, suppression de catégorie protégée par confirmation si items rattachés), import CSV/XML, ruptures en 1 tap, horaires/fermetures, équipe & pointages, sidebar rétractable (icônes seules) en overlay z-index sans pousser le contenu.
6. **CRM SM (interne)** : pipeline leads par étapes, fiches resto, suivi des relances (séquences des documents de vente), compteur places fondateur.

## Interactions & états
- Toute mutation optimiste avec rollback si l'API échoue (POS/KDS offline-first : file locale + resync, jamais de perte de commande).
- États vides, chargement (skeletons), erreur : présents dans les maquettes — les reproduire.
- Sons KDS : nouveau ticket = son court distinct ; répété si non acquitté après 60 s.

## Ce qui N'EST PAS dans le scope V1
Livraison (pas d'app livreur), multi-établissement par tenant, comptabilité intégrée, application client native. Prévu plus tard — ne pas sur-architecturer, mais garder `tenantId` partout et le canal de commande extensible.

## Assets
Logo S laiton sur noir (SVG inline dans les maquettes), Inter via Google Fonts, icônes SVG inline trait 2px (pas de bibliothèque d'icônes — les recopier).

## Ordre de build recommandé
1. Modèle de données + auth multi-tenant → 2. Back-office resto (menu CRUD) → 3. POS → 4. KDS + temps réel → 5. Commande en ligne + Stripe → 6. Import IA de carte → 7. CRM SM → 8. Site vitrine.
