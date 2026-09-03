import { redirect } from "next/navigation";

/**
 * `/admin` N'EST PAS UN ÉCRAN, C'EST UNE PORTE — et elle mène désormais LÀ OÙ
 * MÈNE LA CONNEXION.
 *
 * Deux destinations se disputaient l'entrée : cette redirection serveur vers
 * la carte, et une redirection client vers le tableau de bord posée dans la
 * coque. La seconde ne s'exécutait jamais — le serveur répond avant que la
 * coque ne soit montée — et `login/page.tsx` envoyait déjà sur le tableau de
 * bord. Un même logiciel avait donc deux accueils selon la porte empruntée.
 *
 * C'est le tableau de bord qui gagne, et il ne gagne pas par ancienneté :
 * « Aujourd'hui » est la première entrée du premier groupe de la barre, il
 * résume le service en cours, et c'est l'écran qu'on ouvre pour SAVOIR. La
 * carte est un écran qu'on ouvre pour MODIFIER — accueillir un gérant sur un
 * formulaire de prix était un accident de l'ordre de livraison des écrans.
 *
 * La redirection reste SERVEUR : elle part avant le moindre pixel, sans
 * clignotement. Elle perd en revanche la requête — c'est pourquoi la vitrine
 * vise `/admin/dashboard?demo=1` directement (cf. `marketing/content.ts`).
 */
export default function AdminIndex() {
  redirect("/admin/dashboard");
}
