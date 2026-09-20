import { SITE_LEAD_NEEDS, type SiteLeadCreate } from '@sm/contracts';
import type { ContactEmail } from '../../infrastructure/contact/contact-mailer';

export const CONTACT_CALLBACK_LABELS: Record<SiteLeadCreate['callbackSlot'], string> = {
  matin: 'Le matin',
  'entre-services': 'Entre les services (14h–18h)',
  'apres-21h': 'Après 21 h',
};

export function escapeContactHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

export function composeContactEmail(
  request: SiteLeadCreate & { requestId: string },
  receivedAt: Date,
  crmUrl: string | null,
): ContactEmail {
  const need = request.need ? SITE_LEAD_NEEDS[request.need] : 'À préciser';
  const date = new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Paris',
  }).format(receivedAt);
  const fields: Array<[string, string]> = [
    ['Reçue le', `${date} (heure de Paris)`],
    ['Nom', request.name],
    ['Restaurant', request.restaurant || 'Non renseigné'],
    ['Téléphone', request.phone],
    ['E-mail', request.email || 'Non renseigné'],
    ['Besoin', need],
    ['Créneau de rappel', CONTACT_CALLBACK_LABELS[request.callbackSlot]],
    ['Plateformes de livraison', request.platforms ? 'Oui' : 'Non'],
    ['Message', request.message || 'Aucun message complémentaire'],
    ['Source', 'Formulaire du site vitrine Snack Manager'],
    ['Référence', request.requestId],
  ];
  const text = ['Nouvelle demande de contact Snack Manager', '',
    ...fields.map(([label, value]) => `${label} : ${value}`),
    ...(crmUrl ? ['', `Consulter le CRM : ${crmUrl}`] : []),
  ].join('\n');
  const rows = fields.map(([label, value]) => `<tr><th align="left" valign="top" style="padding:10px 14px;border-bottom:1px solid #e7eaf0;color:#586174;font-weight:500">${escapeContactHtml(label)}</th><td style="padding:10px 14px;border-bottom:1px solid #e7eaf0;white-space:pre-wrap">${escapeContactHtml(value)}</td></tr>`).join('');
  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#f3f5f8;font-family:Arial,sans-serif;color:#172033"><main style="max-width:680px;margin:24px auto;background:white;border-radius:16px;padding:28px"><p style="font-size:13px;color:#596273">SNACK MANAGER · CONTACT</p><h1 style="font-size:24px;line-height:1.3">Nouvelle demande de contact</h1><p>Une demande a été enregistrée dans le CRM. Voici les informations pour préparer le rappel.</p><table style="border-collapse:collapse;width:100%;font-size:14px"><tbody>${rows}</tbody></table>${crmUrl ? `<p style="margin-top:24px"><a href="${escapeContactHtml(crmUrl)}" style="display:inline-block;background:#172033;color:white;padding:12px 18px;border-radius:8px;text-decoration:none">Ouvrir le CRM</a></p>` : ''}</main></body></html>`;
  return {
    requestId: request.requestId,
    subject: `Snack Manager — nouvelle demande : ${need}`,
    text,
    html,
    replyTo: request.email ? { email: request.email, name: request.name.replace(/[\r\n]/g, ' ') } : null,
  };
}

export function contactLeadNotes(body: SiteLeadCreate): string {
  return [
    'Source : formulaire de la vitrine.',
    `Créneau de rappel : ${CONTACT_CALLBACK_LABELS[body.callbackSlot]}.`,
    `Plateformes de livraison : ${body.platforms ? 'oui' : 'non'}.`,
    body.need ? `Besoin : ${SITE_LEAD_NEEDS[body.need]}.` : null,
    body.message ? `Message : ${body.message}` : null,
  ].filter((line): line is string => line !== null).join('\n');
}
