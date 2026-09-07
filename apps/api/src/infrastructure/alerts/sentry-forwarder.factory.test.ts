import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as Sentry from '@sentry/node';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSentryForwarder } from './sentry-forwarder.factory';
import type { ErrorForwarder } from './error-forwarder';

const captured = vi.hoisted(() => ({ envelopes: [] as unknown[], initializations: 0 }));
vi.mock('@sentry/node', async importOriginal => {
  const actual = await importOriginal<typeof import('@sentry/node')>();
  return { ...actual, init: (options: Parameters<typeof actual.init>[0]) => {
    captured.initializations++;
    // Real installed SDK/processors; the collector cannot perform network I/O.
    return actual.init({ ...options, transport: () => ({
      send: async (envelope: unknown) => { captured.envelopes.push(envelope); return { statusCode: 200 }; },
      flush: async () => true,
    }) });
  } };
});

const markers = {
  pin: '120987', qr: 'fixture-private-qr', recoveryProof: 'fixture-private-recovery',
  bearer: 'fixture-private-bearer', cookie: 'fixture-private-cookie',
  query: 'fixture-private-query', fragment: 'fixture-private-fragment',
};
const quiet = { log: () => {}, warn: () => {} };
const report = { source: 'api' as const, message: 'Generic delivery failure',
  stack: 'Error: Generic delivery failure\n    at deliveryOperation (/fixture/delivery.ts:42:7)',
  url: `https://fixture.invalid/t/order?t=${markers.query}#remise=${markers.fragment}`, appVersion: 'fixture-app-v1' };

function events(): Sentry.ErrorEvent[] {
  return captured.envelopes.flatMap(raw => {
    const envelope = raw as [unknown, [{ type: string }, Sentry.ErrorEvent][]];
    return envelope[1].filter(([header]) => header.type === 'event').map(([, event]) => event);
  });
}
function assertPrivate(event: Sentry.ErrorEvent) {
  const serialized = JSON.stringify(event);
  const allEnvelopes = JSON.stringify(captured.envelopes);
  // Booleans only: a failing assertion must not print a body/bearer/PIN.
  expect(Object.values(markers).some(marker => allEnvelopes.includes(marker))).toBe(false);
  expect(Object.values(markers).some(marker => serialized.includes(marker))).toBe(false);
  expect(Boolean(event.request || event.breadcrumbs || event.user || event.contexts)).toBe(false);
  expect(event.extra?.url).toBe('/t/order');
}

describe('Sentry — alertes sans contexte HTTP ni capacité privée', () => {
  let server: Server | undefined;
  let forwarder: ErrorForwarder;
  beforeAll(async () => {
    forwarder = createSentryForwarder(key => ({ SENTRY_DSN: 'https://fixture@127.0.0.1/1',
      SM_ENV: 'fixture', SM_REVISION: 'fixture-release' })[key], quiet);
    server = createServer((req, res) => {
      req.on('data', () => {});
      req.on('end', () => {
        // The same synchronous hand-off as OpsService.record(), inside the
        // real HTTP isolation scope; the Error message itself has no secret.
        forwarder.forward(report);
        res.writeHead(503).end('unavailable');
      });
    });
    await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen(0, '127.0.0.1', resolve); });
  });
  beforeEach(() => { captured.envelopes.length = 0; });
  afterAll(async () => {
    try { if (server) { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve())); } }
    finally { await Sentry.close(3_000); }
  });

  it('sans DSN ne démarre aucun collecteur', () => {
    const before = captured.initializations;
    const disabled = createSentryForwarder(() => undefined, quiet);
    disabled.forward(report);
    expect(disabled.enabled).toBe(false);
    expect(captured.initializations).toBe(before);
    expect(captured.envelopes.length).toBe(0);
  });

  it.each([
    ['/delivery-access/missions/507f1f77bcf86cd799439011/handoff/confirm', { proof: { kind: 'pin', value: markers.pin } }],
    ['/delivery/missions/507f1f77bcf86cd799439011/handoff/confirm', { proof: { kind: 'qr', value: markers.qr } }],
    ['/public/orders/507f1f77bcf86cd799439011/delivery-proof', { clientId: 'fixture-client', recoveryProof: markers.recoveryProof }],
  ] as const)('HTTP réel %s : aucune donnée privée dans le transport mémoire', async (path, payload) => {
    const body = JSON.stringify(payload);
    await new Promise<void>((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port: (server!.address() as AddressInfo).port,
        path: `${path}?t=${markers.query}`, method: 'POST', headers: {
          'content-type': 'application/json', 'content-length': Buffer.byteLength(body),
          authorization: `Bearer ${markers.bearer}`, cookie: `delivery=${markers.cookie}`,
        } }, res => { res.resume(); res.on('end', resolve); });
      req.setTimeout(3_000, () => req.destroy(new Error('Loopback fixture timeout')));
      req.on('error', () => reject(new Error('Loopback fixture failed'))); req.end(body);
    });
    expect(await Sentry.flush(3_000)).toBe(true);
    const sent = events();
    expect(sent.length).toBe(1);
    assertPrivate(sent[0]!);
    expect(sent[0]?.exception?.values?.[0]?.value).toBe(report.message);
    expect(sent[0]?.exception?.values?.[0]?.stacktrace?.frames?.some(frame => frame.filename === '/fixture/delivery.ts' && frame.lineno === 42)).toBe(true);
    expect(sent[0]?.tags?.source).toBe('api');
    expect(sent[0]?.release).toBe('fixture-release');
    expect(sent[0]?.environment).toBe('fixture');
    expect(sent[0]?.extra?.appVersion).toBe('fixture-app-v1');
  });

  it('le dernier filtre retire aussi un contexte réinjecté par un processeur SDK', async () => {
    Sentry.withScope(scope => {
      scope.addEventProcessor(event => ({ ...event,
        request: { data: markers.pin, headers: { authorization: markers.bearer }, cookies: { delivery: markers.cookie },
          url: `https://fixture.invalid/path?t=${markers.query}#${markers.fragment}` },
        breadcrumbs: [{ category: 'http', data: { body: markers.qr } }],
        contexts: { response: { body: markers.recoveryProof } },
        extra: { ...event.extra, automaticBody: markers.recoveryProof },
      }));
      forwarder.forward(report);
    });
    expect(await Sentry.flush(3_000)).toBe(true);
    expect(events().length).toBe(1);
    assertPrivate(events()[0]!);
  });
});
