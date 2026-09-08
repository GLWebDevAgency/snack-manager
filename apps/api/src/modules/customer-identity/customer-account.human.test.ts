import { afterEach, describe, expect, it, vi } from 'vitest';
import { CustomerAccountHumanVerifier } from './customer-account.human';
const input = { secret: 'fixture-human-secret', token: 'fixture-human-token', origin: 'https://fixture.example',
  slug: 'fixture', operationId: '11111111-1111-4111-8111-111111111111' };
const approved = { success: true, hostname: 'fixture.example', action: 'customer-account-start', cdata: `${input.slug}_${input.operationId}` };
describe('purpose-bound customer human verification', () => {
  afterEach(() => vi.useRealTimers());
  it('uses fixed HTTPS, no redirect/retry/raw IP, and binds hostname/action/intention', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(approved)));
    await expect(new CustomerAccountHumanVerifier(fetcher).verify(input)).resolves.toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]![0]).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    const options = fetcher.mock.calls[0]![1]!;
    expect(options).toMatchObject({ method: 'POST', redirect: 'error' });
    expect(Array.from((options.body as URLSearchParams).keys())).toEqual(['secret', 'response']);
  });
  it.each([{ success: false }, { hostname: 'other.example' }, { action: 'public-order' }, { cdata: 'different-intention' }])('refuses mismatched human proof', async patch => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ...approved, ...patch })));
    await expect(new CustomerAccountHumanVerifier(fetcher).verify(input)).resolves.toBe(false);
  });
  it.each(['oversized', 'malformed', 'provider-error'])('fails closed for %s without disclosing content', async kind => {
    const content = kind === 'oversized' ? 'x'.repeat(16_385) : 'fixture-private-response';
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(content, { status: kind === 'provider-error' ? 503 : 200 }));
    const error: unknown = await new CustomerAccountHumanVerifier(fetcher).verify(input).catch(value => value);
    expect(error).toMatchObject({ reason: 'unavailable' });
    expect(JSON.stringify(error).includes(content)).toBe(false);
  });
  it('times out total work including a stalled response body', async () => {
    vi.useFakeTimers(); const cancelled = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({ cancel: cancelled })));
    const result = new CustomerAccountHumanVerifier(fetcher).verify(input).catch(value => value);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await result).toMatchObject({ reason: 'unavailable' }); expect(cancelled).toHaveBeenCalledTimes(1);
  });
  it('does not accept a late approval and cancels its late body', async () => {
    vi.useFakeTimers(); const cancelled = vi.fn();
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(value => { resolve = value; }));
    const result = new CustomerAccountHumanVerifier(fetcher).verify(input).catch(value => value);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await result).toMatchObject({ reason: 'unavailable' });
    resolve(new Response(new ReadableStream({ cancel: cancelled })));
    await vi.advanceTimersByTimeAsync(0); expect(cancelled).toHaveBeenCalledTimes(1);
  });
});
