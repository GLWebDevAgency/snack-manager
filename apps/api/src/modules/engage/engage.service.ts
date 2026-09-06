import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { Promotion, Review } from '@sm/db';
import { demoSeedEnabled } from '../../common/demo-seed';
import type { PromotionCreate, PromotionUpdate } from './engage.dto';

const DAY_MS = 86_400_000;

/**
 * Avis de démo (source `manual`) insérés au premier GET si la collection du
 * tenant est vide — matière réaliste pour la vue Avis, datée sur 3 semaines.
 */
const SEED_REVIEWS: {
  author: string;
  rating: number;
  text: string;
  daysAgo: number;
  reply?: string;
}[] = [
  {
    author: 'Yassine B.',
    rating: 5,
    daysAgo: 2,
    text: 'Tacos au top, la viande est super bien assaisonnée et la sauce fromagère maison est incroyable. Je recommande les yeux fermés !',
  },
  {
    author: 'Marie L.',
    rating: 5,
    daysAgo: 3,
    text: "Commande en ligne hyper pratique, c'était prêt pile à l'heure. Le personnel est adorable.",
    reply: 'Merci Marie, à très vite ! 🔥',
  },
  {
    author: 'Karim D.',
    rating: 4,
    daysAgo: 5,
    text: "Très bon smash burger, la box est copieuse. Un poil d'attente le vendredi soir mais ça vaut le coup.",
  },
  {
    author: 'Sofia M.',
    rating: 5,
    daysAgo: 7,
    text: 'Le meilleur snack du quartier, portions généreuses et produits frais. On revient chaque semaine !',
  },
  {
    author: 'Thomas R.',
    rating: 3,
    daysAgo: 8,
    text: 'Correct sans plus, les frites manquaient un peu de sel. Le burger était très bon par contre.',
  },
  {
    author: 'Nadia H.',
    rating: 5,
    daysAgo: 9,
    text: "Family Box parfaite pour 4, tout le monde s'est régalé. Merci pour les bonbons des enfants 😊",
    reply: "Merci Nadia ! La Family Box, c'est fait pour ça 💪",
  },
  {
    author: 'Lucas P.',
    rating: 4,
    daysAgo: 11,
    text: 'Bonne découverte, le créneau de retrait était respecté à la minute. Je reviendrai tester le menu du moment.',
  },
  {
    author: 'Inès B.',
    rating: 2,
    daysAgo: 12,
    text: 'Déçue ce soir-là : 25 minutes de retard sur le créneau et le tacos était tiède en arrivant à la maison.',
    reply: 'Désolés Inès, gros coup de feu vendredi soir — repassez nous voir, on se rattrapera !',
  },
  {
    author: 'Mehdi K.',
    rating: 5,
    daysAgo: 14,
    text: 'Le Boss est énorme, cuisson parfaite, pain brioché moelleux. Rapport qualité-prix imbattable.',
  },
  {
    author: 'Julie V.',
    rating: 4,
    daysAgo: 16,
    text: "Très bon, commande simple sur l'app. Petit bémol sur le paiement CB qui a mis du temps à passer.",
  },
  {
    author: 'Romain G.',
    rating: 2,
    daysAgo: 18,
    text: "Erreur dans ma commande, il manquait les suppléments pourtant payés. Dommage car c'était bon.",
  },
  {
    author: 'Amel Z.',
    rating: 5,
    daysAgo: 20,
    text: "Toujours au top depuis l'ouverture, l'équipe est souriante et le service va vite. Bravo !",
    reply: 'Merci Amel pour ta fidélité 🙏',
  },
];

@Injectable()
export class EngageService {
  /** Tenants dont le seed avis est déjà passé (garde anti-double-insert). */
  private readonly seededTenants = new Set<string>();

  constructor(
    @InjectModel('Promotion') private readonly promotions: Model<Promotion>,
    @InjectModel('Review') private readonly reviews: Model<Review>,
  ) {}

  // ─── Promotions ───

  listPromotions(tenantId: string) {
    return this.promotions.find({ tenantId }).sort({ createdAt: -1 }).lean();
  }

  async createPromotion(tenantId: string, dto: PromotionCreate) {
    if (dto.code) {
      const dup = await this.promotions.findOne({ tenantId, code: dto.code }).lean();
      if (dup) throw new ConflictException(`Le code « ${dto.code} » existe déjà`);
    }
    return this.promotions.create({ ...dto, tenantId });
  }

  async updatePromotion(tenantId: string, id: string, dto: PromotionUpdate) {
    if (dto.code) {
      const dup = await this.promotions
        .findOne({ tenantId, code: dto.code, _id: { $ne: id } })
        .lean();
      if (dup) throw new ConflictException(`Le code « ${dto.code} » existe déjà`);
    }
    const $set: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(dto)) {
      if (v !== undefined) $set[k] = v;
    }
    const promo = await this.promotions.findOneAndUpdate(
      { _id: id, tenantId },
      { $set },
      { new: true },
    );
    if (!promo) throw new NotFoundException('Promotion introuvable');
    return promo;
  }

  /** Bascule actif/inactif (toggle 1-clic de la carte promo). */
  async togglePromotion(tenantId: string, id: string) {
    // Une hydratation suivie de save() réécrirait les défauts absents d'un
    // ancien document, notamment usageCount:0 après une réservation concurrente.
    // La bascule se calcule en base et ne touche jamais au compteur.
    const promo = await this.promotions.findOneAndUpdate(
      { _id: id, tenantId },
      [{ $set: { active: { $cond: [
        // Le défaut historique Mongoose est actif seulement si le champ manque.
        { $eq: [{ $type: '$active' }, 'missing'] }, false, { $not: ['$active'] },
      ] } } }],
      { new: true },
    );
    if (!promo) throw new NotFoundException('Promotion introuvable');
    return promo;
  }

  async deletePromotion(tenantId: string, id: string) {
    const res = await this.promotions.deleteOne({ _id: id, tenantId });
    if (res.deletedCount === 0) throw new NotFoundException('Promotion introuvable');
    return { deleted: true };
  }

  // ─── Avis ───

  /**
   * Seed léger inline : ~12 avis français réalistes si la collection est vide.
   *
   * GARDÉ PAR `demoSeedEnabled`, comme le pipeline CRM et la facturation — et
   * ce garde-fou a une histoire : jusqu'au 24/08/2026, il manquait ICI, si
   * bien qu'un VRAI restaurant en production aurait vu douze avis de fiction
   * dans son onglet Avis à la première ouverture. C'est mot pour mot le piège
   * que `common/demo-seed.ts` documente. Le correctif est une ligne ; qu'elle
   * ne reparte jamais.
   */
  private async ensureReviewSeed(tenantId: string) {
    if (!demoSeedEnabled()) return;
    if (this.seededTenants.has(tenantId)) return;
    this.seededTenants.add(tenantId);
    const count = await this.reviews.countDocuments({ tenantId });
    if (count > 0) return;
    const now = Date.now();
    const docs = SEED_REVIEWS.map((r) => {
      const at = new Date(now - r.daysAgo * DAY_MS);
      return {
        tenantId,
        orderId: null,
        author: r.author,
        rating: r.rating,
        text: r.text,
        source: 'manual' as const,
        reply: r.reply
          ? { text: r.reply, at: new Date(at.getTime() + DAY_MS / 2), by: 'gerant' }
          : null,
        createdAt: at,
        updatedAt: at,
      };
    });
    // Les createdAt/updatedAt antidatés fournis explicitement sont conservés :
    // le plugin timestamps de mongoose ne remplace jamais une valeur déjà posée.
    await this.reviews.insertMany(docs);
  }

  /** Liste des avis, plus récents d'abord. `pending` = sans réponse. */
  async listReviews(tenantId: string, filter: 'all' | 'pending') {
    await this.ensureReviewSeed(tenantId);
    const query: Record<string, unknown> = { tenantId };
    if (filter === 'pending') query.reply = null;
    return this.reviews.find(query).sort({ createdAt: -1 }).lean();
  }

  /** Note moyenne (1 décimale), répartition 1-5, volumes mois/total/en attente. */
  async reviewsSummary(tenantId: string) {
    await this.ensureReviewSeed(tenantId);
    const all = await this.reviews.find({ tenantId }).select('rating reply createdAt').lean();
    const counts: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let sum = 0;
    let pending = 0;
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    let monthCount = 0;
    for (const r of all) {
      const star = Math.min(5, Math.max(1, Math.round(r.rating))) as 1 | 2 | 3 | 4 | 5;
      counts[star] += 1;
      sum += r.rating;
      if (!r.reply) pending += 1;
      if (r.createdAt && new Date(r.createdAt) >= monthStart) monthCount += 1;
    }
    const total = all.length;
    return {
      total,
      avg: total === 0 ? 0 : Math.round((sum / total) * 10) / 10,
      counts,
      pending,
      monthCount,
    };
  }

  /**
   * Réponse publique du gérant. Une seule réponse par avis (pas d'édition,
   * spec §11.2) — 409 si l'avis a déjà été répondu.
   */
  async replyToReview(tenantId: string, id: string, text: string, by: string) {
    const review = await this.reviews.findOneAndUpdate(
      { _id: id, tenantId, reply: null },
      { $set: { reply: { text, at: new Date(), by } } },
      { new: true },
    );
    if (!review) {
      const exists = await this.reviews.findOne({ _id: id, tenantId }).lean();
      if (!exists) throw new NotFoundException('Avis introuvable');
      throw new ConflictException('Cet avis a déjà reçu une réponse');
    }
    return review;
  }
}
