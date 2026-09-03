/**
 * ═══════════════════════════════════════════════════════════════════════════
 * L'INVITATION À INSTALLER — et le trou iOS qu'elle bouche
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * L'invitation était un bouton de 12 px dans l'en-tête, monté sur le seul
 * événement `beforeinstallprompt`. Or cet événement N'EXISTE PAS sur iOS :
 * Safari ne l'a jamais implémenté, et l'ajout à l'écran d'accueil s'y fait
 * uniquement par le menu Partager. Sur la moitié du parc français,
 * l'application ne proposait donc RIEN — pas même une phrase — alors que c'est
 * exactement la surface qu'on veut voir installée : une carte de fidélité
 * qu'on rouvre est une carte qu'on garde.
 *
 * Ce module est PUR : il décide quoi proposer à partir de faits, et c'est ce
 * qui le rend prouvable sans navigateur.
 */

/**
 * Ce que le NAVIGATEUR permet — lu une fois, indépendamment de l'état React.
 *
 *   `autonome` — la page tourne déjà comme une application installée ;
 *   `ios`      — pas d'API d'installation, mais un geste à expliquer ;
 *   `rien`     — ni l'un ni l'autre (un Chrome de bureau, par exemple).
 */
export type ContexteInstallation = "autonome" | "ios" | "rien";

export type ModeInstallation =
  /** Rien à proposer : déjà installée, écartée, ou navigateur muet. */
  | "aucune"
  /** L'événement natif est disponible : un bouton suffit. */
  | "invite"
  /** iOS : aucune API, il faut dire le geste. */
  | "ios";

/**
 * Le repérage d'iOS se fait sur l'agent utilisateur, faute de mieux.
 *
 * `navigator.platform` est déprécié et figé par les navigateurs ; les
 * `userAgentData` d'iOS n'existent pas. Le second membre du test attrape
 * l'iPad depuis iPadOS 13, qui se présente comme un Macintosh : un Mac ne
 * connaît pas `ontouchend`, un iPad si. C'est le seul repérage que Safari
 * laisse faire, et une erreur ici ne coûte qu'une phrase d'aide inutile — pas
 * une fonctionnalité perdue.
 */
export function estIOS(ua: string, tactile: boolean): boolean {
  if (/iphone|ipad|ipod/i.test(ua)) return true;
  return tactile && /macintosh/i.test(ua);
}

/**
 * L'application tourne-t-elle DÉJÀ comme une application installée ?
 *
 * Deux signaux, parce qu'aucun n'est universel : `display-mode: standalone`
 * (le standard, respecté par Chrome et par Safari depuis 17) et le
 * `navigator.standalone` historique d'iOS, seul disponible sur les versions
 * antérieures. Se tromper ici, c'est proposer d'installer une application à
 * quelqu'un qui l'a déjà ouverte depuis son écran d'accueil.
 */
export function dejaInstallee(
  affichageAutonome: boolean,
  standaloneIOS: unknown,
): boolean {
  return affichageAutonome || standaloneIOS === true;
}

export function contexteInstallation(faits: {
  ua: string;
  tactile: boolean;
  affichageAutonome: boolean;
  standaloneIOS: unknown;
}): ContexteInstallation {
  if (dejaInstallee(faits.affichageAutonome, faits.standaloneIOS)) return "autonome";
  return estIOS(faits.ua, faits.tactile) ? "ios" : "rien";
}

/**
 * La décision finale.
 *
 * L'invitation NATIVE passe avant le mode iOS : un navigateur qui sait
 * installer tout seul n'a pas à recevoir un mode d'emploi. Et `ecartee` gagne
 * sur tout — quelqu'un qui vient de dire « pas maintenant » ne doit pas revoir
 * la proposition trois lignes plus bas.
 */
export function modeInstallation(faits: {
  contexte: ContexteInstallation;
  /** `beforeinstallprompt` a été capté et n'a pas encore été consommé. */
  inviteNative: boolean;
  /** Le client vient d'écarter l'invitation. */
  ecartee: boolean;
}): ModeInstallation {
  if (faits.ecartee || faits.contexte === "autonome") return "aucune";
  if (faits.inviteNative) return "invite";
  return faits.contexte === "ios" ? "ios" : "aucune";
}
