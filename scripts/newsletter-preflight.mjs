#!/usr/bin/env node
/** Read-only provider check. Never creates contacts or sends an email. */
const required = ['BREVO_API_KEY', 'SM_NEWSLETTER_LIST_ID', 'SM_NEWSLETTER_DOI_TEMPLATE_ID', 'SM_NEWSLETTER_REDIRECT_URL'];
const missing = required.filter(name => !process.env[name]?.trim());
if (missing.length) {
  console.error(`Newsletter non configurée : ${missing.join(', ')}`);
  process.exit(1);
}
const listId = Number(process.env.SM_NEWSLETTER_LIST_ID);
const templateId = Number(process.env.SM_NEWSLETTER_DOI_TEMPLATE_ID);
if (![listId, templateId].every(id => Number.isSafeInteger(id) && id > 0)) {
  console.error('Identifiants Brevo invalides.');
  process.exit(1);
}
let redirect;
try { redirect = new URL(process.env.SM_NEWSLETTER_REDIRECT_URL); } catch { /* rejected below */ }
if (!redirect || redirect.protocol !== 'https:' || redirect.username || redirect.password || redirect.search || redirect.hash || redirect.pathname !== '/newsletter/confirmation') {
  console.error('Retour newsletter invalide : origine HTTPS et chemin /newsletter/confirmation requis.');
  process.exit(1);
}
async function read(path) {
  const response = await fetch(`https://api.brevo.com/v3${path}`, {
    headers: { 'api-key': process.env.BREVO_API_KEY.trim(), accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Préflight Brevo refusé (HTTP ${response.status}).`);
  return response.json();
}
try {
  const [list, template, senders] = await Promise.all([
    read(`/contacts/lists/${listId}`), read(`/smtp/templates/${templateId}`), read('/senders'),
  ]);
  if (list.id !== listId || template.id !== templateId) throw new Error('Ressource Brevo inattendue.');
  if (template.isActive !== true || template.doiTemplate !== true) throw new Error('Le modèle doit être actif et reconnu double opt-in par Brevo.');
  if (!Array.isArray(senders.senders) || !senders.senders.some(sender => sender.active === true && (
    (template.sender?.id && sender.id === template.sender.id) ||
    (template.sender?.email && sender.email?.toLowerCase() === template.sender.email.toLowerCase())
  ))) throw new Error('Expéditeur du modèle non validé chez Brevo.');
  console.log(JSON.stringify({ ready: true, listId, templateId, confirmationOrigin: redirect.origin, emailSent: false }));
} catch (error) {
  // Provider bodies and fetch error details may contain PII or credentials.
  const safe = error instanceof Error && /^(Préflight Brevo refusé|Ressource Brevo inattendue|Le modèle doit|Expéditeur du modèle)/.test(error.message);
  console.error(safe ? error.message : 'Préflight Brevo indisponible. Aucun e-mail envoyé.');
  process.exitCode = 1;
}
