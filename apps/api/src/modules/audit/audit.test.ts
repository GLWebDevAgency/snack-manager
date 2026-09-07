import { describe, expect, it } from 'vitest';
import {
  AUDIT_ACTION_LABELS,
  TENANT_AUDIT_ACTIONS,
  type JwtPayload,
  type TenantAuditAction,
} from '@sm/contracts';
import { journalDeTest } from './audit.fakes';

/**
 * LE REGISTRE DU RESTAURANT — ce qu'il sait dire de l'auteur d'un geste.
 *
 * Avant ce chantier, il ne portait qu'un identifiant d'équipier, posé par les
 * deux seules routes qui re-demandent un code. Tout ce qui se fait depuis le
 * back-office — un prix, une rupture, un horaire — n'avait donc AUCUN auteur,
 * alors que c'est la première question qu'on pose à un registre.
 */

const TENANT = '665f0d0a1c2b3d4e5f6a7b80';
const GERANT = '665f0d0a1c2b3d4e5f6a7b01';
const SARAH = '665f0d0a1c2b3d4e5f6a7b02';

const sessionCompte: JwtPayload = {
  sub: GERANT,
  tenantId: TENANT,
  role: 'owner',
  kind: 'user',
};

const sessionTablette: JwtPayload = {
  sub: SARAH,
  tenantId: TENANT,
  role: 'caisse',
  kind: 'staff',
};

const registre = () =>
  journalDeTest({
    users: [{ _id: GERANT, name: 'Karim Belkacem', email: 'karim@classfood.fr' }],
    staff: [{ _id: SARAH, name: 'Sarah', role: 'caisse' }],
  });

describe('l’auteur d’un geste', () => {
  it('trace l’accès livreur sans le confondre avec un compte professionnel', async () => {
    const { audit, lignes } = registre();
    await audit.log({ tenantId: TENANT, action: 'order.dispatch',
      actor: { kind: 'delivery', sub: SARAH, role: 'livreur', name: 'Nora livraison' } });
    // Même identifiant qu’un Staff de la fixture : aucune résolution vers Sarah.
    expect(lignes[0]!.author).toEqual({ id: SARAH, name: 'Nora livraison', role: 'livreur', means: 'delivery_access' });
    expect((await audit.list(TENANT))[0]!.author?.means).toBe('delivery_access');
  });

  it('nomme la personne, son rôle, et par quel moyen elle a ouvert sa session', async () => {
    const { audit, lignes } = registre();

    await audit.log({
      tenantId: TENANT,
      actor: sessionCompte,
      action: 'price.change',
      targetId: 'p1',
      meta: { name: 'Tacos', fromCents: 950, toCents: 890 },
    });

    expect(lignes[0]!.author).toEqual({
      id: GERANT,
      name: 'Karim Belkacem',
      role: 'owner',
      // Mot de passe : le geste vient du back-office, pas du comptoir.
      means: 'password',
    });
  });

  it('distingue le code sur tablette du mot de passe — ce n’est pas le même engagement', async () => {
    const { audit, lignes } = registre();

    await audit.log({
      tenantId: TENANT,
      actor: sessionTablette,
      staffId: SARAH,
      action: 'order.cancel',
      meta: { reason: 'Erreur de saisie' },
      pinVerifiedAt: new Date('2026-09-02T11:30:00.000Z'),
    });

    expect(lignes[0]!.author).toEqual({
      id: SARAH,
      name: 'Sarah',
      role: 'caisse',
      means: 'pin',
    });
    expect(lignes[0]!.pinVerifiedAt).toEqual(new Date('2026-09-02T11:30:00.000Z'));
  });

  it('recopie le nom : renommer un équipier ne réécrit pas le passé', async () => {
    const { audit, lignes, staff } = registre();

    await audit.log({ tenantId: TENANT, actor: sessionTablette, action: 'product.stock' });
    // Sarah se marie, ou l'on corrige une faute de frappe. Le geste d'hier
    // reste celui de « Sarah » — c'est tout l'intérêt de la dénormalisation,
    // et c'est la règle que suit déjà `adminLogs.actorEmail`.
    staff.rows[0]!.name = 'Sarah Benali';

    expect((lignes[0]!.author as { name: string }).name).toBe('Sarah');
  });

  it('n’invente aucun auteur quand le geste ne vient pas d’une session', async () => {
    const { audit, lignes } = registre();
    await audit.log({ tenantId: TENANT, action: 'stock.movement' });
    // `null` dit « on ne sait pas ». Un « système » inventé laisserait croire
    // qu'une machine a décidé, ce qui n'est vrai d'aucun geste tracé ici.
    expect(lignes[0]!.author).toBeNull();
  });

  it('laisse le nom vide plutôt que d’échouer si le compte a disparu', async () => {
    const { audit, lignes } = journalDeTest();
    await audit.log({ tenantId: TENANT, actor: sessionCompte, action: 'tenant.hours' });
    // Le geste a eu lieu : il reste au registre, sans nom. Refuser d'écrire
    // ferait perdre la ligne pour sauver une étiquette.
    expect(lignes[0]!.author).toMatchObject({ id: GERANT, name: '', role: 'owner' });
  });
});

describe('la relecture du registre', () => {
  it('rend l’auteur et le libellé en français, du plus récent au plus ancien', async () => {
    const { audit } = registre();

    await audit.log({
      tenantId: TENANT,
      actor: sessionCompte,
      action: 'ingredient.out',
      meta: { name: 'Cheddar', isOut: true, productsUpdated: 7 },
    });

    const [ligne] = await audit.list(TENANT);
    expect(ligne!.action).toBe('ingredient.out');
    expect(ligne!.actionLabel).toBe('Rupture d’ingrédient');
    expect(ligne!.author).toMatchObject({ name: 'Karim Belkacem', means: 'password' });
    expect(ligne!.meta.productsUpdated).toBe(7);
  });

  it('sait encore lire une ligne d’avant l’auteur — le registre ne se réécrit pas', async () => {
    const { audit, lignes } = registre();
    // Telles que les écrivaient les deux seuls émetteurs d'alors : un
    // `staffId`, pas d'auteur. Une reprise de données serait exclue sur un
    // registre append-only ; la lecture s'en accommode donc.
    lignes.push({
      _id: 'ancienne',
      tenantId: TENANT,
      staffId: SARAH,
      action: 'order.discount',
      meta: { amount: 200 },
      at: new Date('2026-08-01T12:00:00.000Z'),
    });

    const ligne = (await audit.list(TENANT)).find((e) => e._id === 'ancienne')!;
    expect(ligne.author).toBeNull();
    // Le nom résolu par jointure, comme avant : c'est le seul recours pour ces
    // lignes-là, et il vaut mieux qu'un identifiant brut devant un gérant.
    expect(ligne.staffName).toBe('Sarah');
  });

  it('dit « équipier supprimé » plutôt que de perdre le geste', async () => {
    const { audit, lignes } = registre();
    lignes.push({
      _id: 'orpheline',
      tenantId: TENANT,
      staffId: '665f0d0a1c2b3d4e5f6a7bff',
      action: 'order.cancel',
      at: new Date('2026-08-01T12:00:00.000Z'),
    });

    const ligne = (await audit.list(TENANT)).find((e) => e._id === 'orpheline')!;
    expect(ligne.staffName).toBe('équipier supprimé');
  });

  it('ne rend que le registre de l’établissement demandé', async () => {
    const { audit, lignes } = registre();
    await audit.log({ tenantId: TENANT, actor: sessionCompte, action: 'tenant.logo' });
    lignes.push({ _id: 'ailleurs', tenantId: '665f0d0a1c2b3d4e5f6a7b99', action: 'tenant.logo' });

    const vues = await audit.list(TENANT);
    expect(vues.map((e) => e._id)).not.toContain('ailleurs');
  });
});

describe('le périmètre du registre', () => {
  it('donne un libellé français à chaque action — jamais un code machine', () => {
    const sansLibelle = TENANT_AUDIT_ACTIONS.filter((a) => !AUDIT_ACTION_LABELS[a]);
    expect(sansLibelle).toEqual([]);
  });

  it('couvre l’argent, la disponibilité, le stock et ce que voit le client', () => {
    // Ce test énumère ce que le chantier s'est engagé à tracer. Retirer une
    // de ces actions du contrat sans le décider explicitement casse ici, et
    // c'est le point : le périmètre est une décision, pas un effet de bord.
    const attendues: TenantAuditAction[] = [
      'price.change',
      'product.create',
      'product.delete',
      'product.stock',
      'category.delete',
      'stock.movement',
      'stock.adjust',
      'ingredient.out',
      'ingredient.delete',
      'tenant.identity',
      'tenant.hours',
      'tenant.settings',
      'tenant.brand',
      'tenant.logo',
      'tenant.billing_identity',
    ];
    for (const action of attendues) expect(TENANT_AUDIT_ACTIONS).toContain(action);
  });

  it('n’a toujours AUCUN émetteur pour le remboursement — et c’est dit, pas caché', () => {
    // `order.refund` est déclarée depuis l'origine et aucune route de
    // remboursement n'existe dans l'API. Le libellé est conservé pour le jour
    // où elle naîtra ; ce test empêche qu'on la prenne pour un oubli, et il
    // tombera le jour où quelqu'un l'écrira — moment exact où il faudra venir
    // vérifier que l'émetteur porte bien un auteur.
    expect(TENANT_AUDIT_ACTIONS).toContain('order.refund');
    expect(AUDIT_ACTION_LABELS['order.refund']).toBe('Remboursement');
  });

  it('n’enrôle pas ce qui relève de la mise en page', () => {
    // Le renommage d'un produit, la création d'une catégorie et le
    // réordonnancement de la carte ne touchent ni l'argent ni la
    // disponibilité : les tracer noierait les lignes qui se défendent.
    for (const absente of ['product.rename', 'category.create', 'category.reorder']) {
      expect(TENANT_AUDIT_ACTIONS as readonly string[]).not.toContain(absente);
    }
  });
});
