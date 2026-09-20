import { describe, expect, it } from 'vitest';
import { SITE_LEAD_NEEDS, type SiteLeadCreate } from '@sm/contracts';
import { composeContactEmail, contactLeadNotes, escapeContactHtml } from './contact-email';

const request: SiteLeadCreate & { requestId: string } = {
  requestId: '75bb97eb-6d77-4090-9515-53b9a063fa35',
  name: 'Camille Martin',
  restaurant: 'La Table',
  phone: '+33 6 00 00 00 00',
  email: 'camille@example.com',
  need: 'menu-papier',
  callbackSlot: 'entre-services',
  message: 'Une nouvelle carte\nAvec deux volets.',
  platforms: true,
  source: 'site-vitrine',
};
const receivedAt = new Date('2026-09-20T10:15:00.000Z');

describe('composeContactEmail — demande exploitable par l’équipe', () => {
  it('rend toutes les coordonnées, le projet, le créneau et la référence dans les deux versions', () => {
    const email = composeContactEmail(request, receivedAt, 'https://snackmanager.example/sm');
    for (const content of [email.text, email.html]) {
      for (const expected of [
        '20 septembre 2026', '12:15', 'heure de Paris', request.name,
        request.restaurant!, request.phone, request.email!, 'Refaire mon menu papier',
        'Entre les services', 'Plateformes de livraison', 'Oui', request.message!,
        'Formulaire du site vitrine Snack Manager', request.requestId,
        'https://snackmanager.example/sm',
      ]) expect(content).toContain(expected);
    }
    expect(email.html).toContain('white-space:pre-wrap');
    expect(email.subject).toBe('Snack Manager — nouvelle demande : Refaire mon menu papier');
    expect(email.requestId).toBe(request.requestId);
    expect(email.replyTo).toEqual({ email: request.email, name: request.name });
  });

  it('indique les champs non renseignés et omet le lien CRM et Reply-To', () => {
    const email = composeContactEmail({ ...request,
      restaurant: null, email: null, need: null, message: null, platforms: false,
    }, receivedAt, null);
    expect(email.replyTo).toBeNull();
    for (const content of [email.text, email.html]) {
      expect(content).toContain('Non renseigné');
      expect(content).toContain('À préciser');
      expect(content).toContain('Aucun message complémentaire');
    }
    expect(email.text).toContain('Plateformes de livraison : Non');
    expect(email.html).not.toContain('<a ');
    expect(email.text).not.toContain('Consulter le CRM');
  });

  it('échappe les champs utilisateur dans le HTML tout en conservant le texte lisible', () => {
    const attack = '<img src=x onerror="alert(1)"> & \'texte\'';
    const email = composeContactEmail({ ...request, name: attack, restaurant: attack, message: attack }, receivedAt, null);
    expect(email.html).not.toContain('<img');
    expect(email.html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;texte&#39;');
    expect(email.text).toContain(attack);
    expect(email.subject).not.toContain(attack);
  });

  it('neutralise les retours de ligne dans le nom du Reply-To', () => {
    const email = composeContactEmail({ ...request, name: 'Camille\r\nBcc: unwanted@example.com' }, receivedAt, null);
    expect(email.replyTo?.name).not.toMatch(/[\r\n]/);
    expect(email.replyTo?.email).toBe('camille@example.com');
  });

  it.each([
    ['matin', 'Le matin'], ['entre-services', 'Entre les services'], ['apres-21h', 'Après 21 h'],
  ] as const)('traduit le créneau %s sans perdre la préférence du prospect', (callbackSlot, label) => {
    const email = composeContactEmail({ ...request, callbackSlot }, receivedAt, null);
    expect(email.text).toContain(`Créneau de rappel : ${label}`);
    expect(email.html).toContain(label);
  });

  it.each(Object.entries(SITE_LEAD_NEEDS))('utilise le libellé métier du besoin %s', (need, label) => {
    const email = composeContactEmail({ ...request, need: need as SiteLeadCreate['need'] }, receivedAt, null);
    expect(email.subject).toContain(label);
    expect(email.text).toContain(`Besoin : ${label}`);
    expect(email.html).toContain(escapeContactHtml(label));
  });
});

describe('contactLeadNotes — trace commerciale lisible', () => {
  it('conserve les préférences et le message sans données techniques de livraison', () => {
    expect(contactLeadNotes(request)).toBe([
      'Source : formulaire de la vitrine.',
      'Créneau de rappel : Entre les services (14h–18h).',
      'Plateformes de livraison : oui.',
      'Besoin : Refaire mon menu papier.',
      'Message : Une nouvelle carte\nAvec deux volets.',
    ].join('\n'));
    expect(contactLeadNotes(request)).not.toContain(request.requestId);
  });

  it('reste lisible pour les anciennes demandes sans besoin structuré ni message', () => {
    const notes = contactLeadNotes({ ...request, need: undefined, message: null, platforms: false });
    expect(notes).toContain('Plateformes de livraison : non.');
    expect(notes).not.toContain('undefined');
    expect(notes).not.toContain('null');
    expect(notes).not.toContain('Besoin :');
    expect(notes).not.toContain('Message :');
  });
});
