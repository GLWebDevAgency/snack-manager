import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  publicRelayHeadersPresent,
  relayProofPayload,
  validatePublicRelayEnvironment,
  verifiedPublicRelayClient,
} from './verified-public-relay';

const SECRET = Buffer.alloc(32, 7);
const NOW = Date.parse('2026-09-01T12:00:00.000Z');
const AT = String(Math.floor(NOW / 1_000));
const CLIENT = createHmac('sha256', SECRET)
  .update('client\0edge-ip:203.0.113.41')
  .digest('base64url');
const TOKEN = 'A'.repeat(43);

function request(slug = 'classfood', at = AT) {
  const proof = createHmac('sha256', SECRET)
    .update(relayProofPayload(at, slug, CLIENT, TOKEN))
    .digest('base64url');
  return {
    headers: {
      'x-sm-relay-client': CLIENT,
      'x-sm-relay-at': at,
      'x-sm-relay-proof': proof,
    },
  };
}

describe('preuve du relais public', () => {
  it('retrouve une identité opaque attestée dans la fenêtre autorisée', () => {
    expect(
      verifiedPublicRelayClient(request(), 'classfood', TOKEN, {
        nowMs: NOW + 30_000,
        secret: SECRET,
      }),
    ).toBe(`relay:${CLIENT}`);
  });

  it('lie la preuve au restaurant et refuse toute altération', () => {
    expect(
      verifiedPublicRelayClient(request('classfood'), 'autre-resto', TOKEN, {
        nowMs: NOW,
        secret: SECRET,
      }),
    ).toBeNull();
    const tampered = request();
    tampered.headers['x-sm-relay-client'] = `A${CLIENT.slice(1)}`;
    expect(
      verifiedPublicRelayClient(tampered, 'classfood', TOKEN, {
        nowMs: NOW,
        secret: SECRET,
      }),
    ).toBeNull();
  });

  it('refuse une preuve expirée, dupliquée ou sans clé valide', () => {
    expect(
      verifiedPublicRelayClient(request(), 'classfood', TOKEN, {
        nowMs: NOW + 91_000,
        secret: SECRET,
      }),
    ).toBeNull();
    expect(
      verifiedPublicRelayClient(
        {
          headers: {
            ...request().headers,
            'x-sm-relay-proof': [
              request().headers['x-sm-relay-proof'],
              request().headers['x-sm-relay-proof'],
            ],
          },
        },
        'classfood',
        TOKEN,
        { nowMs: NOW, secret: SECRET },
      ),
    ).toBeNull();
    expect(
      verifiedPublicRelayClient(request(), 'classfood', TOKEN, {
        nowMs: NOW,
        secret: null,
      }),
    ).toBeNull();
  });

  it('lie une preuve à une seule carte et distingue absence et altération', () => {
    expect(
      verifiedPublicRelayClient(request(), 'classfood', 'B'.repeat(43), {
        nowMs: NOW,
        secret: SECRET,
      }),
    ).toBeNull();
    expect(publicRelayHeadersPresent({ headers: {} })).toBe(false);
    expect(
      publicRelayHeadersPresent({ headers: { 'x-sm-relay-proof': 'invalide' } }),
    ).toBe(true);
  });

  it('refuse de démarrer en production sans clé commune exacte', () => {
    expect(() => validatePublicRelayEnvironment({ NODE_ENV: 'production' })).toThrow(
      /SM_PUBLIC_RELAY_SIGNING_KEY/,
    );
    expect(() =>
      validatePublicRelayEnvironment({
        NODE_ENV: 'production',
        SM_PUBLIC_RELAY_SIGNING_KEY: Buffer.alloc(32, 7).toString('base64'),
      }),
    ).not.toThrow();
    expect(() => validatePublicRelayEnvironment({ NODE_ENV: 'test' })).not.toThrow();
  });

  it('refuse aussi une Railway staging mal configurée, quel que soit NODE_ENV', () => {
    expect(() =>
      validatePublicRelayEnvironment({
        NODE_ENV: 'development',
        RAILWAY_ENVIRONMENT_NAME: 'staging',
      }),
    ).toThrow(/SM_PUBLIC_RELAY_SIGNING_KEY/);
    expect(() =>
      validatePublicRelayEnvironment({
        RAILWAY_ENVIRONMENT_ID: 'env_staging',
        SM_PUBLIC_RELAY_SIGNING_KEY: Buffer.alloc(32, 9).toString('base64'),
      }),
    ).not.toThrow();
  });
});
