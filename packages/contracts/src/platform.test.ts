import { describe, expect, it } from 'vitest';
import {
  EMPTY_SOCIAL_LINKS,
  PLATFORM_SETTINGS_ID,
  PlatformSettingsUpdateSchema,
  PlatformSocialLinksUpdateSchema,
  SOCIAL_LINK_MAX_LENGTH,
  SOCIAL_NETWORKS,
  socialLinkSchema,
} from './index';

/**
 * CE QUE CES TESTS PROTÈGENT.
 *
 * Les liens saisis ici partent en production sur la page d'accueil sans
 * relecture. Chaque bloc reproduit un geste qu'un humain fait vraiment devant
 * le formulaire — coller dans le mauvais champ, laisser un espace, vider un
 * champ pour retirer un compte — et vérifie que le défaut est arrêté à la
 * validation, pas découvert par un prospect.
 */

const message = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.success ? '' : (result.error?.issues[0]?.message ?? '');

describe('un lien collé dans le champ d’un autre réseau', () => {
  it('refuse une adresse TikTok dans le champ Instagram', () => {
    const result = socialLinkSchema('instagram').safeParse('https://www.tiktok.com/@snackmanager');
    expect(result.success).toBe(false);
    // Le message doit NOMMER l'erreur : sans ça, l'auteur du collage relit son
    // adresse, la trouve correcte, et ne comprend pas le refus.
    expect(message(result)).toContain('TikTok');
    expect(message(result)).toContain('Instagram');
  });

  it('refuse une adresse Instagram dans le champ LinkedIn', () => {
    const result = socialLinkSchema('linkedin').safeParse('https://instagram.com/snackmanager');
    expect(result.success).toBe(false);
    expect(message(result)).toContain('Instagram');
  });

  it('refuse un domaine étranger aux quatre réseaux', () => {
    const result = socialLinkSchema('facebook').safeParse('https://exemple.fr/snackmanager');
    expect(result.success).toBe(false);
    expect(message(result)).toContain('exemple.fr');
    expect(message(result)).toContain('facebook.com');
  });

  it('refuse un domaine qui IMITE celui du réseau', () => {
    // `instagram.com.attaquant.fr` contient bien « instagram.com » : une
    // vérification par `includes` l'aurait laissé passer, et le pictogramme
    // Instagram de notre page d'accueil aurait mené chez un tiers.
    expect(socialLinkSchema('instagram').safeParse('https://instagram.com.attaquant.fr/x').success).toBe(
      false,
    );
    expect(socialLinkSchema('tiktok').safeParse('https://faux-tiktok.com/@sm').success).toBe(false);
  });

  it('accepte chaque réseau sur son propre domaine', () => {
    expect(socialLinkSchema('instagram').parse('https://www.instagram.com/snackmanager')).toBe(
      'https://www.instagram.com/snackmanager',
    );
    expect(socialLinkSchema('tiktok').parse('https://www.tiktok.com/@snackmanager')).toBe(
      'https://www.tiktok.com/@snackmanager',
    );
    expect(socialLinkSchema('facebook').parse('https://www.facebook.com/snackmanager')).toBe(
      'https://www.facebook.com/snackmanager',
    );
    expect(socialLinkSchema('linkedin').parse('https://www.linkedin.com/company/snackmanager')).toBe(
      'https://www.linkedin.com/company/snackmanager',
    );
  });

  it('accepte les variantes régionales et les sous-domaines des réseaux', () => {
    // Ce sont des adresses que le navigateur donne réellement selon le pays et
    // l'appareil : les refuser ferait passer la validation pour un caprice.
    expect(socialLinkSchema('linkedin').parse('https://fr.linkedin.com/company/snackmanager')).toBeTruthy();
    expect(socialLinkSchema('facebook').parse('https://m.facebook.com/snackmanager')).toBeTruthy();
    expect(socialLinkSchema('tiktok').parse('https://vm.tiktok.com/ZMabcdef/')).toBeTruthy();
    expect(socialLinkSchema('instagram').parse('https://instagr.am/snackmanager')).toBeTruthy();
  });
});

describe('http', () => {
  it('refuse une adresse en clair, même sur le bon domaine', () => {
    const result = socialLinkSchema('instagram').safeParse('http://www.instagram.com/snackmanager');
    expect(result.success).toBe(false);
    expect(message(result)).toContain('https');
  });

  it('refuse les schémas exotiques qui « parsent » pourtant très bien', () => {
    // `new URL()` accepte ces deux chaînes sans broncher : seule la règle
    // https les arrête, et c'est elle qui empêche un script d'atterrir dans un
    // attribut href de la page d'accueil.
    expect(socialLinkSchema('instagram').safeParse('javascript:alert(1)').success).toBe(false);
    expect(socialLinkSchema('instagram').safeParse('data:text/html,<b>x</b>').success).toBe(false);
  });
});

describe('la chaîne vide n’est pas une URL', () => {
  it('ramène une chaîne vide à null — vider un champ EFFACE le lien', () => {
    // Enregistrer `""` afficherait un pictogramme cliquable menant nulle part :
    // exactement le défaut que le réglage doit empêcher.
    expect(socialLinkSchema('instagram').parse('')).toBeNull();
  });

  it('ramène une chaîne d’espaces à null', () => {
    expect(socialLinkSchema('facebook').parse('   ')).toBeNull();
  });

  it('accepte null — un réseau sans compte est un cas normal', () => {
    expect(socialLinkSchema('tiktok').parse(null)).toBeNull();
  });
});

describe('espaces autour d’une adresse collée', () => {
  it('rogne les espaces au lieu de refuser', () => {
    // Un collage depuis un e-mail ou un SMS traîne presque toujours un espace
    // ou un retour à la ligne. Refuser ferait porter au fondateur une faute
    // qui n'est pas la sienne ; garder l'espace produirait une URL cassée.
    expect(socialLinkSchema('instagram').parse('  https://instagram.com/snackmanager \n')).toBe(
      'https://instagram.com/snackmanager',
    );
  });

  it('rogne AVANT de vérifier le protocole', () => {
    expect(socialLinkSchema('instagram').safeParse(' https://instagram.com/sm ').success).toBe(true);
  });
});

describe('adresses incomplètes ou aberrantes', () => {
  it('refuse une adresse sans protocole', () => {
    // On ne préfixe PAS « https:// » d'office : deviner l'intention d'une
    // saisie ambiguë, c'est publier une adresse que personne n'a écrite.
    const result = socialLinkSchema('instagram').safeParse('instagram.com/snackmanager');
    expect(result.success).toBe(false);
    expect(message(result)).toContain('https://');
  });

  it('refuse l’accueil du réseau, qui n’est pas notre compte', () => {
    expect(socialLinkSchema('instagram').safeParse('https://www.instagram.com').success).toBe(false);
    expect(socialLinkSchema('instagram').safeParse('https://www.instagram.com/').success).toBe(false);
  });

  it('refuse un lien porteur d’identifiants', () => {
    const result = socialLinkSchema('facebook').safeParse('https://sm:secret@facebook.com/snackmanager');
    expect(result.success).toBe(false);
    expect(message(result)).toContain('identifiants');
  });

  it('refuse un collage démesuré', () => {
    const enorme = `https://instagram.com/${'a'.repeat(SOCIAL_LINK_MAX_LENGTH)}`;
    expect(socialLinkSchema('instagram').safeParse(enorme).success).toBe(false);
  });
});

/**
 * CHAMP ABSENT ≠ CHAMP À NULL.
 *
 * C'est la distinction qui permet de retirer UN compte sans réécrire les trois
 * autres. Le même piège qu'ailleurs dans le projet la guette : un
 * `.partial()` dérivé d'un schéma à `.default()` réintroduirait les clés
 * absentes et effacerait des liens que personne n'a touchés.
 */
describe('mise à jour partielle des réseaux', () => {
  it('un champ envoyé, un champ ressorti', () => {
    const parsed = PlatformSocialLinksUpdateSchema.parse({
      instagram: 'https://instagram.com/snackmanager',
    });
    expect(parsed).toEqual({ instagram: 'https://instagram.com/snackmanager' });
    expect('tiktok' in parsed).toBe(false);
    expect('facebook' in parsed).toBe(false);
    expect('linkedin' in parsed).toBe(false);
  });

  it('un champ ABSENT ne dit rien : le lien existant reste', () => {
    expect(PlatformSocialLinksUpdateSchema.parse({})).toEqual({});
  });

  it('un champ à NULL dit quelque chose : effacer', () => {
    const parsed = PlatformSocialLinksUpdateSchema.parse({ tiktok: null });
    expect(parsed).toEqual({ tiktok: null });
    expect('tiktok' in parsed).toBe(true);
  });

  it('une chaîne vide est l’autre façon d’effacer — le formulaire n’envoie pas null', () => {
    // Un `<input>` vidé transmet `""`, jamais `null` : les deux doivent mener
    // au même effacement, sinon vider un champ dans l'écran ne retirerait rien.
    expect(PlatformSocialLinksUpdateSchema.parse({ facebook: '' })).toEqual({ facebook: null });
  });

  it('un seul lien fautif fait échouer tout le lot', () => {
    // Écriture tout ou rien : accepter les trois liens valides et taire le
    // quatrième laisserait l'écran afficher « enregistré » sur une saisie
    // partiellement perdue.
    const result = PlatformSocialLinksUpdateSchema.safeParse({
      instagram: 'https://instagram.com/sm',
      tiktok: 'https://instagram.com/sm',
    });
    expect(result.success).toBe(false);
  });

  it('la rubrique social est facultative dans le PATCH', () => {
    expect(PlatformSettingsUpdateSchema.parse({})).toEqual({});
    expect(PlatformSettingsUpdateSchema.parse({ social: { linkedin: null } })).toEqual({
      social: { linkedin: null },
    });
  });
});

describe('correspondance avec la vitrine', () => {
  it('porte exactement les identifiants employés par la landing', () => {
    // `RESEAUX` (apps/web/src/components/marketing/content.ts) les lit tels
    // quels : toute divergence imposerait une table de conversion.
    expect([...SOCIAL_NETWORKS]).toEqual(['instagram', 'tiktok', 'facebook', 'linkedin']);
    expect(Object.keys(EMPTY_SOCIAL_LINKS)).toEqual([...SOCIAL_NETWORKS]);
  });

  it('l’état de départ ne publie aucun réseau', () => {
    expect(Object.values(EMPTY_SOCIAL_LINKS).every((url) => url === null)).toBe(true);
  });

  it('la clé du document unique est une constante figée', () => {
    // Elle est la clé primaire du réglage côté base : la changer ferait
    // repartir la plateforme sur un document vide, liens compris.
    expect(PLATFORM_SETTINGS_ID).toBe('platform');
  });
});
