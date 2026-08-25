"use client";

/**
 * PRODUCTION DE L'ATELIER — « qu'est-ce que je dois à mes clients cette
 * semaine ? », le pendant TENUE DE PROMESSE du pipeline commercial.
 *
 * Depuis que « réseaux, 2 publications/semaine » ou « présence internet,
 * rapport mensuel » se signent, il y a une promesse récurrente à tenir — et
 * aucun écran ne la rappelait le lundi matin : le premier client réseaux
 * oublié une semaine aurait découvert le trou lui-même.
 *
 * Le DÛ vient de l'API, qui le DÉRIVE de ce que chaque client a signé
 * (`tenant.atelier`) : cet écran n'invente aucune tâche, il coche. La coche
 * est OPTIMISTE (la ligne bascule au clic, le serveur confirme) et
 * réversible — décocher est un geste aussi ordinaire que cocher, parce
 * qu'un doigt glisse.
 *
 * La navigation remonte les semaines PASSÉES (rattraper un oubli, vérifier
 * une promesse tenue) ; la semaine PROCHAINE n'existe pas ici — l'API la
 * refuse, rien ne se coche d'avance.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CrmProductionClient, CrmProductionWeek } from "@sm/contracts";
import { cx } from "@/lib/cx";
import { Btn, Card, EmptyState, Icon, Skeleton, useToast } from "@/components/ui";
import { crm, fmtDay, int } from "../crm";

export default function ProductionPage() {
  const toast = useToast();
  const [data, setData] = useState<CrmProductionWeek | null>(null);
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState(false);

  // Miroir de `data` pour les rappels qui ne doivent pas se réabonner à
  // chaque réponse (rafraîchissement au retour d'onglet, repli d'erreur).
  const dataRef = useRef<CrmProductionWeek | null>(null);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  // Depuis un GESTE (navigation de semaine, réessai) : l'état de chargement
  // bascule au clic. Le chargement INITIAL, lui, part déjà en « loading » —
  // l'effet ne pose donc aucun état en synchrone (règle set-state-in-effect).
  const load = useCallback(
    (week?: string) => {
      setLoading(true);
      crm
        .production(week)
        .then((d) => {
          setData(d);
          setErreur(false);
        })
        .catch(() => {
          // Une navigation qui échoue ne jette pas l'écran : la semaine déjà
          // affichée reste — l'écran d'erreur plein est réservé au tout
          // premier chargement, quand il n'y a rien d'autre à montrer.
          if (dataRef.current) toast("Semaine indisponible — réessayez");
          else setErreur(true);
        })
        .finally(() => setLoading(false));
    },
    [toast],
  );

  useEffect(() => {
    let cancelled = false;
    crm
      .production()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setErreur(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * L'ONGLET LAISSÉ OUVERT DU VENDREDI AU LUNDI — le moment exact pour
   * lequel cet écran existe : sans rafraîchissement, il dirait encore
   * « Cette semaine, tout est fait » sur la semaine d'avant. Au retour sur
   * l'onglet, si l'écran SUIVAIT la semaine courante, il se recale en
   * silence (pas de squelette — rien ne doit clignoter sous une coche).
   * Une semaine passée consultée exprès, elle, ne bouge pas sous le lecteur.
   */
  useEffect(() => {
    const reveil = () => {
      if (document.visibilityState !== "visible") return;
      const d = dataRef.current;
      if (d && d.week === d.current) {
        crm
          .production()
          .then(setData)
          .catch(() => {});
      }
    };
    window.addEventListener("focus", reveil);
    document.addEventListener("visibilitychange", reveil);
    return () => {
      window.removeEventListener("focus", reveil);
      document.removeEventListener("visibilitychange", reveil);
    };
  }, []);

  async function basculer(client: CrmProductionClient, task: string, done: boolean) {
    if (!data) return;
    const week = data.week;
    // Optimiste : la coche répond au doigt, le serveur confirme derrière.
    // La bascule ET son annulation s'appliquent à l'état COURANT — restaurer
    // un instantané complet effacerait une coche voisine partie entre-temps.
    setData((courant) => (courant ? appliquer(courant, client.tenantId, task, done) : courant));
    try {
      await crm.tickProduction(client.tenantId, {
        week,
        task: task as CrmProductionClient["tasks"][number]["key"],
        done,
        note: "",
      });
      // La décoche est un geste rare et lourd de sens (la trace s'efface) :
      // le dire évite qu'un doigt qui glisse passe inaperçu.
      if (!done) toast("Coche retirée");
    } catch {
      setData((courant) =>
        courant ? appliquer(courant, client.tenantId, task, !done) : courant,
      );
      toast("Coche impossible — réessayez");
    }
  }

  if (erreur) {
    return (
      <EmptyState
        icon="gear"
        title="File de production indisponible"
        hint="La route /crm/production ne répond pas — réessayez, ou vérifiez l'API."
        action={<Btn variant="ghost" size="sm" onClick={() => load()}>Réessayer</Btn>}
      />
    );
  }

  if (loading || !data) {
    return (
      <div className="flex flex-col gap-3 p-[26px] max-md:p-4">
        <Skeleton className="h-16" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
    );
  }

  const semaineCourante = data.week === data.current;

  return (
    <div className="flex flex-col gap-4 p-[26px] max-md:p-4">
      {/* ── La semaine, et où l'on en est ── */}
      <Card className="flex items-center justify-between gap-3 p-4 max-md:flex-col max-md:items-stretch">
        <div>
          <div className="text-sm font-bold text-ink">
            {semaineCourante ? "Cette semaine" : "Semaine passée"} — {data.label}
          </div>
          <div className="mt-0.5 text-xs text-mut">
            {data.total > 0
              ? `${int(data.done)} sur ${int(data.total)} promesses tenues${data.done === data.total ? " — tout est fait" : ""}`
              : semaineCourante
                ? "Rien de récurrent n'est dû cette semaine."
                : "Rien de récurrent n'était dû cette semaine-là."}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Btn variant="ghost" size="sm" icon="back" onClick={() => load(data.previous)}>
            Précédente
          </Btn>
          {/* La semaine PROCHAINE n'existe pas ici : rien ne se doit d'avance. */}
          {data.next && (
            <Btn variant="ghost" size="sm" onClick={() => load(data.next ?? undefined)}>
              Suivante →
            </Btn>
          )}
          {!semaineCourante && (
            <Btn variant="ink" size="sm" onClick={() => load()}>
              Revenir à aujourd&apos;hui
            </Btn>
          )}
        </div>
      </Card>

      {/* ── La file, client par client ── */}
      {data.clients.length === 0 ? (
        <EmptyState
          icon="check"
          title="Aucune promesse récurrente sur cette semaine"
          hint="La file se remplit toute seule : dès qu'un client signe les réseaux sociaux ou la présence internet, son travail hebdomadaire apparaît ici."
        />
      ) : (
        data.clients.map((client) => (
          <Card key={client.tenantId} className="p-4">
            <div className="flex items-baseline justify-between gap-2">
              <span className="flex min-w-0 items-baseline gap-2">
                <Link
                  href={`/sm/clients/${client.tenantId}`}
                  className="min-w-0 truncate text-sm font-bold text-ink underline-offset-2 hover:underline"
                >
                  {client.name}
                </Link>
                {/* Un suspendu reste dans la file — mais la décision de
                    continuer le travail exige de VOIR le statut ici. */}
                {client.accountStatus === "suspended" && (
                  <span className="shrink-0 rounded-pill border-[1.5px] border-alert/70 bg-alert/12 px-[9px] py-[3px] text-[10px] font-extrabold uppercase tracking-[0.06em] text-alertt">
                    Suspendu
                  </span>
                )}
              </span>
              <span
                className={cx(
                  "cf-fig shrink-0 text-[11px]",
                  client.done === client.total ? "text-accent" : "text-mut",
                )}
              >
                {client.done}/{client.total}
              </span>
            </div>
            {client.signedAt && (
              <div className="mt-0.5 text-[11px] text-mut">
                Atelier signé le {fmtDay(client.signedAt)}
              </div>
            )}
            <div className="mt-2 flex flex-col gap-1">
              {client.tasks.map((task) => (
                <button
                  key={task.key}
                  type="button"
                  // La bascule s'annonce comme telle : la case dessinée est
                  // décorative, l'état vit sur le bouton (même règle que
                  // Toggle et Chip).
                  aria-pressed={task.done}
                  onClick={() => void basculer(client, task.key, !task.done)}
                  className={cx(
                    "cf-press-row flex items-center gap-2.5 rounded-ctrl border px-3 py-2 text-left",
                    task.done
                      ? "border-accent/30 bg-accent/6"
                      : "border-white/10 hover:border-white/25",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cx(
                      "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border-[1.5px]",
                      task.done ? "border-accent bg-accent text-onaccent" : "border-white/30",
                    )}
                  >
                    {task.done && <Icon name="check" size={12} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cx(
                        "block text-[13px]",
                        task.done ? "text-mut" : "text-ink",
                      )}
                    >
                      {task.label}
                    </span>
                    {task.note && (
                      <span className="block truncate text-[11px] italic text-mut">
                        « {task.note} »
                      </span>
                    )}
                  </span>
                  {task.done && task.doneAt && (
                    <span className="cf-fig shrink-0 text-[11px] text-mut">
                      fait le {fmtDay(task.doneAt)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </Card>
        ))
      )}
    </div>
  );
}

/** La bascule locale d'une coche — l'écran répond avant le réseau. */
function appliquer(
  data: CrmProductionWeek,
  tenantId: string,
  task: string,
  done: boolean,
): CrmProductionWeek {
  const clients = data.clients.map((c) => {
    if (c.tenantId !== tenantId) return c;
    const tasks = c.tasks.map((t) =>
      t.key === task ? { ...t, done, doneAt: done ? new Date().toISOString() : null } : t,
    );
    return { ...c, tasks, done: tasks.filter((t) => t.done).length };
  });
  return {
    ...data,
    clients,
    done: clients.reduce((n, c) => n + c.done, 0),
  };
}
