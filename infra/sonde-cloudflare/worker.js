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
 * restaurant est en ligne, ajouter son slug dans SLUG_CARTE ci-dessous —
 * le contrôle devient alors réel, et il traverse Mongo.
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

/** Slug d'un établissement en ligne, ou null tant que la base est vide. */
const SLUG_CARTE = null;

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
async function controlerCarte() {
  if (!SLUG_CARTE) return null;
  const url = `https://api-production-8949.up.railway.app/public/tenants/${SLUG_CARTE}/menu`;
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
  if (!hook) return false;
  try {
    if (hook.startsWith('https://ntfy.sh/')) {
      await fetch(hook, {
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
      await fetch(hook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: `${titre} — ${texte}`, content: `${titre} — ${texte}` }),
        signal: AbortSignal.timeout(10_000),
      });
    }
    return true;
  } catch {
    // Une alerte qui échoue ne doit jamais faire échouer la sonde : le
    // passage suivant réessaiera, et l'état reste consultable dans KV.
    return false;
  }
}

async function passage(env) {
  const resultats = await Promise.all(CIBLES.map(controler));
  const carte = await controlerCarte();
  if (carte) resultats.push(carte);

  const echecs = resultats.filter((r) => r.raison);
  const etat = echecs.length === 0 ? 'vert' : 'rouge';
  const horodatage = new Date().toISOString();
  const revision = resultats.find((r) => r.revision)?.revision ?? null;

  const precedent = (await env.SONDE.get('etat')) ?? 'inconnu';

  const detail = {
    etat,
    horodatage,
    revision,
    services: resultats.map((r) => ({ nom: r.nom, ok: !r.raison, raison: r.raison, ms: r.ms ?? null })),
  };
  await env.SONDE.put('etat', etat);
  await env.SONDE.put('dernier-passage', JSON.stringify(detail));

  // On ne notifie qu'au changement — la chute, puis le retour.
  if (etat !== precedent && precedent !== 'inconnu') {
    if (etat === 'rouge') {
      const liste = echecs.map((e) => `· ${e.nom} : ${e.raison}`).join('\n');
      await alerter(env.SM_ALERT_WEBHOOK, 'Production en défaut', `La production ne répond pas correctement.\n${liste}`, true);
    } else {
      await alerter(env.SM_ALERT_WEBHOOK, 'Production rétablie', `Les ${resultats.length} contrôles repassent au vert.`, false);
    }
  }
  // Premier passage après un déploiement de la sonde : on note l'état sans
  // réveiller personne, sinon chaque mise à jour du Worker sonnerait.
  return detail;
}

export default {
  async scheduled(_evenement, env, ctx) {
    ctx.waitUntil(passage(env));
  },
  /**
   * Consultable à la demande, pour voir l'état sans attendre le prochain
   * passage. Aucune donnée sensible : les mêmes surfaces publiques que
   * `smoke.mjs`, rien de plus.
   */
  async fetch(requete, env) {
    const url = new URL(requete.url);
    if (url.pathname === '/etat') {
      const brut = (await env.SONDE.get('dernier-passage')) ?? '{"etat":"inconnu"}';
      return new Response(brut, { headers: { 'content-type': 'application/json; charset=utf-8' } });
    }
    const detail = await passage(env);
    return new Response(JSON.stringify(detail, null, 2), {
      status: detail.etat === 'vert' ? 200 : 503,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  },
};
