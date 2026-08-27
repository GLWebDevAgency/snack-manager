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

/**
 * CE QU'UNE SUSPENSION FERME, ET CE QU'ELLE LAISSE OUVERT.
 *
 * La règle tient en une phrase : **on ferme ce qui encaisse, on laisse ouvert
 * ce qui affiche.** Elle est écrite ici parce qu'elle se décide une fois et
 * s'applique à six endroits ; sans elle, chaque surface tranche à sa manière.
 *
 * FERMÉ — les surfaces qui prennent de l'argent ou pilotent le service :
 *  · le back-office du gérant (guard global, à chaque requête) ;
 *  · l'ouverture de service au PIN, sur tablette appairée COMME par slug —
 *    une caisse s'authentifie par son jeton d'appareil, hors du guard, et
 *    l'oublier laisserait tout le parc déjà installé encaisser librement ;
 *  · la prise de commande en ligne.
 *
 * OUVERT — les surfaces que voit le CLIENT FINAL du restaurant :
 *  · la carte, les horaires et les avis du site public ;
 *  · l'écran de menu accroché en salle.
 *
 * Le consommateur n'est pour rien dans un impayé. Éteindre la télé du mur
 * au-dessus d'une file d'attente n'accélère aucun règlement : ça humilie le
 * restaurateur devant ses clients et ça donne de NOUS l'image d'un logiciel
 * qui tombe en panne. La pression s'exerce là où le gérant travaille, pas
 * dans sa salle.
 *
 * Cas particulier de l'écran de salle, à ne pas « corriger » sans y penser :
 * la clé HDMI interprète tout 401/403 comme un dépairage et bascule sur son
 * écran de saisie de code. Lui refuser son contenu afficherait donc un
 * formulaire d'appairage en grand format devant les convives — et le code que
 * le gérant y saisirait ne marcherait pas davantage.
 */

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
  'tenant.create',
  'tenant.suspend',
  'tenant.reactivate',
  // Le DÉPART d'un client — il nous quitte, on garde tout, on ne coupe rien.
  'tenant.churn',
  'tenant.plan_change',
  'tenant.note',
  'tenant.detail_view',
  'tenant.owner_reset',
  'device.revoke',
  'screen.revoke',
  'invoice.issue',
  'invoice.send',
  'invoice.remind',
  'invoice.pay',
  'invoice.cancel',
  'invoice.credit',
  // Réglage de PLATEFORME : il ne vise aucun établissement. Voir
  // `PLATFORM_LOG_ACTIONS` ci-dessous pour ce que ce préfixe implique.
  'platform.social_change',
] as const;
export const AdminLogActionSchema = z.enum(ADMIN_LOG_ACTIONS);
export type AdminLogAction = z.infer<typeof AdminLogActionSchema>;

export const ADMIN_LOG_ACTION_LABELS: Record<AdminLogAction, string> = {
  'tenant.create': 'Création du restaurant',
  'tenant.suspend': 'Suspension du compte',
  'tenant.reactivate': 'Réactivation du compte',
  'tenant.churn': 'Départ du client',
  'tenant.plan_change': 'Changement de formule',
  'tenant.note': 'Note interne',
  'tenant.detail_view': 'Consultation de la fiche',
  'tenant.owner_reset': 'Réinitialisation du mot de passe gérant',
  // Apostrophe TYPOGRAPHIQUE (’) et non droite : ces libellés s'affichent tels
  // quels dans la fiche d'un client, à côté de phrases qui l'emploient déjà.
  'device.revoke': 'Révocation d’un appareil',
  'screen.revoke': 'Révocation d’un écran',
  'invoice.issue': 'Émission d’une facture',
  'invoice.send': 'Envoi d’un brouillon de facture',
  'invoice.remind': 'Relance d’une facture',
  'invoice.pay': 'Encaissement d’une facture',
  'invoice.cancel': 'Annulation d’une facture',
  'invoice.credit': 'Émission d’un avoir',
  // Ce qui change ici part sur NOTRE page d'accueil, sans relecture : le
  // libellé nomme donc la conséquence (la vitrine), pas le formulaire.
  'platform.social_change': 'Réseaux sociaux de la vitrine',
};

/**
 * ═══ DEUX FAMILLES D'ACTIONS DANS UN SEUL JOURNAL ═══
 *
 * Toutes les actions ci-dessus visaient jusqu'ici un ÉTABLISSEMENT : suspendre
 * un compte, couper une tablette, encaisser une facture. `platform.*` est
 * d'une autre nature — elle porte sur Snack Manager elle-même (les liens
 * affichés sur notre vitrine), et n'a donc aucun `tenantId` à porter.
 *
 * POURQUOI LE MÊME JOURNAL, ALORS. Parce que c'est le même registre qui
 * répond à la même question : « qui, dans l'équipe, a changé quoi, et quand ».
 * Un second journal parallèle obligerait à ouvrir deux écrans pour reconstituer
 * une matinée de travail, et le second — celui qu'on regarde une fois par
 * trimestre — serait le premier à cesser d'être alimenté.
 *
 * CE QUE LE PRÉFIXE COMMANDE, concrètement :
 *   · `adminLogs.tenantId` n'est exigé que pour les actions NON préfixées
 *     `platform.` (packages/db/src/schemas.ts) — une suspension sans
 *     établissement reste refusée à l'écriture ;
 *   · `GET /crm/tenants/:id/logs` filtre par tenant : une ligne de plateforme
 *     n'apparaît donc jamais dans le journal d'un client, ce qui est juste —
 *     elle ne le concerne pas. Elle se lit dans le journal du parc
 *     (`GET /crm/admin-logs`).
 */
export const PLATFORM_LOG_ACTION_PREFIX = 'platform.';

export const PLATFORM_LOG_ACTIONS = [
  'platform.social_change',
] as const satisfies readonly AdminLogAction[];
export type PlatformLogAction = (typeof PLATFORM_LOG_ACTIONS)[number];

/**
 * Cette action porte-t-elle sur la plateforme plutôt que sur un client ?
 *
 * Testé sur le PRÉFIXE et non sur l'appartenance à `PLATFORM_LOG_ACTIONS` :
 * la règle doit valoir pour l'action de plateforme qu'on ajoutera demain sans
 * penser à l'inscrire dans une seconde liste. Accepte `unknown` parce que le
 * modèle Mongoose l'appelle sur un champ non encore validé.
 */
export const isPlatformLogAction = (action: unknown): boolean =>
  typeof action === 'string' && action.startsWith(PLATFORM_LOG_ACTION_PREFIX);

/** Les actions qui visent un établissement — le journal d'un client. */
export const TENANT_LOG_ACTIONS = ADMIN_LOG_ACTIONS.filter(
  (action) => !isPlatformLogAction(action),
);

/**
 * LES GESTES DE FACTURATION, tracés sous leur vrai nom.
 *
 * Ils partagent le journal des suspensions et des révocations — c'est la même
 * histoire qui se raconte, et « relancé le 3, facture émise le 5, encaissée le
 * 12, suspendu le 20 » ne se lit que dans un fil unique. Mais ils ont désormais
 * leur PROPRE action : un encaissement de 139 € journalisé sous `tenant.note`
 * s'affiche « Note interne », c'est-à-dire comme un commentaire libre. Un
 * journal qui se trompe sur la NATURE du geste est exactement ce qu'on regarde
 * en cas de litige, et c'est le moment où il ne doit pas mentir.
 *
 * Trois conséquences concrètes, toutes acquises par ces valeurs :
 *  · le filtre `?action=` de `GET /crm/tenants/:id/logs` isole les gestes
 *    comptables des commentaires d'équipe ;
 *  · `targetId` porte l'identifiant de la PIÈCE, ce qu'une note ne portait pas ;
 *  · `meta` porte le numéro, le montant et le moyen de règlement, relisibles
 *    par une machine — la phrase française, elle, reste dans `reason`.
 *
 * La RELANCE (`invoice.remind`) en fait partie au même titre : elle ne change
 * pas le statut de la pièce, mais c'est bien un geste de facturation rattaché à
 * une facture précise — « relancé le 3 » doit se relire dans le même fil et sous
 * le même `targetId` que « encaissée le 12 ». Tout ce qui passe par
 * `recordInvoiceGesture` porte une action de cette liste.
 */
export const INVOICE_LOG_ACTIONS = [
  'invoice.issue',
  'invoice.send',
  'invoice.remind',
  'invoice.pay',
  'invoice.cancel',
  'invoice.credit',
] as const satisfies readonly AdminLogAction[];
export type InvoiceLogAction = (typeof INVOICE_LOG_ACTIONS)[number];

/**
 * Le CONTEXTE MACHINE d'une ligne de facturation.
 *
 * La phrase rédigée (`BILLING_JOURNAL`, @sm/contracts) reste dans `reason` : un
 * journal se lit d'abord avec des yeux. Ces champs-là existent pour tout ce que
 * la phrase ne permet pas — recompter une année d'encaissements, retrouver une
 * pièce par son numéro, vérifier un moyen de règlement sans analyser du texte.
 *
 * Les types restent PRIMITIFS à dessein : `billing.ts` importe `admin.ts`, donc
 * `admin.ts` ne peut pas importer `InvoiceKind` sans créer un cycle de modules.
 * La valeur écrite est celle de la facture, sans traduction.
 */
export type AdminInvoiceLogMeta = {
  /** Numéro de pièce — « SM-2026-0007 ». */
  number: string;
  /** Nature : `abonnement`, `mise_en_place`, `option`… */
  kind: string;
  /** Période facturée, clé « AAAA-MM ». */
  period: string;
  /** Montant en CENTIMES. */
  amountCents: number;
  /** Échéance (ISO) — émission. */
  dueAt?: string;
  /** Statut STOCKÉ à l'émission : `brouillon` ou `envoyee`. */
  storedStatus?: string;
  /** Moyen de règlement — encaissement. */
  method?: string;
  /** Date de règlement (ISO) — encaissement. */
  paidAt?: string;
  /** Motif — annulation. */
  cancelReason?: string;
  /** Canal de relance (`appel`, `sms`…) — relance. */
  channel?: string;
  /**
   * Numéro de la facture d'ORIGINE — avoir. C'est ce champ qui lie l'avoir à la
   * pièce qu'il corrige : la ligne de journal doit permettre de remonter du
   * « SM-2026-0009 » négatif au « SM-2026-0004 » réglé qu'il rembourse.
   */
  originNumber?: string;
};

/**
 * Ce que la facturation demande au journal d'écrire.
 *
 * `summary` est la phrase déjà rédigée par `BILLING_JOURNAL` : le journal ne
 * réécrit pas les mots de la facturation, il les enregistre.
 */
export type AdminInvoiceGesture = {
  action: InvoiceLogAction;
  /** Identifiant de la facture concernée — devient le `targetId` de la ligne. */
  invoiceId: string;
  /** La phrase française, telle qu'elle se lira dans le journal. */
  summary: string;
  meta: AdminInvoiceLogMeta;
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
  /**
   * L'établissement visé — `null` pour une action de PLATEFORME
   * (`platform.*`), qui n'en vise aucun. Le distinguer d'une chaîne vide n'est
   * pas de la coquetterie : `''` se lit « identifiant manquant », `null` se lit
   * « cette action ne concerne pas un client », et seule la seconde est vraie.
   */
  tenantId: string | null;
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

/**
 * Acter le DÉPART d'un client exige un motif, comme la suspension : « pourquoi
 * nous a-t-il quittés ? » est la question qu'on se posera à chaque bilan, et la
 * réponse doit se lire dans le journal — pas se reconstituer de mémoire. Le
 * départ ne coupe pas l'accès (cf. `isAccessBlocked`) : ce n'est pas une
 * sanction, c'est un constat.
 */
export const TenantChurnSchema = z.object({
  reason: z.string().trim().min(3, 'Indiquez le motif du départ').max(500),
});
export type TenantChurn = z.infer<typeof TenantChurnSchema>;

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
/**
 * L'Atelier signé d'un client — les services vendus avec l'abonnement, datés
 * de la signature. `null` : rien de vendu (les clients d'avant l'Atelier
 * comme ceux qui n'ont pris que le logiciel).
 */
export type AdminTenantAtelier = import('./crm').LeadServices & { signedAt: string };

export type AdminTenantAccount = {
  tenantId: string;
  name: string;
  slug: string;
  /** `null` = client Atelier seul — aucun abonnement logiciel. */
  plan: AdminPlan | null;
  /** Le module de commande en ligne — vendu à part de la formule, 79 €/mois. */
  onlineOrdering: boolean;
  /** L'engagement signé : au mois, ou à l'année avec deux mois offerts. */
  billingCycle: 'mensuel' | 'annuel';
  founderSeat: boolean;
  /** Fin de la remise fondateur, ou `null` — un booléen ne peut pas expirer. */
  founderUntil: string | null;
  /**
   * La remise MENSUELLE figée au contrat signé, ou `null`.
   *
   * Un montant et non un taux : c'est ce qui rend vraie la règle vendue — la
   * moitié sur ce qui a été signé, plein tarif sur ce qui s'ajoute après. Les
   * écrans qui chiffrent une offre en ont besoin pour ne pas annoncer le tarif
   * public à côté d'un montant remisé.
   */
  founderDiscountCents: number | null;
  account: TenantAccount;
  /** Résultat de la règle d'accès, calculé une fois côté API. */
  accessBlocked: boolean;
  statusLabel: string;
  atelier: AdminTenantAtelier | null;
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
