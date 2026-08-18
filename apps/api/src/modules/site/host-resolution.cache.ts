import { Inject, Injectable } from '@nestjs/common';
import type { Clock } from '@sm/domain';
import { CLOCK } from './site.tokens';
import type { ResolvedHost } from './site.view';

/**
 * Cache mémoire de la résolution Host → établissement.
 *
 * Le middleware du site public interroge `/public/resolve` à CHAQUE requête,
 * page et image comprises. Sans cache, un service du soir à 200 commandes
 * produirait des milliers de lectures Mongo pour une réponse qui ne change
 * qu'au rythme des bascules de domaine, soit quelques fois par an.
 *
 * Durées volontairement courtes : un domaine qui vient de passer `active` doit
 * servir dans la minute, et le cache est local à chaque instance de l'API
 * (aucune invalidation distribuée à orchestrer).
 */
const HIT_TTL_MS = 60_000;
/** Les échecs expirent plus vite : ils précèdent souvent une activation. */
const MISS_TTL_MS = 10_000;
/** Un Host arbitraire suffit à créer une entrée : on plafonne pour ne pas fuir. */
const MAX_ENTRIES = 500;

interface Entry {
  readonly value: ResolvedHost | null;
  readonly expiresAt: number;
}

@Injectable()
export class HostResolutionCache {
  private readonly entries = new Map<string, Entry>();

  constructor(@Inject(CLOCK) private readonly clock: Clock) {}

  /** `undefined` = inconnu du cache · `null` = absence confirmée récemment. */
  get(hostname: string): ResolvedHost | null | undefined {
    const entry = this.entries.get(hostname);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.clock.now().getTime()) {
      this.entries.delete(hostname);
      return undefined;
    }
    return entry.value;
  }

  set(hostname: string, value: ResolvedHost | null): void {
    // Map conserve l'ordre d'insertion : la première clé est la plus ancienne.
    if (this.entries.size >= MAX_ENTRIES) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    this.entries.set(hostname, {
      value,
      expiresAt: this.clock.now().getTime() + (value ? HIT_TTL_MS : MISS_TTL_MS),
    });
  }

  /** Ajout, vérification, suppression : l'écran ne doit pas attendre le TTL. */
  forget(hostname: string): void {
    this.entries.delete(hostname);
  }
}
