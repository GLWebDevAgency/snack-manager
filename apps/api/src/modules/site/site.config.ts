import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Racine des adresses que nous hébergeons nous-mêmes.
 *
 * Elle est configurable parce qu'elle diffère par environnement (recette sur
 * un domaine jetable, production sur snackmanager.fr) et qu'elle apparaît
 * partout : sous-domaine automatique du restaurant, résolution du Host entrant,
 * refus d'un domaine « personnalisé » qui serait en réalité déjà le nôtre.
 *
 * ═══ POURQUOI IL N'Y A PLUS DE REPLI ═══
 *
 * Cette classe reposait sur un défaut `snackmanager.app` — un domaine qui n'est
 * pas celui du projet. La vitrine, les métadonnées et `web/src/proxy.ts`
 * travaillent sur `snackmanager.fr`, si bien que la même plateforme dictait au
 * même restaurateur DEUX cibles CNAME différentes selon la surface qui lui
 * parlait (`docs/adr/0004-*.md` avait relevé la divergence sans la corriger).
 *
 * Corriger le défaut n'aurait fait que déplacer la faute : un repli silencieux
 * survit à une variable oubliée en production, et personne ne s'en aperçoit
 * avant qu'un client n'ait pointé son DNS à côté — un site injoignable pendant
 * la propagation, chez lui, pas chez nous. La variable est donc OBLIGATOIRE :
 * mieux vaut une API qui refuse de démarrer, tout de suite et bruyamment,
 * qu'une instruction DNS fausse donnée à un client.
 *
 * Le contrôle est écrit à la main plutôt que délégué à `getOrThrow` — la
 * convention des autres variables obligatoires (`MONGO_URL`, `REDIS_URL`,
 * `JWT_SECRET`, `DATABASE_URL`) — pour deux raisons : `getOrThrow` laisse
 * passer la chaîne vide et le « . » esseulé, qui produiraient un
 * « classfood. » parfaitement silencieux ; et la valeur doit de toute façon
 * être jugée APRÈS normalisation, pas avant. Effet de bord utile : les tests
 * continuent d'injecter un simple `{ get }` (`site.fakes.ts`).
 */
@Injectable()
export class SiteConfig {
  readonly rootDomain: string;

  constructor(config: ConfigService) {
    const rootDomain = (config.get<string>('PUBLIC_ROOT_DOMAIN') ?? '')
      .trim()
      .toLowerCase()
      .replace(/^\.+|\.+$/g, '');

    if (rootDomain === '') {
      throw new Error(
        "PUBLIC_ROOT_DOMAIN est obligatoire : c'est la racine des adresses que " +
          'nous servons (« classfood.snackmanager.fr ») et la cible CNAME dictée ' +
          'aux restaurateurs. En production : snackmanager.fr.',
      );
    }

    this.rootDomain = rootDomain;
  }

  /** Adresse servie sans aucune action du restaurateur : « classfood.snackmanager.fr ». */
  subdomainFor(slug: string): string {
    return `${slug}.${this.rootDomain}`;
  }

  /** URL cliquable — HTTPS partout, un site de commande sans certificat ne se partage pas. */
  urlFor(hostname: string): string {
    return `https://${hostname}`;
  }
}
