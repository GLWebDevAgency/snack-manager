import { describe, expect, it, vi } from 'vitest';
import { HttpException, NotFoundException } from '@nestjs/common';
import type { Model } from 'mongoose';
import type { ErrorEvent, FunnelEvent } from '@sm/db';
import { errorFingerprint } from './fingerprint';
import { ReportThrottle } from './report-throttle';
import { toRecord } from './ops-exception.filter';
import { OpsService } from './ops.service';
import { ALERT_COOLDOWN_MS, composeAlert, dueCandidates } from './alerts-digest';
import { CompositeTeamAlerter, NoopTeamAlerter } from '../../infrastructure/alerts/team-alerter';
import { WebhookTeamAlerter } from '../../infrastructure/alerts/webhook-team-alerter';
import { BrevoTeamAlerter } from '../../infrastructure/alerts/brevo-team-alerter';
import { createTeamAlerter } from '../../infrastructure/alerts/team-alerter.factory';

const NOW = new Date('2026-08-24T12:00:00.000Z');

describe('Empreinte d’erreur', () => {
  it('regroupe la même panne malgré le bruit variable du message', () => {
    // Identifiants, ports, compteurs : le bruit classique d'un message d'erreur.
    const a = errorFingerprint('api', 'Order 6812af3c9b2e4d0012345678 not found');
    const b = errorFingerprint('api', 'Order 9f01bc2d8e7a6b0087654321 not found');
    expect(a).toBe(b);
  });

  it('sépare deux erreurs au même message levées d’endroits différents', () => {
    const a = errorFingerprint('api', 'boom', 'Error: boom\n    at OrdersService.create (orders.service.ts:42:11)');
    const b = errorFingerprint('api', 'boom', 'Error: boom\n    at MenuService.update (menu.service.ts:17:3)');
    expect(a).not.toBe(b);
  });

  it('sépare la même panne selon sa source', () => {
    expect(errorFingerprint('pos', 'boom')).not.toBe(errorFingerprint('kds', 'boom'));
  });
});

describe('Limiteur du guichet public', () => {
  it('laisse passer jusqu’à la limite puis bloque dans la fenêtre', () => {
    const throttle = new ReportThrottle(3, 60_000);
    expect(throttle.allow('ip', 1_000)).toBe(true);
    expect(throttle.allow('ip', 2_000)).toBe(true);
    expect(throttle.allow('ip', 3_000)).toBe(true);
    expect(throttle.allow('ip', 4_000)).toBe(false);
  });

  it('rouvre quand la fenêtre glisse', () => {
    const throttle = new ReportThrottle(2, 60_000);
    throttle.allow('ip', 0);
    throttle.allow('ip', 1_000);
    expect(throttle.allow('ip', 30_000)).toBe(false);
    expect(throttle.allow('ip', 61_001)).toBe(true);
  });

  it('borne sa mémoire en sacrifiant les clés les plus anciennes', () => {
    const throttle = new ReportThrottle(5, 60_000, 2);
    throttle.allow('a', 1);
    throttle.allow('b', 2);
    throttle.allow('c', 3); // « a » est évincée
    // « a » repart de zéro : elle re-passe même si elle avait consommé.
    expect(throttle.allow('a', 4)).toBe(true);
  });
});

describe('Ce que le filtre journalise', () => {
  it('ignore les réponses métier — 4xx n’est pas une panne', () => {
    expect(toRecord(new NotFoundException('Lead introuvable'))).toBeNull();
    expect(toRecord(new HttpException('conflit', 409))).toBeNull();
  });

  it('journalise les 5xx et les throw nus', () => {
    expect(toRecord(new HttpException('cassé', 500))?.source).toBe('api');
    const record = toRecord(new Error('Mongo timeout'));
    expect(record?.message).toBe('Mongo timeout');
    expect(record?.stack).toContain('Mongo timeout');
    // Un throw d'autre chose qu'une Error entre quand même au journal.
    expect(toRecord('panique')?.message).toBe('panique');
  });
});

describe('OpsService.record', () => {
  const makeErrors = () => {
    const updateOne = vi.fn().mockResolvedValue({});
    return { model: { updateOne } as unknown as Model<ErrorEvent>, updateOne };
  };
  const fakeFunnel = () =>
    ({ create: vi.fn(), aggregate: vi.fn() }) as unknown as Model<FunnelEvent>;

  it('écrit un upsert par empreinte : l’avalanche incrémente, elle n’insère pas', async () => {
    const { model, updateOne } = makeErrors();
    const ops = new OpsService(model, fakeFunnel());
    await ops.record({ source: 'pos', message: 'Order 123 not found' }, NOW);

    const args = updateOne.mock.calls.at(0);
    if (!args) throw new Error('updateOne jamais appelé');
    const [filter, update, options] = args as [
      { source: string; hash: string },
      { $inc: unknown; $setOnInsert: unknown },
      { upsert: boolean },
    ];
    expect(filter.source).toBe('pos');
    expect(filter.hash).toBe(errorFingerprint('pos', 'Order 123 not found', ''));
    expect(update.$inc).toEqual({ count: 1 });
    expect(update.$setOnInsert).toEqual({ firstAt: NOW, seenAt: null });
    expect(options).toEqual({ upsert: true });
  });

  it('ne lève JAMAIS — un journal en panne ne fait pas tomber la réponse', async () => {
    const model = {
      updateOne: vi.fn().mockRejectedValue(new Error('base injoignable')),
    } as unknown as Model<ErrorEvent>;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(new OpsService(model, fakeFunnel()).record({ source: 'api', message: 'x' })).resolves.toBeUndefined();
    spy.mockRestore();
  });

  it('relaie vers le collecteur externe seulement s’il est actif', async () => {
    const { model } = makeErrors();
    const forward = vi.fn();
    const opsActif = new OpsService(model, fakeFunnel(), { enabled: true, forward });
    await opsActif.record({ source: 'web', message: 'x' }, NOW);
    expect(forward).toHaveBeenCalledOnce();

    const forwardInactif = vi.fn();
    const opsInactif = new OpsService(model, fakeFunnel(), { enabled: false, forward: forwardInactif });
    await opsInactif.record({ source: 'web', message: 'x' }, NOW);
    expect(forwardInactif).not.toHaveBeenCalled();
  });
});

describe('Veilleur — décider quoi envoyer', () => {
  const candidate = (key: string) => ({ key, line: `ligne ${key}` });

  it('n’envoie jamais deux fois la même clé pendant le refroidissement', () => {
    const lastSent = new Map([['a', new Date(NOW.getTime() - ALERT_COOLDOWN_MS + 60_000)]]);
    const due = dueCandidates([candidate('a'), candidate('b')], lastSent, NOW);
    expect(due.map((c) => c.key)).toEqual(['b']);
  });

  it('fait re-sonner une clé refroidie', () => {
    const lastSent = new Map([['a', new Date(NOW.getTime() - ALERT_COOLDOWN_MS - 1)]]);
    expect(dueCandidates([candidate('a')], lastSent, NOW)).toHaveLength(1);
  });

  it('dédoublonne le lot lui-même', () => {
    expect(dueCandidates([candidate('a'), candidate('a')], new Map(), NOW)).toHaveLength(1);
  });

  it('compose UN digest, plafonné, avec le lien vers la file', () => {
    expect(composeAlert([])).toBeNull();
    const alert = composeAlert(Array.from({ length: 13 }, (_, i) => candidate(String(i))));
    expect(alert?.title).toBe('Snack Manager — 13 alertes');
    expect(alert?.text).toContain('… et 3 autres');
    expect(alert?.text).toContain('/sm/signals');
  });
});

describe('Canaux d’alerte', () => {
  const reponse =
    (status: number) => (_url: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) =>
      Promise.resolve(new Response('{}', { status }));

  it('webhook : poste text ET content pour servir Slack comme Discord', async () => {
    const fetchFn = vi.fn(reponse(200));
    const result = await new WebhookTeamAlerter('https://exemple.test/hook', fetchFn).send({
      title: 'Titre',
      text: 'Corps',
    });
    expect(result.sent).toBe(true);
    const init = fetchFn.mock.calls.at(0)?.[1];
    const body = JSON.parse(String(init?.body)) as { text: string; content: string };
    expect(body.text).toContain('Titre');
    expect(body.content).toContain('Corps');
  });

  it('brevo : porte la clé en en-tête et l’alerte en objet', async () => {
    const fetchFn = vi.fn(reponse(200));
    await new BrevoTeamAlerter('cle', 'de@sm.fr', 'a@sm.fr', fetchFn).send({ title: 'T', text: 'x' });
    const appel = fetchFn.mock.calls.at(0);
    expect(appel?.[0]).toBe('https://api.brevo.com/v3/smtp/email');
    expect((appel?.[1]?.headers as Record<string, string>)['api-key']).toBe('cle');
    expect((JSON.parse(String(appel?.[1]?.body)) as { subject: string }).subject).toContain('T');
  });

  it('un canal en échec le DIT — jamais d’exception', async () => {
    const result = await new WebhookTeamAlerter(
      'https://exemple.test/hook',
      vi.fn(reponse(500)),
    ).send({ title: 't', text: 'x' });
    expect(result).toEqual({ sent: false, reason: 'webhook : HTTP 500' });
  });

  it('composite : « envoyé » dès qu’un canal l’est', async () => {
    const bon = { providerName: 'bon', enabled: true, send: vi.fn().mockResolvedValue({ sent: true }) };
    const casse = {
      providerName: 'cassé',
      enabled: true,
      send: vi.fn().mockResolvedValue({ sent: false, reason: 'HTTP 500' }),
    };
    const result = await new CompositeTeamAlerter([bon, casse]).send({ title: 't', text: 'x' });
    expect(result.sent).toBe(true);
    expect(casse.send).toHaveBeenCalled();
  });
});

describe('Entonnoir du tunnel', () => {
  it('compose visites → commandes par établissement, plus gros trafic d’abord', async () => {
    const { composeFunnel } = await import('./funnel-compose');
    const rows = composeFunnel([
      { slug: 'classfood', step: 'visite', n: 100 },
      { slug: 'classfood', step: 'panier', n: 40 },
      { slug: 'classfood', step: 'commande', n: 12 },
      { slug: 'petit', step: 'visite', n: 3 },
      { slug: 'classfood', step: 'inconnu', n: 999 }, // étape hors contrat : ignorée
    ]);
    expect(rows.map((r) => r.slug)).toEqual(['classfood', 'petit']);
    expect(rows[0]?.steps).toEqual({ visite: 100, panier: 40, coordonnees: 0, commande: 12 });
    expect(rows[0]?.conversionPct).toBe(12);
    // Sans visite, pas de pourcentage — plutôt rien qu'un chiffre menteur.
    expect(composeFunnel([{ slug: 'x', step: 'commande', n: 2 }])[0]?.conversionPct).toBeNull();
  });
});

describe('Jeton de sauvegarde', () => {
  it('n’accepte que le Bearer exact', async () => {
    const { backupTokenMatches } = await import('./backup-token');
    expect(backupTokenMatches('Bearer secret-long', 'secret-long')).toBe(true);
    expect(backupTokenMatches('Bearer secret-lonG', 'secret-long')).toBe(false);
    expect(backupTokenMatches('Bearer secret', 'secret-long')).toBe(false);
    expect(backupTokenMatches('secret-long', 'secret-long')).toBe(false);
    expect(backupTokenMatches(undefined, 'secret-long')).toBe(false);
  });
});

describe('Fabrique du canal d’alerte', () => {
  const silencieux = { log: () => {}, warn: () => {} };

  it('aucune variable → veilleur au repos', () => {
    const alerter = createTeamAlerter(() => undefined, silencieux);
    expect(alerter.enabled).toBe(false);
    expect(alerter).toBeInstanceOf(NoopTeamAlerter);
  });

  it('webhook seul, e-mail seul, ou les deux', () => {
    const env = (vars: Record<string, string>) => (key: string) => vars[key];
    expect(createTeamAlerter(env({ SM_ALERT_WEBHOOK: 'https://x' }), silencieux).providerName).toBe('webhook');
    expect(
      createTeamAlerter(env({ BREVO_API_KEY: 'k', SM_ALERT_EMAIL_TO: 'a@b.fr' }), silencieux)
        .providerName,
    ).toBe('e-mail (Brevo)');
    expect(
      createTeamAlerter(
        env({ SM_ALERT_WEBHOOK: 'https://x', BREVO_API_KEY: 'k', SM_ALERT_EMAIL_TO: 'a@b.fr' }),
        silencieux,
      ).providerName,
    ).toBe('webhook + e-mail (Brevo)');
  });

  it('e-mail incomplet → prévient et ignore le canal', () => {
    const warn = vi.fn();
    const alerter = createTeamAlerter((k) => ({ BREVO_API_KEY: 'k' })[k], { log: () => {}, warn });
    expect(alerter.enabled).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
  });
});
