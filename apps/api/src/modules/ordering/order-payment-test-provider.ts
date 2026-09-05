import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import type { OrderPaymentProvider, ProviderIntent } from './order-payment-lifecycle.service';

type CreateParams = Parameters<OrderPaymentProvider['create']>[0];
type CreateCall = { params: CreateParams; accountId: string; idempotencyKey: string };
type IntentCall = { id: string; accountId: string | null; idempotencyKey?: string };

export function paymentBarrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

/** Observe un rejet immédiatement, même lorsque l'autre acteur attend une barrière. */
export function paymentOutcome<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}

/**
 * Aucun SDK ni réseau : le registre représente le provider, et survit aux
 * instances du service. Une réponse perdue ne supprime PAS l'effet distant.
 */
export class TestOrderPaymentProvider implements OrderPaymentProvider {
  readonly environment = 'test' as const;
  private readonly intents = new Map<string, ProviderIntent>();
  private readonly creations = new Map<string, { fingerprint: string; intentId: string }>();
  readonly hooks: {
    beforeCreate?: (call: CreateCall) => Promise<void>;
    afterCreate?: (call: CreateCall, result: ProviderIntent) => Promise<void>;
    beforeRetrieve?: (call: IntentCall) => Promise<void>;
    beforeCancel?: (call: IntentCall) => Promise<void>;
    afterCancel?: (call: IntentCall, result: ProviderIntent) => Promise<void>;
  } = {};

  private key(id: string, accountId: string | null): string {
    return JSON.stringify([accountId, id]);
  }

  get createdCount(): number { return this.creations.size; }

  seed(intent: ProviderIntent, accountId: string | null): void {
    this.intents.set(this.key(intent.id, accountId), structuredClone(intent));
  }

  snapshot(id: string, accountId: string | null): ProviderIntent {
    const intent = this.intents.get(this.key(id, accountId));
    if (!intent) throw new Error('Intention absente sur ce compte de recette.');
    return structuredClone(intent);
  }

  setStatus(id: string, accountId: string | null, status: string): void {
    this.seed({ ...this.snapshot(id, accountId), status }, accountId);
  }

  readonly create = vi.fn(async (params: CreateParams, accountId: string, idempotencyKey: string): Promise<ProviderIntent> => {
    const call = structuredClone({ params, accountId, idempotencyKey });
    await this.hooks.beforeCreate?.(call);
    const key = this.key(idempotencyKey, accountId);
    const fingerprint = JSON.stringify(params);
    const existing = this.creations.get(key);
    if (existing && existing.fingerprint !== fingerprint) throw new Error('Même clé idempotente avec paramètres différents.');
    if (!existing) {
      const id = `pi_test_${randomUUID().replaceAll('-', '')}`;
      this.seed({ id, client_secret: `${id}_secret`, status: 'requires_payment_method', amount: params.amount,
        currency: params.currency, metadata: structuredClone(params.metadata) }, accountId);
      this.creations.set(key, { fingerprint, intentId: id });
    }
    const result = this.snapshot(this.creations.get(key)!.intentId, accountId);
    await this.hooks.afterCreate?.(call, result);
    return result;
  });

  readonly retrieve = vi.fn(async (id: string, accountId: string | null): Promise<ProviderIntent> => {
    await this.hooks.beforeRetrieve?.({ id, accountId });
    return this.snapshot(id, accountId);
  });

  readonly cancel = vi.fn(async (id: string, accountId: string | null, idempotencyKey: string): Promise<ProviderIntent> => {
    const call = { id, accountId, idempotencyKey };
    await this.hooks.beforeCancel?.(call);
    const previous = this.snapshot(id, accountId);
    if (['succeeded', 'processing', 'requires_capture'].includes(previous.status)) {
      throw new Error(`Annulation de recette refusée : ${previous.status}.`);
    }
    const result = { ...previous, status: 'canceled', client_secret: null };
    this.seed(result, accountId);
    await this.hooks.afterCancel?.(call, result);
    return structuredClone(result);
  });
}
