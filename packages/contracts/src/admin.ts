import { z } from 'zod';

// ─────────────────────────────────────────────────────────────
// Administration client — le socle du back-office interne « /sm ».
//
// Cette surface est TRANS-TENANT (elle agit sur n'importe quel restaurant du
// parc) et donc réservée au rôle `sm_admin`. Elle porte trois choses :
//
//  1. le STATUT DE COMPTE d'un établissement (essai, actif, suspendu, parti) ;
//  2. la RÉVOCATION d'un appareil de terrain (tablette perdue ou volée) ;
//  3. le JOURNAL d'administration, append-only, qui trace chaque geste.
//
// RESPECT DES CLIENTS DE NOS CLIENTS — aucun type de ce fichier ne porte le
// nom, le téléphone ou l'e-mail d'un consommateur final. Le fichier client
// d'un restaurateur lui appartient : le détenir nous rendrait responsables de
// sa protection sans qu'aucune décision d'administration ne l'exige. Ce qui
// remonte ici, ce sont des états de compte et des agrégats.
//
// Rappel de convention : tous les montants circulent en CENTIMES (int).
// ─────────────────────────────────────────────────────────────

// ─── Statut de compte ───

/**
 * Le cycle de vie commercial d'un établissement.
 *
 *  - `trial`     : période d'essai, il travaille, on ne facture pas encore ;
 *  - `active`    : client payant ;
 *  - `suspended` : accès COUPÉ (impayé, litige) — les données restent ;
 *  - `churned`   : il est parti. On garde tout, on ne coupe rien de force.
 */
export const TENANT_ACCOUNT_STATUSES = ['trial', 'active', 'suspended', 'churned'] as const;
export const TenantAccountStatusSchema = z.enum(TENANT_ACCOUNT_STATUSES);
export type TenantAccountStatus = z.infer<typeof TenantAccountStatusSchema>;

export const TENANT_ACCOUNT_STATUS_LABELS: Record<TenantAccountStatus, string> = {
  trial: 'Essai',
  active: 'Actif',
  suspended: 'Suspendu',
  churned: 'Parti',
};

/**
 * Statut d'un établissement dont le champ n'a jamais été écrit.
 *
 * Il en existe : tous les tenants créés avant ce module. Le défaut doit donc
 * être le statut le plus PERMISSIF possible — un champ absent ne peut pas
 * fermer la porte d'un restaurant en plein service.
 */
export const DEFAULT_TENANT_ACCOUNT_STATUS: TenantAccountStatus = 'trial';

/**
 * Le seul statut qui coupe l'accès est `suspended`.
 *
 * `churned` n'en fait PAS partie, et c'est délibéré : un client qui nous quitte
 * n'est pas un client à qui l'on claque la porte au nez. Fermer l'accès est un
 * geste explicite, motivé, journalisé — pas un effet de bord du départ. La
 * suspension reste disponible si le dossier l'exige.
 */
export const isAccessBlocked = (status: TenantAccountStatus | null | undefined): boolean =>
  status === 'suspended';

/** Message rendu au gérant dont le compte est suspendu — jamais une erreur technique. */
export const ACCOUNT_SUSPENDED_MESSAGE = 'Accès suspendu — contactez Snack Manager';

/**
 * Code machine accompagnant le 403.
 *
 * Le web s'en sert pour afficher l'écran « compte suspendu » plutôt que de
 * renvoyer le gérant vers l'écran de connexion : ses identifiants sont bons,
 * c'est son abonnement qui ne l'est pas. Comparer le libellé français serait
 * un couplage à une chaîne qu'on voudra retoucher.
 */
export const ACCOUNT_SUSPENDED_CODE = 'tenant_suspended';

/**
 * Message affiché au CONSOMMATEUR sur le site de commande d'un restaurant
 * suspendu.
 *
 * Le client final n'a rien à voir avec le litige commercial qui nous oppose au
 * restaurateur : il ne doit lire ni « suspendu », ni « impayé », ni une erreur
 * technique. Il lit qu'on ne prend pas de commande en ligne à cet instant, et
 * on lui laisse le téléphone du restaurant — la porte reste ouverte.
 */
export const PUBLIC_ORDERING_SUSPENDED_MESSAGE =
  'La commande en ligne est momentanément indisponible. Merci d’appeler directement le restaurant.';

/** L'état de compte tel qu'il circule dans les réponses d'API (dates ISO). */
export type TenantAccount = {
  status: TenantAccountStatus;
  /** Début du statut COURANT — remis à jour à chaque changement. */
  since: string;
  /** Motif du dernier changement de statut, saisi par l'équipe SM. */
  reason: string;
  /** Horodatage de la suspension en cours (`null` dès la réactivation). */
  suspendedAt: string | null;
};

/**
 * Fermeture propre du site public de commande.
 *
 * Un établissement suspendu ne doit pas voir sa page tomber en erreur : elle
 * se ferme comme une pause de service ordinaire — même forme de réponse, même
 * bandeau, autre message. Le menu, les horaires et les avis restent affichés :
 * on suspend un ACCÈS, on n'efface pas un restaurant d'Internet.
 *
 * Fonction pure et partagée pour que la règle ne soit écrite qu'une fois :
 * l'API la pose sur la page publique, le web peut la rejouer pour son rendu.
 */
export function publicOrderingState(
  account: { status?: TenantAccountStatus | null } | null | undefined,
  settings: { paused: boolean; message: string | null },
): { paused: boolean; message: string | null } {
  if (isAccessBlocked(account?.status)) {
    return { paused: true, message: PUBLIC_ORDERING_SUSPENDED_MESSAGE };
  }
  return settings.paused
    ? { paused: true, message: settings.message }
    : { paused: false, message: null };
}

// ─── Formules ───

/**
 * Les trois formules, redéclarées ici plutôt qu'importées de `./index`.
 *
 * `index.ts` fait `export * from './admin'` : importer `PlanSchema` depuis
 * l'index créerait un cycle de modules. `crm.ts` a fait le même choix pour la
 * même raison. Les valeurs sont vérifiées par un test de cohérence.
 */
export const ADMIN_PLANS = ['essentiel', 'complet', 'boost'] as const;
export type AdminPlan = (typeof ADMIN_PLANS)[number];

// ─── Révocation d'appareil ───

/**
 * Pourquoi on coupe une tablette. Quatre motifs, pas de texte libre : le
 * journal doit rester comptable (« combien de vols ce trimestre ? »), et un
 * champ libre finit toujours par contenir « rien » ou « cf. mail ».
 */
export const DEVICE_REVOKE_REASONS = ['perte', 'vol', 'panne', 'remplacement'] as const;
export const DeviceRevokeReasonSchema = z.enum(DEVICE_REVOKE_REASONS);
export type DeviceRevokeReason = z.infer<typeof DeviceRevokeReasonSchema>;

export const DEVICE_REVOKE_REASON_LABELS: Record<DeviceRevokeReason, string> = {
  perte: 'Perte',
  vol: 'Vol',
  panne: 'Panne',
  remplacement: 'Remplacement',
};

/** Nature de l'appareil révoqué — tablette de terrain ou téléviseur de salle. */
export const REVOCABLE_DEVICE_KINDS = ['pos', 'kds', 'screen'] as const;
export type RevocableDeviceKind = (typeof REVOCABLE_DEVICE_KINDS)[number];

export const REVOCABLE_DEVICE_KIND_LABELS: Record<RevocableDeviceKind, string> = {
  pos: 'Caisse',
  kds: 'Écran cuisine',
  screen: 'Écran de salle',
};

// ─── Journal d'administration ───

/**
 * Les gestes tracés. Nous agissons sur l'OUTIL DE TRAVAIL d'un commerçant :
 * chaque action, y compris la simple consultation d'une fiche détaillée, doit
 * pouvoir être reconstituée six mois plus tard.
 */
export const ADMIN_LOG_ACTIONS = [
  'tenant.suspend',
  'tenant.reactivate',
  'tenant.plan_change',
  'tenant.note',
  'tenant.detail_view',
  'device.revoke',
  'screen.revoke',
] as const;
export const AdminLogActionSchema = z.enum(ADMIN_LOG_ACTIONS);
export type AdminLogAction = z.infer<typeof AdminLogActionSchema>;

export const ADMIN_LOG_ACTION_LABELS: Record<AdminLogAction, string> = {
  'tenant.suspend': 'Suspension du compte',
  'tenant.reactivate': 'Réactivation du compte',
  'tenant.plan_change': 'Changement de formule',
  'tenant.note': 'Note interne',
  'tenant.detail_view': 'Consultation de la fiche',
  'device.revoke': "Révocation d'un appareil",
  'screen.revoke': "Révocation d'un écran",
};

/**
 * Une ligne du journal.
 *
 * `actor.email` est DÉNORMALISÉ à l'écriture : un journal qui se relit à
 * travers une jointure change de contenu quand un compte d'équipe est renommé
 * ou supprimé. Ce qui est écrit reste écrit.
 */
export type AdminLogEntry = {
  _id: string;
  at: string;
  actor: { id: string; email: string };
  action: AdminLogAction;
  actionLabel: string;
  tenantId: string;
  /** Cible secondaire : identifiant d'appareil ou d'écran, sinon `null`. */
  targetId: string | null;
  reason: string;
  /** Contexte de l'action (ancienne et nouvelle formule, motif de révocation…). */
  meta: Record<string, unknown> | null;
};

// ─── Entrées d'API (validées par zod) ───

/**
 * Suspendre exige un motif. C'est la seule action qui ferme la porte d'un
 * commerçant : « pourquoi ? » doit se lire dans le journal, pas se retrouver
 * dans une conversation Slack.
 */
export const TenantSuspendSchema = z.object({
  reason: z.string().trim().min(3, 'Indiquez le motif de la suspension').max(500),
});
export type TenantSuspend = z.infer<typeof TenantSuspendSchema>;

/** Réactiver est un geste de réparation : le motif aide, il n'est pas exigé. */
export const TenantReactivateSchema = z.object({
  reason: z.string().trim().max(500).default(''),
});
export type TenantReactivate = z.infer<typeof TenantReactivateSchema>;

export const TenantPlanChangeSchema = z.object({
  plan: z.enum(ADMIN_PLANS),
  reason: z.string().trim().max(500).default(''),
});
export type TenantPlanChange = z.infer<typeof TenantPlanChangeSchema>;

export const TenantNoteSchema = z.object({
  note: z.string().trim().min(1, 'Une note vide ne trace rien').max(2_000),
});
export type TenantNote = z.infer<typeof TenantNoteSchema>;

export const DeviceRevokeSchema = z.object({
  reason: DeviceRevokeReasonSchema,
  /** Précision libre — « oubliée dans le taxi », numéro de dossier assurance… */
  note: z.string().trim().max(500).default(''),
});
export type DeviceRevoke = z.infer<typeof DeviceRevokeSchema>;

export const AdminLogQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  action: AdminLogActionSchema.optional(),
});
export type AdminLogQuery = z.infer<typeof AdminLogQuerySchema>;

// ─── Sorties d'API ───

/** Fiche « compte » d'un établissement : ce qui décide de son accès. */
export type AdminTenantAccount = {
  tenantId: string;
  name: string;
  slug: string;
  plan: AdminPlan;
  founderSeat: boolean;
  account: TenantAccount;
  /** Résultat de la règle d'accès, calculé une fois côté API. */
  accessBlocked: boolean;
  statusLabel: string;
};

/**
 * Un appareil qui vient d'être révoqué.
 *
 * Le nouveau code d'appairage est renvoyé À DESSEIN : l'équipe SM est au
 * téléphone avec le restaurateur au moment où elle coupe la tablette volée, et
 * c'est ce code qu'elle lui dicte pour remettre la caisse de secours en
 * service dans la minute. Le JETON, lui, ne sort jamais — il est détruit.
 */
export type AdminRevokedDevice = {
  id: string;
  tenantId: string;
  name: string;
  kind: RevocableDeviceKind;
  kindLabel: string;
  /** Toujours `false` : l'appareil repart en attente d'appairage. */
  paired: boolean;
  revokedAt: string;
  revokedReason: DeviceRevokeReason;
  revokedReasonLabel: string;
  pairing: { code: string; expiresAt: string };
};
