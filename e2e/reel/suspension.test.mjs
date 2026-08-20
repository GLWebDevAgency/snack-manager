/**
 * SCÉNARIO 5 — LA SUSPENSION D'UN ÉTABLISSEMENT.
 *
 * La mécanique la plus délicate du projet : elle traverse quatre surfaces qui
 * n'ont pas la même garde, et chacune s'est déjà laissé contourner. Ce qu'elle
 * doit garantir tient en deux phrases —
 *
 *   · un restaurant suspendu NE PEUT PLUS OUVRIR SA CAISSE ;
 *   · son site public SE FERME PROPREMENT, sans tomber en erreur.
 *
 * ─── POURQUOI CE SCÉNARIO EXIGE UNE VRAIE API ───
 *
 * Une suspension n'est pas un écran, c'est un état de compte relu à chaque
 * requête par trois gardes différentes : le guard global pour le gérant
 * (`common/auth.ts`), un contrôle explicite à l'ouverture de service pour les
 * tablettes (`device-pin-login.usecase.ts` — les jetons d'appareil NE PASSENT
 * PAS par le guard, c'est là qu'était la brèche), et une fonction pure pour la
 * vitrine (`publicOrderingState`). Aucune fixture ne peut mentir sur ces
 * trois-là ensemble : c'est justement leur désaccord qui fait la panne.
 *
 * ─── COMMENT ON VÉRIFIE QUE LA CAISSE NE S'OUVRE PLUS ───
 *
 * `POST /auth/pin` est la route qu'une caisse appelle pour ouvrir un service.
 * Elle contrôle la suspension AVANT de regarder le PIN — c'est l'ordre qui
 * compte, et c'est ce qui permet de la sonder SANS AUCUN SECRET DE CAISSE :
 *
 *     établissement actif    + PIN quelconque → 401 « PIN invalide »
 *     établissement suspendu + PIN quelconque → 403 « Accès suspendu »
 *
 * Le passage de 401 à 403 sur un PIN qui n'a jamais été bon prouve que le refus
 * vient de la suspension et de rien d'autre. Si un jour la route se mettait à
 * vérifier le PIN d'abord, ce test tomberait — et il aurait raison : une caisse
 * suspendue rendrait alors « PIN invalide » à une équipe dont le PIN est bon,
 * et on chercherait longtemps.
 *
 * ─── LE PARC EST REMIS EN ÉTAT, ET C'EST VÉRIFIÉ ───
 *
 * La réactivation est dans un `finally`, et son résultat est RELU. Un test qui
 * laisserait un vrai restaurant suspendu serait pire que pas de test du tout.
 * Le scénario refuse aussi de démarrer sur un établissement DÉJÀ suspendu : le
 * réactiver à la fin rouvrirait un compte que quelqu'un a fermé exprès.
 */
import assert from 'node:assert/strict';
import { DELAI_PROPAGATION, cibles } from '../socle/cibles.mjs';
import { rechargerJusqua } from '../socle/attentes.mjs';
import { FORMATS, scenario } from '../socle/navigateur.mjs';
import { avecRemiseEnEtat, client } from '../socle/api.mjs';
import { identifiants, raisonDeSauter } from '../socle/env.mjs';
import { classerJournal, noterARemettre, reparerParcSiNecessaire } from '../socle/parc.mjs';

const parc = cibles();
const sauter = raisonDeSauter(parc);

/** Ce que l'API répond à un gérant coupé, et à une tablette coupée. */
const MESSAGE_ACCES = 'Accès suspendu — contactez Snack Manager';
const CODE_ACCES = 'tenant_suspended';
/** Ce que lit le CLIENT sur le site du restaurant. */
const MESSAGE_VITRINE =
  'La commande en ligne est momentanément indisponible. Merci d’appeler directement le restaurant.';

/** Un PIN qui n'ouvre rien, nulle part — la sonde ne doit ouvrir aucun service. */
const PIN_SONDE = '000000';

const MOTIF = 'Vérification automatisée de bout en bout — réactivation immédiate';

scenario(
  'Suspension — la caisse ne s’ouvre plus, la vitrine se ferme proprement',
  { format: FORMATS.telephone, sauter, delai: 300_000 },
  async (page) => {
    const { equipe } = identifiants();
    const equipeApi = client(parc.api);
    const gerantApi = client(parc.api);

    await equipeApi.connexion(equipe);
    await gerantApi.connexion(identifiants().gerant);

    // Une exécution tuée entre la suspension et la réactivation aurait laissé
    // un vrai restaurant coupé. La note posée sur disque est rejouée ici, avant
    // toute lecture — c'est le seul filet qui existe pour ce cas-là.
    await reparerParcSiNecessaire();

    // ── L'établissement visé, et son état de départ ──
    const tenants = await equipeApi.get('/crm/tenants');
    const tenant = tenants.find((t) => t.slug === parc.slug);
    assert.ok(tenant, `aucun établissement « ${parc.slug} » dans le parc « ${parc.nom} »`);
    assert.equal(
      tenant.accountStatus,
      'active',
      `« ${parc.slug} » est déjà en « ${tenant.accountStatus} » : ce scénario ne réactive ` +
        'pas un compte que quelqu’un a fermé exprès. Réglez d’abord la situation à la main.',
    );

    const vitrine = `${parc.web}/r/${parc.slug}`;

    /** État de la route d'ouverture de service, telle qu'une caisse la voit. */
    const ouvertureDeService = () =>
      equipeApi.brut('POST', '/auth/pin', { tenantSlug: parc.slug, pin: PIN_SONDE });

    // ── Référence : le refus normal d'un PIN faux sur un compte actif ──
    const avant = await ouvertureDeService();
    assert.equal(
      avant.statut,
      401,
      'sur un établissement actif, un PIN faux doit être refusé pour ce qu’il est : un PIN faux',
    );

    // Le geste inverse est noté AVANT la suspension : si la machine meurt entre
    // les deux, la prochaine exécution rouvrira le restaurant toute seule.
    await noterARemettre([
      {
        acteur: 'equipe',
        methode: 'POST',
        chemin: `/crm/tenants/${tenant._id}/reactivate`,
        corps: { reason: `${MOTIF} — reprise après interruption` },
        decrit: `${tenant.name} réactivé`,
      },
    ]);

    let suspendu = false;
    await avecRemiseEnEtat(async () => {
      // ── La suspension ──
      const compte = await equipeApi.post(`/crm/tenants/${tenant._id}/suspend`, { reason: MOTIF });
      suspendu = true;
      assert.equal(compte.account.status, 'suspended', 'l’API doit rendre le compte suspendu');
      assert.equal(compte.accessBlocked, true, 'un compte suspendu doit être annoncé « accès bloqué »');

      // ── 1 · La caisse ne peut plus ouvrir son service ──
      const pendant = await ouvertureDeService();
      assert.equal(
        pendant.statut,
        403,
        'un établissement suspendu doit REFUSER l’ouverture de service, pas la laisser passer',
      );
      assert.equal(
        pendant.charge?.message,
        MESSAGE_ACCES,
        'l’équipe du restaurant doit lire pourquoi son poste ne s’ouvre plus',
      );

      // ── 2 · Le back-office du gérant se ferme aussi ──
      // Sa session était ouverte AVANT la suspension : le jeton reste
      // cryptographiquement valide douze heures. C'est le guard qui relit le
      // statut à chaque requête — sans lui, un gérant coupé continuerait de
      // travailler jusqu'à l'expiration.
      const gerant = await gerantApi.brut('GET', '/tenants/me');
      assert.equal(gerant.statut, 403, 'une session de gérant déjà ouverte doit se refermer');
      assert.equal(gerant.charge?.message, MESSAGE_ACCES);
      assert.equal(
        gerant.charge?.code,
        CODE_ACCES,
        'le code machine doit accompagner le refus — c’est lui qui distingue « suspendu » de « mal identifié »',
      );

      // ── 3 · La vitrine publique se ferme PROPREMENT ──
      // Proprement veut dire : pas une erreur, pas un 404, pas une page vide.
      // Le restaurant reste sur Internet, sa carte reste lisible, seule la
      // commande s'arrête — on suspend un accès, on n'efface pas un commerce.
      const delai = await rechargerJusqua(
        page,
        vitrine,
        async (p) => (await p.getByText('Commande en ligne suspendue').count()) > 0,
        { delai: DELAI_PROPAGATION },
      );
      console.log(`   ↳ vitrine fermée après ${(delai / 1000).toFixed(1)} s (cache Next : 60 s)`);

      const texte = (await page.locator('body').textContent()) ?? '';
      assert.ok(
        texte.includes('Commande en ligne en pause'),
        'la vitrine doit expliquer la fermeture, pas seulement la subir',
      );
      assert.ok(
        texte.includes(MESSAGE_VITRINE),
        'le client doit lire le message de fermeture destiné au consommateur',
      );
      assert.ok(
        texte.includes(tenant.name),
        'le restaurant reste identifié sur sa page — on suspend un accès, on n’efface pas un commerce',
      );
      await page.getByRole('link', { name: /^Appeler/ }).first().waitFor({ state: 'visible' });

      // La carte reste consultable : le bouton principal invite à la voir, il
      // n'invite plus à commander.
      await page.getByRole('button', { name: /Voir la carte/ }).waitFor({ state: 'visible' });
      assert.equal(
        await page.getByRole('button', { name: 'Commander maintenant' }).count(),
        0,
        'aucun appel à commander ne doit subsister sur un site fermé',
      );

      // ── 4 · L'API publique dit la même chose que la page ──
      const site = await equipeApi.get(`/public/tenants/${parc.slug}/site`);
      assert.equal(site.ordering.paused, true);
      assert.equal(site.ordering.message, MESSAGE_VITRINE);
    },
    // ── Le parc est remis en état, et on le VÉRIFIE ──
    async () => {
      if (!suspendu) {
        await classerJournal();
        return;
      }

      const compte = await equipeApi.post(`/crm/tenants/${tenant._id}/reactivate`, {
        reason: `${MOTIF} — terminée`,
      });
      assert.equal(
        compte.account.status,
        'active',
        `LE PARC N’A PAS ÉTÉ REMIS EN ÉTAT : « ${parc.slug} » est resté suspendu.`,
      );

      const rouvert = await ouvertureDeService();
      assert.equal(
        rouvert.statut,
        401,
        'après réactivation, l’ouverture de service doit redevenir une simple affaire de PIN',
      );

      const site = await equipeApi.get(`/public/tenants/${parc.slug}/site`);
      assert.equal(site.ordering.paused, false, 'la commande en ligne doit rouvrir');

      await classerJournal();
    });
  },
);
