import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { SlotsService, type TenantWithId } from './slots.service';

/**
 * LE CRÉNEAU EST VÉRIFIÉ À L'ÉCRITURE, PAS SEULEMENT PROPOSÉ.
 *
 * `compute` savait déjà tout — capacité restante, fermetures exceptionnelles,
 * délai de préparation — et rien ne le relisait au moment d'enregistrer la
 * commande. Le tunnel grisait les créneaux pleins, ce qui arrête un client
 * honnête et personne d'autre : un appel direct posait des commandes sur un
 * créneau affiché « complet », ou un jour de fermeture, et la cuisine recevait
 * ce qu'elle avait explicitement déclaré ne pas pouvoir honorer.
 *
 * Le client resté dix minutes sur l'étape paiement est le cas le plus fréquent,
 * et le moins malveillant : son créneau est revérifié au moment où il valide.
 */

/** Un restaurant ouvert 11h–14h et 18h–22h tous les jours, capacité 2. */
const RESTAURANT = {
  _id: '507f1f77bcf86cd799439011',
  hours: Array.from({ length: 7 }, (_, i) => ({
    day: i + 1,
    lunch: { open: '11:00', close: '14:00' },
    dinner: { open: '18:00', close: '22:00' },
  })),
  closures: [],
  settings: { slotIntervalMin: 30, slotCapacity: 2 },
} as unknown as TenantWithId;

/**
 * Un service dont la base rend `pris` commandes SUR LE CRÉNEAU VISÉ.
 *
 * L'agrégation groupe par `pickup.slot` : la doublure rend donc une ligne
 * datée, comme Mongo le ferait, plutôt qu'un compteur global — sans quoi le
 * test mesurerait autre chose que ce que le service lit.
 */
function service(pris: number, sur?: string) {
  const rows = pris > 0 && sur ? [{ _id: new Date(sur), count: pris }] : [];
  return new SlotsService({ aggregate: vi.fn().mockResolvedValue(rows) } as never);
}

/** Un créneau de demain midi, à coup sûr ouvert et hors délai de préparation. */
function creneauDemain(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(10, 0, 0, 0); // 12h00 à Paris en été, 11h00 en hiver
  return d.toISOString();
}

describe('refuser un créneau qu’on ne peut pas honorer', () => {
  it('refuse une date illisible avant même de regarder la journée', async () => {
    await expect(service(0).exigerDisponible(RESTAURANT, 'pas-une-date')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuse un créneau PASSÉ — le délai de préparation ne peut plus être tenu', async () => {
    const hier = new Date();
    hier.setUTCDate(hier.getUTCDate() - 1);
    await expect(
      service(0).exigerDisponible(RESTAURANT, hier.toISOString()),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuse un créneau hors des heures d’ouverture', async () => {
    const nuit = new Date();
    nuit.setUTCDate(nuit.getUTCDate() + 1);
    nuit.setUTCHours(2, 0, 0, 0); // 4h du matin à Paris
    await expect(
      service(0).exigerDisponible(RESTAURANT, nuit.toISOString()),
    ).rejects.toThrow(/n’est plus disponible/);
  });

  it('refuse un créneau COMPLET, et le nomme par son heure', async () => {
    // Deux places, deux prises : le suivant se fait refuser, même s'il a vu
    // « 1 libre » dix minutes plus tôt.
    const vise = creneauDemain();
    await expect(service(2, vise).exigerDisponible(RESTAURANT, vise)).rejects.toThrow(
      /vient d’être complet/,
    );
  });

  it('laisse passer un créneau ouvert et disponible', async () => {
    await expect(service(0).exigerDisponible(RESTAURANT, creneauDemain())).resolves.toBeUndefined();
  });

  it('refuse un jour de FERMETURE en donnant le motif au client', async () => {
    const demain = new Date();
    demain.setUTCDate(demain.getUTCDate() + 1);
    const jour = demain.toISOString().slice(0, 10);
    const ferme = {
      ...RESTAURANT,
      closures: [{ from: `${jour}T00:00`, to: `${jour}T23:59`, reason: 'Congés annuels' }],
    } as unknown as TenantWithId;

    // Le motif est déjà rédigé pour le client : c'est lui qu'il doit lire,
    // pas un « créneau indisponible » qui ne dit pas de revenir quand.
    await expect(service(0).exigerDisponible(ferme, creneauDemain())).rejects.toThrow(
      /Congés annuels/,
    );
  });
});
