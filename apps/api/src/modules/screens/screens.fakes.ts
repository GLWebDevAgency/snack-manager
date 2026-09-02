import type { Clock } from '@sm/domain';
import type { ScreenScene } from '@sm/contracts';
import type { RawDayHours } from './daypart';
import type {
  BoardCategory,
  BoardIdentity,
  BoardProduct,
  BoardPromo,
  BoardSnapshot,
  MenuBoardRepository,
} from './menu-board.repository';
import type { NewScreen, ScreenPatch, ScreensRepository, StoredScreen } from './screens.repository';

/**
 * Doublures de test du Menu Board.
 *
 * Elles existent parce que les cas d'usage ne dépendent que de deux dépôts et
 * d'une horloge : le dayparting midi / soir / fermé se vérifie en
 * millisecondes, sans Mongo et sans attendre 18 h.
 */

/** Horloge figée — le dayparting est intestable avec `Date.now()`. */
export class TestClock implements Clock {
  constructor(private instant = new Date('2026-08-19T10:30:00Z')) {}

  now(): Date {
    return new Date(this.instant);
  }

  set(instant: Date | string): void {
    this.instant = new Date(instant);
  }

  advanceMinutes(minutes: number): void {
    this.instant = new Date(this.instant.getTime() + minutes * 60_000);
  }
}

const CLASSFOOD_LUNCH = { open: '11:30', close: '14:30' };
const CLASSFOOD_DINNER = { open: '18:00', close: '22:30' };

/**
 * Les horaires réels du pilote : 7 j / 7, midi et soir — sauf lundi et vendredi
 * où seul le service du soir tourne. C'est précisément le cas qu'une plage
 * unique par jour ne saurait pas décrire.
 */
export function classFoodHours(): RawDayHours[] {
  return [1, 2, 3, 4, 5, 6, 7].map((day) => ({
    day,
    lunch: day === 1 || day === 5 ? null : CLASSFOOD_LUNCH,
    dinner: CLASSFOOD_DINNER,
  }));
}

export function boardIdentity(patch: Partial<BoardIdentity> = {}): BoardIdentity {
  return {
    tenantId: '65f000000000000000000001',
    slug: 'classfood',
    name: "Class'Food",
    logoUrl: null,
    brandColor: '#c9a15a',
    hours: classFoodHours(),
    ...patch,
  };
}

export function boardProduct(patch: Partial<BoardProduct> & { id: string }): BoardProduct {
  return {
    categoryId: 'cat-tacos',
    name: 'Tacos',
    description: 'Viande, frites, sauce fromagère',
    priceCents: 850,
    variantPrices: [],
    photoUrl: null,
    photoPoint: null,
    isNew: false,
    outOfStock: false,
    tags: [],
    ...patch,
  };
}

export function boardSnapshot(patch: Partial<BoardSnapshot> = {}): BoardSnapshot {
  return {
    identity: boardIdentity(),
    categories: [
      { id: 'cat-tacos', name: 'Tacos' },
      { id: 'cat-desserts', name: 'Desserts' },
    ],
    products: [
      boardProduct({ id: 'p1', name: 'Tacos M', priceCents: 850 }),
      boardProduct({ id: 'p2', name: 'Tacos L', priceCents: 1050 }),
    ],
    promos: [],
    ...patch,
  };
}

export function storedScreen(patch: Partial<StoredScreen> = {}): StoredScreen {
  return {
    id: 'screen-1',
    tenantId: '65f000000000000000000001',
    name: 'Écran comptoir gauche',
    pairingCode: null,
    pairingCodeExpiresAt: null,
    paired: true,
    orientation: 'landscape',
    theme: 'brand',
    playlist: [scene({ kind: 'category', categoryId: 'cat-tacos', title: 'Tacos' })],
    lastSeenAt: null,
    active: true,
    ...patch,
  };
}

export function scene(patch: Partial<ScreenScene> & { kind: ScreenScene['kind'] }): ScreenScene {
  return {
    categoryId: null,
    productIds: [],
    title: null,
    durationMs: 10_000,
    ...patch,
  };
}

/** Dépôt d'écrans en mémoire — mêmes garanties d'unicité que la version Mongo. */
export class FakeScreensRepository {
  private readonly rows = new Map<string, StoredScreen>();
  private readonly tokens = new Map<string, string>(); // jeton → id d'écran
  private sequence = 0;

  seed(screen: StoredScreen, deviceToken?: string): StoredScreen {
    this.rows.set(screen.id, screen);
    if (deviceToken) this.tokens.set(deviceToken, screen.id);
    return screen;
  }

  async list(tenantId: string): Promise<StoredScreen[]> {
    return [...this.rows.values()].filter((s) => s.tenantId === tenantId);
  }

  async byId(tenantId: string, id: string): Promise<StoredScreen | null> {
    const row = this.rows.get(id);
    return row && row.tenantId === tenantId ? row : null;
  }

  async create(tenantId: string, screen: NewScreen): Promise<StoredScreen> {
    const created = storedScreen({
      id: `screen-${++this.sequence}`,
      tenantId,
      name: screen.name,
      orientation: screen.orientation,
      theme: screen.theme,
      playlist: screen.playlist,
      pairingCode: screen.pairingCode,
      pairingCodeExpiresAt: screen.pairingCodeExpiresAt,
      paired: false,
    });
    this.rows.set(created.id, created);
    return created;
  }

  async update(tenantId: string, id: string, patch: ScreenPatch): Promise<StoredScreen | null> {
    const row = await this.byId(tenantId, id);
    if (!row) return null;
    const updated: StoredScreen = { ...row };
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) Object.assign(updated, { [key]: value });
    }
    this.rows.set(id, updated);
    return updated;
  }

  async remove(tenantId: string, id: string): Promise<boolean> {
    const row = await this.byId(tenantId, id);
    if (!row) return false;
    this.rows.delete(id);
    return true;
  }

  async resetPairing(
    tenantId: string,
    id: string,
    code: string,
    expiresAt: Date,
  ): Promise<StoredScreen | null> {
    const row = await this.byId(tenantId, id);
    if (!row) return null;
    for (const [token, screenId] of this.tokens) {
      if (screenId === id) this.tokens.delete(token);
    }
    const updated: StoredScreen = {
      ...row,
      pairingCode: code,
      pairingCodeExpiresAt: expiresAt,
      paired: false,
      lastSeenAt: null,
    };
    this.rows.set(id, updated);
    return updated;
  }

  async findByPairingCode(code: string): Promise<StoredScreen | null> {
    return [...this.rows.values()].find((s) => s.pairingCode === code) ?? null;
  }

  async claim(id: string, code: string, deviceToken: string, at: Date): Promise<boolean> {
    const row = this.rows.get(id);
    // Même condition que l'écriture Mongo : le code doit être ENCORE posé.
    if (!row || row.pairingCode !== code) return false;
    this.rows.set(id, {
      ...row,
      pairingCode: null,
      pairingCodeExpiresAt: null,
      paired: true,
      lastSeenAt: at,
    });
    this.tokens.set(deviceToken, id);
    return true;
  }

  async findByDeviceToken(deviceToken: string): Promise<StoredScreen | null> {
    const id = this.tokens.get(deviceToken);
    const row = id ? this.rows.get(id) : undefined;
    return row?.paired ? row : null;
  }

  async touch(id: string, at: Date): Promise<void> {
    const row = this.rows.get(id);
    if (row) this.rows.set(id, { ...row, lastSeenAt: at });
  }

  asRepository(): ScreensRepository {
    return this as unknown as ScreensRepository;
  }
}

/** Modèle de lecture en mémoire de la carte. */
export class FakeMenuBoardRepository {
  constructor(private current: BoardSnapshot | null = boardSnapshot()) {}

  set(snapshot: BoardSnapshot | null): void {
    this.current = snapshot;
  }

  async snapshot(): Promise<BoardSnapshot | null> {
    return this.current;
  }

  asRepository(): MenuBoardRepository {
    return this as unknown as MenuBoardRepository;
  }
}

export type { BoardCategory, BoardPromo, BoardSnapshot };
