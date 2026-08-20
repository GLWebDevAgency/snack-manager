import { describe, expect, it } from 'vitest';
import { HealthController } from './health.controller';
import { revisionServie } from './revision';

/**
 * LA ROUTE QUI DIT QUELLE RÉVISION EST EN LIGNE.
 *
 * Deux exigences, et elles tirent en sens inverse :
 *   · elle doit publier le SHA quand il existe — sinon le contrôle de santé ne
 *     peut rien AFFIRMER après un déploiement ;
 *   · elle ne doit JAMAIS tomber quand il n'existe pas — sinon `/health` est
 *     rouge sur chaque poste de développement, et on apprend à l'ignorer.
 */

const SHA = 'c0ffee1234567890abcdef1234567890abcdef12';

describe('revisionServie', () => {
  it("ne publie aucune révision quand l'environnement n'en porte pas — et ne lève pas", () => {
    const r = revisionServie({});
    expect(r.revision).toBeNull();
    expect(r.revisionCourte).toBeNull();
    expect(r.environnement).toBeNull();
    expect(r.deploiement).toBeNull();
  });

  it('publie SM_REVISION, posée par deploy.yml avant railway up', () => {
    const r = revisionServie({ SM_REVISION: SHA });
    expect(r.revision).toBe(SHA);
    expect(r.revisionCourte).toBe('c0ffee1');
  });

  it('retombe sur RAILWAY_GIT_COMMIT_SHA le jour où le service serait branché sur GitHub', () => {
    const r = revisionServie({ RAILWAY_GIT_COMMIT_SHA: SHA });
    expect(r.revision).toBe(SHA);
  });

  it('fait gagner SM_REVISION : c\'est la seule des deux qu\'on pose nous-mêmes', () => {
    const r = revisionServie({ SM_REVISION: SHA, RAILWAY_GIT_COMMIT_SHA: 'aaaaaaa' });
    expect(r.revision).toBe(SHA);
  });

  it('traite une variable VIDE comme absente — le cas réel de RAILWAY_GIT_REPO_OWNER= chez Railway', () => {
    // Sans ce garde-fou, `revisionCourte` vaudrait '' et le contrôle de santé
    // comparerait deux chaînes vides… avec succès.
    const r = revisionServie({ SM_REVISION: '', RAILWAY_GIT_COMMIT_SHA: '   ' });
    expect(r.revision).toBeNull();
    expect(r.revisionCourte).toBeNull();
  });

  it("relève l'environnement et le déploiement Railway quand ils sont là", () => {
    const r = revisionServie({
      SM_REVISION: SHA,
      RAILWAY_ENVIRONMENT_NAME: 'staging',
      RAILWAY_DEPLOYMENT_ID: 'bbe5e37a-5dc5-4702-a0d1-71d607a306e3',
    });
    expect(r.environnement).toBe('staging');
    expect(r.deploiement).toBe('bbe5e37a-5dc5-4702-a0d1-71d607a306e3');
  });

  it('rend un horodatage de démarrage stable entre deux appels', () => {
    expect(revisionServie({}).demarreLe).toBe(revisionServie({}).demarreLe);
    expect(Number.isNaN(Date.parse(revisionServie({}).demarreLe))).toBe(false);
  });
});

describe('GET /health', () => {
  it('conserve le contrat que scripts/smoke.mjs exige', () => {
    const charge = new HealthController().health();
    expect(charge.ok).toBe(true);
    expect(charge.service).toBe('snack-manager-api');
  });

  it('porte les champs de révision', () => {
    const charge = new HealthController().health();
    expect(charge).toHaveProperty('revision');
    expect(charge).toHaveProperty('revisionCourte');
    expect(charge).toHaveProperty('deploiement');
  });
});
