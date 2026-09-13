import { CUSTOMER_VERIFICATION_TIMING, type CustomerAccountAction } from '@sm/contracts';
import { CustomerIdentityError } from './customer-identity.service';

/** One monotonic budget from API admission, including queued preflight work.
 * Expiring the HTTP response does not cancel settlement of an already-issued
 * provider request. provider() is the mandatory final gate: a late preflight
 * continuation can never start an SMS or check after its caller timed out. */
export class CustomerVerificationDeadline {
  private readonly began: number;
  private until: number;
  private phase: 'preflight' | 'provider' | 'settlement' = 'preflight';
  private stopped = false;
  private readonly changed = new Set<() => void>();

  constructor(readonly action: 'start' | 'check', private readonly now: () => number = () => performance.now()) {
    this.began = now();
    this.until = this.began + CUSTOMER_VERIFICATION_TIMING.preflightMs;
  }
  private fail(): never { throw new CustomerIdentityError('unavailable'); }
  private current() {
    if (this.stopped || this.now() >= this.until) this.fail();
  }
  assertPreflight() {
    this.current();
    if (this.phase !== 'preflight') this.fail();
  }
  abort() {
    this.stopped = true;
    this.changed.forEach(update => update());
  }
  async provider<T>(work: () => Promise<T>): Promise<T> {
    this.assertPreflight();
    this.phase = 'provider';
    this.until = this.began + CUSTOMER_VERIFICATION_TIMING[this.action].apiMs;
    this.changed.forEach(update => update());
    try { return await work(); }
    finally {
      this.phase = 'settlement';
      this.until = Math.min(this.until, this.now() + CUSTOMER_VERIFICATION_TIMING.settlementMs);
      this.changed.forEach(update => update());
    }
  }
  async run<T>(work: () => Promise<T>): Promise<T> {
    this.current();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let update: (() => void) | undefined;
    const interrupted = new Promise<never>((_resolve, reject) => {
      update = () => {
        clearTimeout(timer);
        if (this.stopped || this.now() >= this.until) {
          this.stopped = true; reject(new CustomerIdentityError('unavailable')); return;
        }
        timer = setTimeout(() => this.abort(), this.until - this.now());
      };
      this.changed.add(update); update();
    });
    try {
      const result = await Promise.race([work(), interrupted]);
      this.current();
      return result;
    } finally {
      clearTimeout(timer);
      if (update) this.changed.delete(update);
    }
  }
}

export function customerVerificationDeadline(action: CustomerAccountAction): CustomerVerificationDeadline | undefined {
  return action === 'start' || action === 'check' ? new CustomerVerificationDeadline(action) : undefined;
}
