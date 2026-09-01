"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { LoyaltyProgramView, LoyaltyRewardView } from "@sm/contracts";
import { Btn, Card, EmptyState, Icon, IconBtn, Panel, Pill, Skeleton, Toggle, useToast } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { fmtEuro } from "@/lib/format";
import { loyaltyApi } from "../data";
import { RewardDrawer } from "./RewardDrawer";

const KIND_LABEL = {
  custom: "Avantage personnalisé",
  fixed_discount: "Remise fixe",
  product: "Produit offert",
} as const;

function rewardBenefit(reward: LoyaltyRewardView): string {
  if (reward.kind === "fixed_discount") return fmtEuro(reward.valueCents);
  if (reward.kind === "product") return reward.productRef ?? "Produit offert";
  return reward.description || "Avantage remis au comptoir";
}

export default function LoyaltyRewardsPage() {
  const toast = useToast();
  const [program, setProgram] = useState<LoyaltyProgramView | null | undefined>(undefined);
  const [rewards, setRewards] = useState<LoyaltyRewardView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<LoyaltyRewardView | "new" | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [nextProgram, nextRewards] = await Promise.all([
        loyaltyApi.getProgram(),
        loyaltyApi.listRewards(),
      ]);
      setProgram(nextProgram);
      setRewards(nextRewards);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Chargement des récompenses impossible.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lecture API initiale, partagée avec le réessai explicite.
    void load();
  }, [load]);

  function upsert(saved: LoyaltyRewardView) {
    setRewards((current) => {
      const list = current ?? [];
      return list.some((item) => item.id === saved.id)
        ? list.map((item) => (item.id === saved.id ? saved : item))
        : [...list, saved].sort((a, b) => a.costUnits - b.costUnits);
    });
    setEditor(null);
    toast(editor === "new" ? "Récompense créée" : "Récompense mise à jour", { icon: "check" });
  }

  async function toggle(reward: LoyaltyRewardView) {
    if (toggling) return;
    setToggling(reward.id);
    setRewards((current) => current?.map((item) => item.id === reward.id ? { ...item, active: !item.active } : item) ?? null);
    try {
      const saved = await loyaltyApi.updateReward(reward.id, { active: !reward.active });
      setRewards((current) => current?.map((item) => item.id === saved.id ? saved : item) ?? null);
      toast(saved.active ? "Récompense activée" : "Récompense mise en pause", { icon: "check" });
    } catch (cause) {
      setRewards((current) => current?.map((item) => item.id === reward.id ? reward : item) ?? null);
      toast(cause instanceof ApiError ? cause.message : "Modification impossible — réessayez.");
    } finally {
      setToggling(null);
    }
  }

  if (error && !rewards) {
    return <div className="p-4 md:p-[26px]"><div className="rounded-card border border-alert/40 bg-alert/10 p-4"><p className="text-sm text-alertt" role="alert">{error}</p><Btn variant="ghost" size="sm" className="mt-3" onClick={() => void load()}>Réessayer</Btn></div></div>;
  }
  if (program === undefined || rewards === null) {
    return <div className="p-4 md:p-[26px]"><Skeleton className="h-[92px]" /><Skeleton className="mt-4 h-[420px]" /></div>;
  }
  if (!program) {
    return (
      <div className="p-4 md:p-[26px]">
        <Card><EmptyState icon="gift" title="Configurez d'abord votre programme" hint="Le coût d'une récompense dépend de la mécanique et du vocabulaire choisis." action={<Link href="/admin/fidelite/programme" className="cf-press inline-flex rounded-pill bg-accent px-5 py-3 text-sm font-bold text-onaccent">Configurer le programme</Link>} /></Card>
      </div>
    );
  }

  const unitPlural = program.unitLabelPlural;
  const unitSingular = program.unitLabelSingular;

  return (
    <div className="p-4 md:p-[26px]">
      <Panel
        title="Catalogue de récompenses"
        sub={`${rewards.filter((reward) => reward.active).length} active${rewards.filter((reward) => reward.active).length > 1 ? "s" : ""} · aucune suppression irréversible`}
        actions={<Btn size="sm" icon="plus" onClick={() => setEditor("new")}>Nouvelle récompense</Btn>}
        bodyClassName="-mx-[18px] -mb-[18px]"
      >
        {rewards.length === 0 ? (
          <EmptyState icon="gift" title="Créez le premier avantage" hint={`Définissez un coût en ${unitPlural} et ce que le client reçoit.`} action={<Btn size="sm" icon="plus" onClick={() => setEditor("new")}>Créer une récompense</Btn>} />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 p-[18px] lg:hidden">
              {rewards.map((reward) => (
                <Card key={reward.id} flat className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="grid size-10 shrink-0 place-items-center rounded-card bg-accent/12 text-accent"><Icon name="gift" size={19} /></div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div><h3 className="text-sm font-extrabold text-ink">{reward.name}</h3><p className="mt-0.5 text-xs text-mut">{KIND_LABEL[reward.kind]}</p></div>
                        <IconBtn icon="edit" label={`Modifier ${reward.name}`} size={34} iconSize={15} onClick={() => setEditor(reward)} />
                      </div>
                      <p className="mt-3 text-xs leading-5 text-ink">{rewardBenefit(reward)}</p>
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <Pill className="border-accent/25 bg-accent/10 text-accent">{reward.costUnits.toLocaleString("fr-FR")} {reward.costUnits === 1 ? unitSingular : unitPlural}</Pill>
                        <Toggle label={`${reward.active ? "Désactiver" : "Activer"} ${reward.name}`} on={reward.active} disabled={toggling === reward.id} onChange={() => void toggle(reward)} />
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full border-collapse text-left text-sm">
                <thead><tr className="border-b border-line2 bg-white/[0.025] text-[11px] uppercase tracking-[0.06em] text-mut"><th className="px-[18px] py-3 font-semibold">Récompense</th><th className="px-4 py-3 font-semibold">Avantage</th><th className="px-4 py-3 text-right font-semibold">Coût</th><th className="px-4 py-3 text-center font-semibold">Active</th><th className="px-[18px] py-3"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody className="divide-y divide-line2">
                  {rewards.map((reward) => (
                    <tr key={reward.id} className="hover:bg-white/[0.025]">
                      <td className="px-[18px] py-3.5"><div className="font-bold text-ink">{reward.name}</div><div className="mt-0.5 text-xs text-mut">{KIND_LABEL[reward.kind]}</div></td>
                      <td className="max-w-[360px] px-4 py-3.5 text-[13px] text-ink">{rewardBenefit(reward)}</td>
                      <td className="cf-fig whitespace-nowrap px-4 py-3.5 text-right font-extrabold text-accent">{reward.costUnits.toLocaleString("fr-FR")} <span className="text-xs font-semibold">{reward.costUnits === 1 ? unitSingular : unitPlural}</span></td>
                      <td className="px-4 py-3.5 text-center"><Toggle label={`${reward.active ? "Désactiver" : "Activer"} ${reward.name}`} on={reward.active} disabled={toggling === reward.id} onChange={() => void toggle(reward)} /></td>
                      <td className="px-[18px] py-3.5 text-right"><IconBtn icon="edit" label={`Modifier ${reward.name}`} size={34} iconSize={15} onClick={() => setEditor(reward)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>

      {editor && (
        <RewardDrawer
          key={editor === "new" ? "new" : editor.id}
          reward={editor === "new" ? null : editor}
          unitPlural={unitPlural}
          onClose={() => setEditor(null)}
          onSaved={upsert}
        />
      )}
    </div>
  );
}
