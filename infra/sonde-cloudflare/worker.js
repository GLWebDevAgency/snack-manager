/**
 * Sonde de production — Snack Manager
 *
 * ── Pourquoi ce fichier existe ──────────────────────────────────────────────
 *
 * La sonde vivait dans GitHub Actions (`.github/workflows/sonde.yml`), toutes
 * les 30 minutes. Le contrôle prend 11 secondes ; GitHub facture la minute
 * pleine. À 48 passages par jour, cela faisait 1 440 minutes par mois pour
 * 4 h 24 de calcul réel — 82 % du quota parti en arrondi. Le 26 août 2026, ce
 * poste a fini d'assécher le forfait : les jobs ont cessé de démarrer, et le
 * déploiement de production de la PR #66 est resté à quai sans que personne
 * ne le voie, précisément parce que la sonde était muette elle aussi.
 *
 * Ici, le même contrôle tourne toutes les 5 minutes sur le plan gratuit
 * Cloudflare Workers, sans quota consommé nulle part — et six fois plus
 * souvent qu'avant.
 *
 * ── Ce qu'il vérifie ────────────────────────────────────────────────────────
 *
 * Les quatre services de production, comme `scripts/smoke.mjs` :
 *   · l'API doit répondre 200 ET publier `ok: true` — un 200 sur une API qui
 *     se sait malade ne prouve rien ;
 *   · les trois interfaces (commande en ligne, caisse, écran cuisine) doivent
 *     servir leur page.
 *
 * La carte publique n'est pas contrôlée en production : la base a été remise
 * à blanc, il n'y a aucun établissement à servir. Le jour où le premier
 * restaurant est en ligne, poser la variable texte
 * `SM_SLUG_CARTE_PRODUCTION` — le contrôle devient alors réel, et il traverse
 * Mongo sans exiger un nouveau déploiement du Worker.
 *
 * ── Pourquoi une mémoire (KV) ───────────────────────────────────────────────
 *
 * Une sonde qui alerte à chaque passage rouge envoie 12 notifications par
 * heure : au bout de deux pannes, on coupe les notifications, et la troisième
 * panne passe inaperçue. On ne notifie donc qu'au CHANGEMENT d'état — la
 * chute, puis le retour. C'est aussi ce qui permet d'annoncer la reprise,
 * qu'un simple ping ne sait pas faire.
 */

const CIBLES = [
  {
    nom: 'API',
    url: 'https://api-production-8949.up.railway.app/health',
    // L'API publie sa santé : on lit le corps, pas seulement le code.
    verifierCorps: (json) => (json?.ok === true ? null : `l'API se déclare en défaut (ok=${json?.ok})`),
  },
  { nom: 'Commande en ligne', url: 'https://web-production-99b58c.up.railway.app/' },
  { nom: 'Caisse', url: 'https://pos-production-a9d8.up.railway.app/' },
  { nom: 'Écran cuisine', url: 'https://kds-production-8991.up.railway.app/' },
];

/** Au-delà, on considère le service perdu — Railway rend la main bien avant. */
const DELAI_MS = 15_000;

/**
 * Un service à la fois. Renvoie `null` si tout va bien, sinon la raison —
 * une phrase lisible sur un écran de téléphone à 21 h, pas une trace de pile.
 */
async function controler(cible) {
  const debut = Date.now();
  try {
    const reponse = await fetch(cible.url, {
      signal: AbortSignal.timeout(DELAI_MS),
      headers: { 'user-agent': 'SnackManager-Sonde/1.0' },
      cf: { cacheTtl: 0, cacheEverything: false },
    });
    if (!reponse.ok) return { nom: cible.nom, raison: `HTTP ${reponse.status}`, ms: Date.now() - debut };
    if (cible.verifierCorps) {
      const json = await reponse.json().catch(() => null);
      const defaut = cible.verifierCorps(json);
      if (defaut) return { nom: cible.nom, raison: defaut, ms: Date.now() - debut };
      return { nom: cible.nom, raison: null, ms: Date.now() - debut, revision: json?.revisionCourte ?? null };
    }
    return { nom: cible.nom, raison: null, ms: Date.now() - debut };
  } catch (erreur) {
    const nom = erreur?.name === 'TimeoutError' ? `aucune réponse en ${DELAI_MS / 1000} s` : String(erreur?.message || erreur);
    return { nom: cible.nom, raison: nom, ms: Date.now() - debut };
  }
}

/** La carte publique — le seul contrôle qui traverse vraiment Mongo. */
async function controlerCarte(slug) {
  if (!slug) return null;
  const url = `https://api-production-8949.up.railway.app/public/tenants/${encodeURIComponent(slug)}/menu`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(DELAI_MS) });
    if (!r.ok) return { nom: 'Carte publique', raison: `HTTP ${r.status}` };
    const json = await r.json().catch(() => null);
    const produits = json?.categories?.reduce((n, c) => n + (c.products?.length ?? 0), 0) ?? 0;
    return produits > 0 ? { nom: 'Carte publique', raison: null } : { nom: 'Carte publique', raison: 'carte vide' };
  } catch (e) {
    return { nom: 'Carte publique', raison: String(e?.message || e) };
  }
}

/**
 * ntfy attend du texte brut ; un JSON s'y afficherait tel quel. Les autres
 * canaux (Slack, Discord) veulent du JSON — même distinction que dans
 * `.github/workflows/sonde.yml`, pour qu'un seul secret arme les deux.
 */
async function alerter(hook, titre, texte, urgent) {
  if (!hook) return { envoye: false, raison: 'aucun canal configuré (SM_ALERT_WEBHOOK absent)' };
  try {
    let reponse;
    if (hook.startsWith('https://ntfy.sh/')) {
      reponse = await fetch(hook, {
        method: 'POST',
        headers: {
          'content-type': 'text/plain',
          'x-title': titre,
          'x-tags': urgent ? 'rotating_light' : 'white_check_mark',
          'x-priority': urgent ? 'urgent' : 'default',
        },
        body: texte,
        signal: AbortSignal.timeout(10_000),
      });
    } else {
      reponse = await fetch(hook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: `${titre} — ${texte}`, content: `${titre} — ${texte}` }),
        signal: AbortSignal.timeout(10_000),
      });
    }
    if (!reponse.ok) {
      const corps = await reponse.text().catch(() => '');
      return { envoye: false, raison: `le canal a répondu ${reponse.status}`, corps: corps.slice(0, 200) };
    }
    return { envoye: true, raison: null };
  } catch (erreur) {
    // Une alerte qui échoue ne doit jamais faire échouer la sonde : le
    // passage suivant réessaiera, et l'état reste consultable dans KV. Mais
    // elle doit dire POURQUOI — une alerte muette qui échoue en silence est
    // pire que pas d'alerte du tout, puisqu'on la croit armée.
    return { envoye: false, raison: String(erreur?.message || erreur).slice(0, 200) };
  }
}

async function passage(env) {
  const resultats = await Promise.all(CIBLES.map(controler));
  const carte = await controlerCarte(env.SM_SLUG_CARTE_PRODUCTION?.trim());
  if (carte) resultats.push(carte);

  const echecs = resultats.filter((r) => r.raison);
  const etat = echecs.length === 0 ? 'vert' : 'rouge';
  const horodatage = new Date().toISOString();
  const revision = resultats.find((r) => r.revision)?.revision ?? null;

  const precedent = (await env.SONDE.get('etat')) ?? 'inconnu';

  // On ne notifie qu'au changement — la chute, puis le retour. Le premier
  // passage après un déploiement se contente de noter l'état, sinon chaque
  // mise à jour du Worker sonnerait.
  let alerte = { envoye: false, raison: 'aucun changement d’état' };
  if (etat !== precedent && precedent !== 'inconnu') {
    alerte =
      etat === 'rouge'
        ? await alerter(
            env.SM_ALERT_WEBHOOK,
            'Production en défaut',
            `La production ne répond pas correctement.\n${echecs.map((e) => `· ${e.nom} : ${e.raison}`).join('\n')}`,
            true,
          )
        : await alerter(
            env.SM_ALERT_WEBHOOK,
            'Production rétablie',
            `Les ${resultats.length} contrôles repassent au vert.`,
            false,
          );
  }

  const detail = {
    etat,
    horodatage,
    revision,
    precedent,
    alerte,
    services: resultats.map((r) => ({ nom: r.nom, ok: !r.raison, raison: r.raison, ms: r.ms ?? null })),
  };
  // L'état ne s'écrit qu'APRÈS la tentative d'alerte : si le Worker meurt
  // entre les deux, le passage suivant retrouve l'ancien état et réessaie.
  // Écrire d'abord, c'est perdre l'alerte sans laisser de trace.
  await env.SONDE.put('etat', etat);
  await env.SONDE.put('dernier-passage', JSON.stringify(detail));
  return detail;
}

export default {
  async scheduled(_evenement, env, ctx) {
    ctx.waitUntil(passage(env));
  },
  /**
   * Deux natures de chemins, et la frontière est celle de l'effet de bord.
   *
   * `/etat` et `/` ne font que LIRE la mémoire : rien à protéger, c'est le
   * lien qu'on met en favori sur son téléphone.
   *
   * `/verifier` et `/diagnostic` AGISSENT — l'un écrit dans KV, l'autre
   * envoie une notification. Laissés ouverts, ils donnent à quiconque
   * découvre l'adresse du Worker deux moyens de nuire sans rien pirater :
   * réveiller le gérant à volonté, et épuiser les 1 000 écritures KV
   * quotidiennes en quelques minutes — ce qui rendrait la sonde incapable de
   * mémoriser son état, donc aveugle. Ils demandent donc un jeton.
   */
  async fetch(requete, env) {
    const url = new URL(requete.url);
    const json = (corps, statut = 200) =>
      new Response(JSON.stringify(corps, null, 2), {
        status: statut,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });

    // Le jeton n'est pas un mot de passe : c'est une clef d'actionneur. S'il
    // n'est pas configuré, les chemins qui agissent restent fermés — jamais
    // ouverts « par défaut », qui est la façon dont ces choses-là s'oublient.
    const autorise = () => {
      const attendu = env.DIAGNOSTIC_TOKEN;
      if (!attendu) return false;
      const fourni = url.searchParams.get('token') ?? requete.headers.get('x-sonde-token') ?? '';
      return fourni.length === attendu.length && fourni === attendu;
    };

    if (url.pathname === '/etat' || url.pathname === '/') {
      const brut = (await env.SONDE.get('dernier-passage')) ?? '{"etat":"inconnu"}';
      return new Response(brut, { headers: { 'content-type': 'application/json; charset=utf-8' } });
    }

    if (url.pathname === '/verifier') {
      if (!autorise()) return json({ erreur: 'jeton requis' }, 401);
      const detail = await passage(env);
      return json(detail, detail.etat === 'vert' ? 200 : 503);
    }

    /**
     * Le canal d'alerte est la seule pièce qu'on ne peut pas vérifier en
     * regardant l'état : il ne sert qu'au changement, donc il peut être cassé
     * pendant des mois sans que rien ne le dise. Ce chemin l'exerce pour de
     * vrai et rapporte l'échec au lieu de l'avaler.
     *
     * Il ne renvoie AUCUN fragment de l'adresse : savoir que le canal est
     * configuré suffit à l'exploitant, et un préfixe d'URL est une moitié de
     * secret — c'est-à-dire un secret.
     */
    if (url.pathname === '/diagnostic') {
      if (!autorise()) return json({ erreur: 'jeton requis' }, 401);
      const hook = env.SM_ALERT_WEBHOOK;
      const resultat = await alerter(
        hook,
        'Diagnostic de la sonde',
        'Ce message confirme que le canal d’alerte fonctionne. Aucune panne.',
        false,
      );
      return json({ canal_configure: Boolean(hook), envoi: resultat });
    }

    return json({ erreur: 'chemin inconnu', chemins: ['/etat', '/verifier', '/diagnostic'] }, 404);
  },
};
