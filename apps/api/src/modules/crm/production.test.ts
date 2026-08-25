import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { PRODUCTION_TASKS, type JwtPayload } from '@sm/contracts';
import { AtelierTickSchema } from '@sm/db';
import type { AtelierTick, Tenant } from '@sm/db';
import { ProductionService } from './production.service';

/**
 * La file de production dérive le dû du signé et n'écrit que les coches :
 * ces tests verrouillent la dérivation par client, le refus des coches sans
 * promesse, et la frontière « la semaine prochaine n'est pas encore due ».
 */

// Mercredi 26 août 2026, midi UTC — semaine parisienne 2026-W35 (24 → 30 août).
const NOW = new Date('2026-08-26T12:00:00.000Z');
const ACTOR = { sub: 'operateur-1', tenantId: null, role: 'sm_admin' } as JwtPayload;

const KEBAB = new Types.ObjectId();
const SNACK = new Types.ObjectId();

const parc = () => [
  {
    _id: KEBAB,
    name: 'Kebab du Port',
    slug: 'kebab-du-port',
    atelier: { presenceInternet: true, reseauxSociaux: null, signedAt: new Date('2026-08-01') },
  },
  {
    _id: SNACK,
    name: 'Snack de la Gare',
    slug: 'snack-gare',
    atelier: { presenceInternet: false, reseauxSociaux: 'bihebdo', signedAt: new Date('2026-08-10') },
  },
];

function build(over: { rows?: unknown[]; ticks?: unknown[]; tenant?: unknown } = {}) {
  const tenants = {
    find: vi.fn().mockReturnValue({
      sort: () => ({ lean: () => Promise.resolve(over.rows ?? parc()) }),
    }),
    findById: vi.fn().mockReturnValue({
      lean: () => Promise.resolve(over.tenant === undefined ? parc()[1] : over.tenant),
    }),
  };
  const ticks = {
    find: vi.fn().mockReturnValue({ lean: () => Promise.resolve(over.ticks ?? []) }),
    updateOne: vi.fn().mockResolvedValue({}),
    deleteOne: vi.fn().mockResolvedValue({}),
  };
  const service = new ProductionService(
    tenants as unknown as Model<Tenant>,
    ticks as unknown as Model<AtelierTick>,
  );
  return { service, tenants, ticks };
}

describe('la file d’une semaine', () => {
  it('dérive les tâches du signé, coche depuis la base, et navigue', async () => {
    const { service } = build({
      ticks: [
        { tenantId: SNACK, week: '2026-W35', task: 'social_pub_1', doneAt: NOW, note: 'lien du post' },
      ],
    });
    const file = await service.week(undefined, NOW);

    expect(file.week).toBe('2026-W35');
    expect(file.label).toBe('du 24 au 30 août');
    // La semaine courante n'a PAS de « suivante » : rien ne se doit d'avance.
    expect(file.next).toBeNull();
    expect(file.previous).toBe('2026-W34');

    expect(file.clients.map((c) => c.name)).toEqual(['Kebab du Port', 'Snack de la Gare']);
    const [kebab, snack] = file.clients;
    expect(kebab?.tasks.map((t) => t.key)).toEqual(['presence_avis']);
    expect(snack?.tasks.map((t) => [t.key, t.done])).toEqual([
      ['social_pub_1', true],
      ['social_pub_2', false],
    ]);
    expect(snack?.tasks[0]?.note).toBe('lien du post');
    expect(file.done).toBe(1);
    expect(file.total).toBe(3);
  });

  it('refuse la semaine prochaine et les clefs invalides', async () => {
    const { service } = build();
    await expect(service.week('2026-W36', NOW)).rejects.toThrow(BadRequestException);
    await expect(service.week('2026-13', NOW)).rejects.toThrow(BadRequestException);
  });

  it('une promesse signée APRÈS la semaine regardée n’y était pas due', async () => {
    const { service } = build({
      rows: [
        {
          _id: KEBAB,
          name: 'Kebab du Port',
          slug: 'kebab-du-port',
          // Signé le jeudi de la W35 : la W34 (17 → 23 août) reste vide.
          atelier: { presenceInternet: true, reseauxSociaux: null, signedAt: new Date('2026-08-27') },
        },
      ],
    });
    expect((await service.week('2026-W34', NOW)).clients).toEqual([]);
    expect((await service.week('2026-W35', NOW)).clients).toHaveLength(1);
  });

  it('le rapport mensuel n’apparaît que sa semaine — celle qui contient un 1er', async () => {
    const { service } = build({ rows: [parc()[0]] });
    // Semaine du 3 août 2026 : pas de 1er dedans (le 1er août est un samedi
    // de la semaine d'avant) — les avis seuls.
    const w32 = await service.week('2026-W32', NOW);
    expect(w32.clients[0]?.tasks.map((t) => t.key)).toEqual(['presence_avis']);
    // Semaine du 27 juillet au 2 août : le 1er août tombe dedans — rapport de juillet.
    const w31 = await service.week('2026-W31', NOW);
    expect(w31.clients[0]?.tasks.map((t) => t.key)).toEqual(['presence_avis', 'presence_rapport']);
    expect(w31.clients[0]?.tasks[1]?.label).toContain('juillet');
  });
});

describe('cocher une tâche', () => {
  it('écrit la coche avec son auteur, et la retire sur décoche', async () => {
    const { service, ticks } = build();
    await service.tick(ACTOR, String(SNACK), {
      week: '2026-W35',
      task: 'social_pub_2',
      done: true,
      note: '',
    }, NOW);
    expect(ticks.updateOne).toHaveBeenCalledWith(
      { tenantId: SNACK, week: '2026-W35', task: 'social_pub_2' },
      { $set: { doneAt: NOW, doneBy: 'operateur-1', note: '' } },
      { upsert: true },
    );

    await service.tick(ACTOR, String(SNACK), {
      week: '2026-W35',
      task: 'social_pub_2',
      done: false,
      note: '',
    }, NOW);
    expect(ticks.deleteOne).toHaveBeenCalledWith({
      tenantId: SNACK,
      week: '2026-W35',
      task: 'social_pub_2',
    });
  });

  it('refuse une coche sans promesse derrière, une semaine future, un client fantôme', async () => {
    const { service } = build();
    // Le Snack de la Gare est en bihebdo : les avis Google ne lui sont pas dus.
    await expect(
      service.tick(ACTOR, String(SNACK), { week: '2026-W35', task: 'presence_avis', done: true, note: '' }, NOW),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.tick(ACTOR, String(SNACK), { week: '2026-W36', task: 'social_pub_1', done: true, note: '' }, NOW),
    ).rejects.toThrow(BadRequestException);
    const fantome = build({ tenant: null });
    await expect(
      fantome.service.tick(ACTOR, String(SNACK), { week: '2026-W35', task: 'social_pub_1', done: true, note: '' }, NOW),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('cohérence contrats ↔ base', () => {
  it('les clefs de tâches de la collection sont EXACTEMENT celles des contrats', () => {
    // `@sm/db` reste sans dépendance : son enum est une recopie, et c'est ce
    // test qui casse le jour où l'une des deux listes bouge sans l'autre.
    const enBase = (AtelierTickSchema.path('task') as unknown as { options: { enum: string[] } })
      .options.enum;
    expect([...enBase].sort()).toEqual([...PRODUCTION_TASKS].sort());
  });
});
