import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { orderingApi } from "@/components/order/api";
import { DemoStorefront } from "@/components/order/demo/DemoStorefront";
import { DEMO_SLUG, isDemoRequested, type SearchParams } from "@/components/order/demo/mode";
import { demoTransport } from "@/components/order/demo/transport";

/**
 * Commande en ligne en démonstration — `/r/demo?demo=1`.
 *
 * Le parcours complet d'un client, de la carte au numéro de retrait, servi par
 * un restaurant qui n'existe pas : « Le Comptoir », le même établissement
 * fictif que dans la caisse et l'écran cuisine. Rien n'est appelé — ni API, ni
 * base, ni Stripe : tout tourne dans le navigateur du visiteur, sur la fixture
 * de `components/order/demo`.
 *
 * ─── POURQUOI UNE ROUTE À PART ───
 *
 * Elle aurait pu vivre dans `/r/[slug]` derrière une condition. Elle vit ici,
 * dans un segment statique, pour que la page des VRAIS restaurants n'ait
 * aucune ligne de code capable de servir une carte fictive : `/r/[slug]`
 * n'importe rien de `components/order/demo`, et aucun paramètre d'adresse ne
 * peut l'y amener. Un client dont le domaine est réécrit vers `/r/son-slug`
 * (voir `src/proxy.ts`) est hors d'atteinte par construction — pas par
 * vigilance.
 *
 * Sans le paramètre exact `?demo=1`, cette adresse répond 404, comme
 * n'importe quel restaurant inconnu : la carte fictive n'apparaît jamais sans
 * qu'on l'ait explicitement demandée.
 */

type Props = {
  searchParams: Promise<SearchParams>;
};

/**
 * Jamais indexée.
 *
 * Une carte fictive dans Google, avec des prix et une adresse inventés,
 * concurrencerait les pages de nos propres clients sur les requêtes qui les
 * font vivre (« kebab Rouen »). La vitrine amène ici par un lien, jamais un
 * moteur de recherche.
 */
export const metadata: Metadata = {
  title: "Commande en ligne — démonstration Snack Manager",
  description:
    "Parcours de commande en ligne Snack Manager, sur un restaurant fictif : carte, options, créneau de retrait et confirmation.",
  robots: { index: false, follow: false },
};

export default async function DemoOrderPage({ searchParams }: Props) {
  const query = await searchParams;
  if (!isDemoRequested(DEMO_SLUG, query)) notFound();

  // Le rendu serveur passe par le MÊME client que le navigateur, sur le même
  // transport en mémoire : la carte part dans le HTML (elle s'affiche sans
  // attendre le JavaScript), et sa forme est celle que le normaliseur reçoit
  // du réseau. Sans latence ici : simuler une connexion lente au moment du
  // rendu ne ferait que retarder le premier affichage.
  const site = await orderingApi(demoTransport({ latency: false })).loadSite(DEMO_SLUG);
  if (!site) notFound();

  return <DemoStorefront site={site} />;
}
