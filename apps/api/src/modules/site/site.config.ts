import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Racine des adresses que nous hébergeons nous-mêmes.
 *
 * Elle est configurable parce qu'elle diffère par environnement (recette sur
 * un domaine jetable, production sur snackmanager.app) et qu'elle apparaît
 * partout : sous-domaine automatique du restaurant, résolution du Host entrant,
 * refus d'un domaine « personnalisé » qui serait en réalité déjà le nôtre.
 */
@Injectable()
export class SiteConfig {
  readonly rootDomain: string;

  constructor(config: ConfigService) {
    this.rootDomain = (
      config.get<string>('PUBLIC_ROOT_DOMAIN') ?? 'snackmanager.app'
    )
      .trim()
      .toLowerCase()
      .replace(/^\.+|\.+$/g, '');
  }

  /** Adresse servie sans aucune action du restaurateur : « classfood.snackmanager.app ». */
  subdomainFor(slug: string): string {
    return `${slug}.${this.rootDomain}`;
  }

  /** URL cliquable — HTTPS partout, un site de commande sans certificat ne se partage pas. */
  urlFor(hostname: string): string {
    return `https://${hostname}`;
  }
}
