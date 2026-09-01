import { describe, expect, it } from 'vitest';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppModule } from '../app.module';
import { trustedClientIp } from './trusted-client-ip';

function request(input: {
  real?: string | string[];
  forwarded?: string;
  expressIp?: string;
  socket?: string;
}) {
  return {
    headers: {
      'x-real-ip': input.real,
      'x-forwarded-for': input.forwarded,
    },
    ip: input.expressIp,
    socket: { remoteAddress: input.socket },
  };
}

describe('trustedClientIp', () => {
  it("prend l'adresse distante garantie par Railway, jamais X-Forwarded-For", () => {
    const first = request({
      real: '203.0.113.9',
      forwarded: '198.51.100.1',
      expressIp: '198.51.100.1',
      socket: '10.0.0.2',
    });
    const second = request({
      real: '203.0.113.9',
      forwarded: 'spoof.invalid',
      expressIp: 'spoof.invalid',
      socket: '10.0.0.2',
    });
    expect(trustedClientIp(first)).toBe('203.0.113.9');
    expect(trustedClientIp(second)).toBe('203.0.113.9');
  });

  it('accepte une IPv6 distante valide', () => {
    expect(trustedClientIp(request({ real: '2001:db8::41', socket: '10.0.0.2' }))).toBe(
      '2001:db8::41',
    );
  });

  it("rejette une valeur composée ou non-IP et retombe sur l'adresse socket", () => {
    expect(
      trustedClientIp(
        request({
          real: 'attaquant, 203.0.113.9',
          forwarded: '198.51.100.1',
          expressIp: '198.51.100.1',
          socket: '127.0.0.1',
        }),
      ),
    ).toBe('127.0.0.1');
    expect(
      trustedClientIp(request({ real: ['203.0.113.9', '198.51.100.1'], socket: '127.0.0.1' })),
    ).toBe('127.0.0.1');
  });

  it('regroupe sous une clé sûre quand aucune adresse valide n’existe', () => {
    expect(trustedClientIp(request({ forwarded: '198.51.100.1', expressIp: '198.51.100.1' }))).toBe(
      'inconnu',
    );
  });

  it('est réellement branché sur tous les ThrottlerGuard du module API', async () => {
    const imports = Reflect.getMetadata('imports', AppModule) as Array<{
      module?: unknown;
      providers?: Array<{ useValue?: { getTracker?: (req: unknown) => string | Promise<string> } }>;
    }>;
    const throttler = imports.find((entry) => entry.module === ThrottlerModule);
    const tracker = throttler?.providers
      ?.map((provider) => provider.useValue?.getTracker)
      .find((candidate) => candidate !== undefined);
    expect(tracker).toBeTypeOf('function');
    await expect(
      Promise.resolve(
        tracker?.(
        request({
          real: '203.0.113.9',
          forwarded: 'spoof.invalid',
          expressIp: 'spoof.invalid',
          socket: '10.0.0.2',
        }),
        ),
      ),
    ).resolves.toBe('203.0.113.9');
  });
});
