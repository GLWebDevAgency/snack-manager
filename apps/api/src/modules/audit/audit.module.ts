import { Controller, Get, Global, Injectable, Module, Query, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { z } from 'zod';
import {
  AUDIT_ACTION_LABELS,
  type AuditAuthor,
  type AuditAuthorMeans,
  type AuditEntryView,
  type JwtPayload,
  type TenantAuditAction,
} from '@sm/contracts';
import type { AuditLog, Staff, User } from '@sm/db';
import { Roles, TenantId } from '../../common/auth';
import { zod } from '../../common/zod.pipe';

/**
 * QUI AGIT, réduit à ce que la ligne de journal a besoin de savoir.
 *
 * Un `JwtPayload` y répond directement — c'est le cas courant : le geste vient
 * de la session posée sur la requête. Mais pas toujours, et c'est pour cela que
 * le type est ce sous-ensemble plutôt que le jeton lui-même : une annulation de
 * commande est validée par un PIN RE-SAISI par-dessus la session ouverte. La
 * tablette est en session « caisse » quand le gérant vient taper son code ;
 * l'auteur du geste est le gérant, pas la session. Exiger un jeton obligerait
 * à en fabriquer un faux pour dire la vérité.
 */
export type AuditActor = Pick<JwtPayload, 'sub' | 'role' | 'kind'>
  // Une identité dédiée à la livraison, jamais un JWT professionnel fabriqué.
  | { kind: 'delivery'; sub: string; role: 'livreur'; name: string };

/** Stable comparison of immutable receipt data, independent of object key order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

/**
 * Journal append-only des gestes sensibles d'un restaurant — socle NF525.
 *
 * ÉCRIT depuis le premier jour, LISIBLE depuis le 24/08/2026 seulement : un
 * journal qu'aucun écran ne sait montrer ne protège personne au contrôle
 * (diagnostic quatre casquettes, P3). La lecture vit ici même, dans le module
 * du journal — la règle « qui écrit sait relire » évite un lecteur qui
 * réinterprète les entrées à sa façon.
 *
 * ─── CE QU'IL COUVRE ───
 *
 * `TENANT_AUDIT_ACTIONS` (@sm/contracts) énumère les gestes tracés et dit, en
 * commentaire, la règle de périmètre et ce qui en est volontairement écarté.
 * Le tour du produit avait longtemps été fait à moitié : quatre actions
 * déclarées, TROIS écrites, par deux fichiers. Le même geste de masque
 * produisait une ligne quand il venait du CRM et rien quand il venait du
 * restaurateur.
 */
@Injectable()
export class AuditService {
  constructor(
    @InjectModel('AuditLog') private readonly logs: Model<AuditLog>,
    @InjectModel('Staff') private readonly staff: Model<Staff>,
    @InjectModel('User') private readonly users: Model<User>,
  ) {}

  /**
   * ÉCRIT UNE LIGNE. Passage obligé de tout geste journalisé.
   *
   * ─── L'ORDRE : LA MUTATION D'ABORD, LE JOURNAL ENSUITE ───
   *
   * Repris tel quel du journal d'administration (`AdminService.record`), et
   * pour la même raison : journaliser AVANT d'agir produirait, sur une
   * écriture ratée, une ligne affirmant une rupture ou une remise qui n'a pas
   * eu lieu. Un registre qui ment est pire qu'un registre incomplet.
   *
   * ─── ET L'ÉCHEC D'INSERTION REMONTE ───
   *
   * Aucun `try/catch` ici, aucun `void` chez les appelants : si le journal ne
   * s'écrit pas, la requête échoue. C'est un choix ASSUMÉ et il a un coût —
   * une panne du journal fait échouer un geste métier déjà appliqué en base,
   * et le client verra une erreur sur une action qui a en partie réussi.
   *
   * On l'accepte parce que l'inverse coûte plus cher : avaler l'erreur
   * fabriquerait un registre TROUÉ dont personne ne saurait qu'il l'est, et
   * c'est exactement la propriété qu'un registre à valeur probante ne peut pas
   * perdre. Une ligne manquante ne se voit qu'au contrôle, six mois trop tard.
   * Une requête en erreur se voit tout de suite, et le geste se rejoue.
   *
   * (Corollaire déjà en place : le journal et la mutation ne partagent pas de
   * transaction — Mongo n'en ouvre pas ici, et l'approvisionnement écrit même
   * dans une AUTRE base. Un geste appliqué sans sa ligne reste donc possible
   * sur panne franche ; il est signalé, ce qui est le point.)
   */
  async log(entry: {
    tenantId: string;
    action: TenantAuditAction;
    /**
     * LA SESSION À L'ORIGINE DU GESTE, telle que le garde l'a posée sur la
     * requête. Optionnelle pour un appelant sans requête (tâche de fond), et
     * la ligne porte alors `author: null` plutôt qu'un auteur inventé.
     */
    actor?: AuditActor | null;
    /** L'équipier dont le PIN a re-validé un geste de caisse, s'il y en a un. */
    staffId?: string | null;
    targetId?: string;
    meta?: unknown;
    pinVerifiedAt?: Date;
  }) {
    const { actor, ...reste } = entry;
    await this.logs.create({
      ...reste,
      author: actor ? await this.auteur(actor) : null,
      at: new Date(),
    });
  }

  /** Idempotent append ONLY for a durable order operation receipt. The receipt
   * remains the recovery source if this append fails; no audit update/upsert. */
  async logOnce(entry: { tenantId: string; action: 'order.refund' | 'order.collect' | 'order.assign' | 'order.dispatch' | 'order.handoff' | 'order.delivery_incident' | 'order.delivery_override' | 'order.delivery_proof_rotate' | Extract<TenantAuditAction, `dining.${string}`>; targetId: string; actor: AuditActor; meta: unknown }, operationId: string): Promise<void> {
    const key = JSON.stringify([entry.tenantId, entry.action, entry.targetId, operationId]);
    const id = new Types.ObjectId(createHash('sha256').update(key).digest('hex').slice(0, 24));
    const fingerprint = createHash('sha256').update(canonical(entry)).digest('hex');
    const read = () => this.logs.findById(id).read('primary').readConcern('majority').maxTimeMS(10_000).lean();
    const verify = (row: AuditLog | null): boolean => {
      if (!row) return false;
      if (String(row.tenantId) !== entry.tenantId || row.action !== entry.action || row.targetId !== entry.targetId
        || row.deduplication?.key !== key || row.deduplication.fingerprint !== fingerprint) {
        throw new ServiceUnavailableException('Conflit de preuve du journal : rapprochement requis.');
      }
      return true;
    };
    if (verify(await read())) return;
    const { actor, ...rest } = entry;
    try {
      await this.logs.create([{ _id: id, ...rest, author: await this.auteur(actor), at: new Date(),
        deduplication: { key, fingerprint } }], { writeConcern: { w: 'majority', j: true, wtimeout: 10_000 } });
    } catch (error) {
      // Duplicate writer OR lost response: only an identical persisted record
      // proves success. Unknown failures leave the collection receipt intact.
      if (!verify(await read())) throw error;
    }
  }

  /**
   * L'auteur RÉSOLU au moment du geste — nom et rôle recopiés dans la ligne.
   *
   * Une lecture de plus par geste journalisé, comme le journal d'administration
   * en fait une pour `actorEmail`. Elle achète la propriété qui fait tout
   * l'intérêt d'un registre : ce qui est écrit reste écrit, même après un
   * renommage, un changement de rôle ou un départ.
   *
   * Le rôle vient du JETON et non du document : c'est le titre sous lequel la
   * personne a réellement agi. Un gérant promu depuis n'aura pas rétroactivement
   * agi en gérant.
   */
  private async auteur(actor: AuditActor): Promise<AuditAuthor> {
    if (actor.kind === 'delivery') {
      return { id: actor.sub, name: actor.name.trim(), role: actor.role, means: 'delivery_access' };
    }
    const means: AuditAuthorMeans = actor.kind === 'staff' ? 'pin' : 'password';
    return {
      id: String(actor.sub),
      name: await this.nomDe(actor),
      role: String(actor.role),
      means,
    };
  }

  /** Le nom affiché — vide si le compte a disparu entre le geste et sa lecture. */
  private async nomDe(actor: Pick<JwtPayload, 'sub' | 'role' | 'kind'>): Promise<string> {
    if (!Types.ObjectId.isValid(actor.sub)) return '';
    if (actor.kind === 'staff') {
      const membre = await this.staff
        .findById(actor.sub, { name: 1 })
        .lean<{ name?: string } | null>();
      return (membre?.name ?? '').trim();
    }
    const compte = await this.users
      .findById(actor.sub, { name: 1 })
      .lean<{ name?: string } | null>();
    return (compte?.name ?? '').trim();
  }

  /**
   * Le journal d'un établissement, du plus récent au plus ancien.
   *
   * Les NOMS d'équipiers sont résolus en une seule lecture pour les lignes
   * ANCIENNES — celles écrites avant que l'auteur soit dénormalisé : « Sarah »
   * se défend en contrôle, un ObjectId non. Un équipier supprimé s'affiche
   * « équipier supprimé » — le geste reste, c'est le principe même du registre.
   *
   * Les lignes récentes portent leur auteur : aucune jointure ne les touche, et
   * elles se relisent identiques dans dix ans.
   */
  async list(tenantId: string, limit = 100): Promise<AuditEntryView[]> {
    const docs = await this.logs
      .find({ tenantId: new Types.ObjectId(tenantId) })
      .sort({ at: -1, _id: -1 })
      .limit(limit)
      .lean();

    const staffIds = [...new Set(docs.map((d) => String(d.staffId ?? '')).filter(Boolean))];
    const names = new Map(
      (
        await this.staff
          .find({ _id: { $in: staffIds.map((id) => new Types.ObjectId(id)) } }, { name: 1 })
          .lean()
      ).map((s) => [String(s._id), String(s.name ?? '')]),
    );

    return docs.map((d) => ({
      _id: String(d._id),
      at: (d.at ?? new Date(0)).toISOString(),
      action: d.action ?? '',
      actionLabel: AUDIT_ACTION_LABELS[d.action as TenantAuditAction] ?? d.action ?? '',
      staffName: d.staffId ? (names.get(String(d.staffId)) ?? 'équipier supprimé') : '',
      author: vueAuteur(d.author),
      meta: (d.meta ?? {}) as Record<string, unknown>,
    }));
  }
}

/**
 * L'auteur d'une ligne, ramené à la forme du contrat.
 *
 * Défensif à dessein : la collection porte des lignes écrites AVANT ce champ
 * (`author` absent) et le registre ne se réécrit pas pour rattraper une
 * évolution de forme. Une ligne sans `id` exploitable vaut « pas d'auteur »,
 * ce que l'écran sait dire.
 */
export function vueAuteur(brut: unknown): AuditAuthor | null {
  if (brut === null || typeof brut !== 'object') return null;
  const a = brut as Partial<AuditAuthor>;
  if (!a.id || !a.means) return null;
  return {
    id: String(a.id),
    name: String(a.name ?? ''),
    role: String(a.role ?? ''),
    means: a.means,
  };
}

const AuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

/**
 * Lecture du journal par LE GÉRANT — c'est SON registre : la conformité de
 * caisse protège son établissement, il doit pouvoir le montrer sans nous.
 * Tenant-scoped par le jeton, comme toutes ses routes.
 *
 * ─── ET PAR LE COMPTABLE, qui est celui qui le PRODUIT au contrôle ───
 *
 * Le registre des gestes sensibles est la pièce NF525 : annulations, remises,
 * changements de prix. Quand l'administration la demande, c'est le comptable
 * qui la sort — lui refuser la seule route qui la rend obligerait le
 * restaurateur à se reconnecter pour faire une copie d'écran, c'est-à-dire à
 * partager son mot de passe, c'est-à-dire exactement le défaut que ces comptes
 * séparés existent pour fermer.
 *
 * Une seule route, un seul `@Get`, aucune écriture : `AuditService.log` n'est
 * appelé que depuis les gestes eux-mêmes, jamais depuis une route.
 */
@Roles('owner', 'gerant', 'comptable')
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  async list(
    @TenantId() tenantId: string,
    @Query(zod(AuditQuerySchema)) query: { limit: number },
  ) {
    return { entries: await this.audit.list(tenantId, query.limit) };
  }
}

@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
