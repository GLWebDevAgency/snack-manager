"use client";

/**
 * Vue « Caisses & cuisine » — les appareils de terrain vus du back-office.
 *
 * Cette page existe pour une raison précise : jusqu'ici la caisse portait le
 * slug du restaurant EN DUR dans son code. Le produit ne savait servir qu'un
 * établissement. Désormais une tablette neuve s'appaire ici, en six
 * caractères, exactement comme un téléviseur de salle — et c'est le jeton
 * remis à l'appairage, jamais une constante, qui lui dit chez qui elle
 * travaille.
 *
 * Trois partis pris, repris de « Écrans TV » :
 *
 *  — l'ÉTAT est la donnée principale. Une caisse muette en plein service est
 *    le seul incident qui coûte de l'argent à la minute : la liste se
 *    rafraîchit toute seule toutes les 30 secondes ;
 *  — le CODE est montré en très gros à la création. À cet instant le
 *    restaurateur a la tablette en main : il ne doit rien avoir à chercher ;
 *  — RÉAPPAIRER est un geste de sécurité, pas de dépannage. Il est expliqué
 *    comme tel, et confirmé.
 *
 * API : GET/POST /devices · PATCH/DELETE /devices/:id ·
 *       POST /devices/:id/regenerate-code
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEVICE_KINDS,
  DEVICE_KIND_LABELS,
  type DeviceKind,
} from "@sm/contracts";
import { api, ApiError } from "@/lib/api";
import {
  Btn,
  Card,
  EmptyState,
  Field,
  Icon,
  Input,
  Modal,
  Panel,
  Select,
  Skeleton,
  useToast,
} from "@/components/ui";
import {
  CodeCountdown,
  CopyBtn,
  InstallSteps,
  PairingCode,
  PAIRING_TTL_LABEL,
  useNow,
} from "./parts";
import { DeviceCard } from "./device-card";
import { KIND_PLACEHOLDER, KIND_ROLE, type DeviceView } from "./types";

/** Cadence de rafraîchissement de la liste — l'état reste juste sans action. */
const REFRESH_MS = 30_000;

export default function DevicesPage() {
  const toast = useToast();
  const now = useNow(REFRESH_MS);

  const [loadState, setLoadState] = useState<"loading" | "error" | "ready">("loading");
  const [devices, setDevices] = useState<DeviceView[]>([]);

  // ── Dialogues ──
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<{ name: string; kind: DeviceKind }>({
    name: "",
    kind: "pos",
  });
  /** Le nom a-t-il été saisi à la main ? Sinon il suit la nature choisie. */
  const [nameTouched, setNameTouched] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [installId, setInstallId] = useState<string | null>(null);
  const [installFresh, setInstallFresh] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [regenId, setRegenId] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const byId = useCallback(
    (id: string | null) => (id ? (devices.find((d) => d.id === id) ?? null) : null),
    [devices],
  );
  const installDevice = byId(installId);
  const renameDevice = byId(renameId);
  const regenDevice = byId(regenId);
  const deleteDevice = byId(deleteId);

  // ── Chargement ──

  const loadDevices = useCallback(async () => {
    setDevices(await api.get<DeviceView[]>("/devices"));
  }, []);

  const load = useCallback(async () => {
    try {
      await loadDevices();
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }, [loadDevices]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Rafraîchissement silencieux : ni squelette, ni message d'erreur. Une caisse
   * « hors ligne depuis 6 min » doit devenir « 7 min » toute seule, et un
   * appairage réussi sur la tablette doit se voir ici sans clic. Une panne
   * réseau passagère laisse simplement la dernière valeur connue affichée.
   */
  useEffect(() => {
    if (loadState !== "ready") return;
    const refresh = () => {
      void loadDevices().catch(() => {});
    };
    const id = window.setInterval(refresh, REFRESH_MS);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", refresh);
    };
  }, [loadState, loadDevices]);

  const retry = () => {
    setLoadState("loading");
    void load();
  };

  const replace = (updated: DeviceView) =>
    setDevices((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));

  // ── Mutations ──

  function openCreate(kind: DeviceKind = "pos") {
    setDraft({ name: KIND_PLACEHOLDER[kind], kind });
    setNameTouched(false);
    setCreateError(null);
    setCreating(true);
  }

  /** Changer la nature renomme aussi, tant que le gérant n'a rien tapé. */
  function pickKind(kind: DeviceKind) {
    setDraft((d) => ({ kind, name: nameTouched ? d.name : KIND_PLACEHOLDER[kind] }));
  }

  async function submitCreate() {
    const name = draft.name.trim();
    if (!name || submitting) return;
    setSubmitting(true);
    setCreateError(null);
    try {
      const created = await api.post<DeviceView>("/devices", { name, kind: draft.kind });
      setDevices((prev) => [created, ...prev]);
      setCreating(false);
      // On enchaîne SANS transition sur le code : c'est l'instant critique de
      // l'installation, et il n'y a rien d'autre à faire à cette seconde.
      setInstallFresh(true);
      setInstallId(created.id);
      toast("Appareil créé — voici son code d'appairage", { icon: "check" });
    } catch (e) {
      setCreateError(
        e instanceof ApiError || e instanceof Error
          ? e.message
          : "Création impossible — réessayez",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function openRename(device: DeviceView) {
    setRenameValue(device.name);
    setRenameId(device.id);
  }

  async function submitRename() {
    const name = renameValue.trim();
    if (!renameDevice || !name || renaming) return;
    setRenaming(true);
    try {
      replace(await api.patch<DeviceView>(`/devices/${renameDevice.id}`, { name }));
      setRenameId(null);
      toast("Appareil renommé", { icon: "check" });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Renommage impossible — réessayez");
    } finally {
      setRenaming(false);
    }
  }

  async function confirmRegenerate() {
    if (!regenDevice || regenerating) return;
    setRegenerating(true);
    try {
      const updated = await api.post<DeviceView>(
        `/devices/${regenDevice.id}/regenerate-code`,
      );
      replace(updated);
      setRegenId(null);
      // Un nouveau code n'a de valeur qu'accompagné de la marche à suivre.
      setInstallFresh(false);
      setInstallId(updated.id);
      toast("Nouveau code généré — l'ancien appareil est révoqué", { icon: "check" });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Génération impossible — réessayez");
    } finally {
      setRegenerating(false);
    }
  }

  async function confirmDelete() {
    if (!deleteDevice || deleting) return;
    setDeleting(true);
    const { id, name } = deleteDevice;
    try {
      await api.del(`/devices/${id}`);
      setDevices((prev) => prev.filter((d) => d.id !== id));
      setDeleteId(null);
      if (installId === id) setInstallId(null);
      if (renameId === id) setRenameId(null);
      toast(`Appareil « ${name} » supprimé`, { icon: "check" });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Suppression impossible — réessayez");
    } finally {
      setDeleting(false);
    }
  }

  const summary = useMemo(() => {
    const waiting = devices.filter((d) => !d.paired).length;
    const offline = devices.filter((d) => d.paired && !d.online).length;
    if (devices.length === 0) return "Aucun appareil appairé";
    const parts = [`${devices.length} appareil${devices.length > 1 ? "s" : ""}`];
    if (waiting > 0) parts.push(`${waiting} en attente d'appairage`);
    if (offline > 0) parts.push(`${offline} hors ligne`);
    parts.push("état actualisé toutes les 30 s");
    return parts.join(" · ");
  }, [devices]);

  // ─── Chargement / erreur ───

  if (loadState === "loading")
    return (
      <div className="grid grid-cols-1 items-start gap-4 p-[26px] xl:grid-cols-[1.25fr_0.75fr]">
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-[240px]" />
          <Skeleton className="h-[240px]" />
        </div>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-[300px]" />
          <Skeleton className="h-[200px]" />
        </div>
      </div>
    );

  if (loadState === "error")
    return (
      <div className="p-[26px]">
        <Card>
          <EmptyState
            icon="search"
            title="Impossible de charger vos appareils"
            hint="Vérifiez votre connexion puis réessayez."
            action={
              <Btn variant="ghost" size="sm" onClick={retry}>
                Réessayer
              </Btn>
            }
          />
        </Card>
      </div>
    );

  return (
    <div className="grid grid-cols-1 items-start gap-4 p-[26px] xl:grid-cols-[1.25fr_0.75fr]">
      {/* ── Colonne principale : les appareils ── */}
      <section className="flex min-w-0 flex-col gap-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-[-0.03em] text-ink">
              Vos caisses et écrans cuisine
            </h2>
            <p className="mt-0.5 text-[13px] text-mut">{summary}</p>
          </div>
          <Btn icon="plus" onClick={() => openCreate("pos")}>
            Ajouter un appareil
          </Btn>
        </div>

        {devices.length === 0 ? (
          <Card>
            <EmptyState
              icon="print"
              title="Aucun appareil — appairez votre première caisse"
              hint="Une tablette, six caractères à saisir : elle prend le nom et les couleurs de votre établissement, et n'y reviendra plus jamais."
              action={
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Btn icon="plus" onClick={() => openCreate("pos")}>
                    Ajouter une caisse
                  </Btn>
                  <Btn variant="ghost" icon="plus" onClick={() => openCreate("kds")}>
                    Ajouter un écran cuisine
                  </Btn>
                </div>
              }
            />
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {devices.map((device) => (
              <DeviceCard
                key={device.id}
                device={device}
                now={now}
                onInstall={() => {
                  setInstallFresh(false);
                  setInstallId(device.id);
                }}
                onRename={() => openRename(device)}
                onRegenerate={() => setRegenId(device.id)}
                onDelete={() => setDeleteId(device.id)}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Colonne d'aide ── */}
      <div className="flex flex-col gap-4">
        <Panel title="Appairer un appareil" sub="Trois gestes, une seule fois">
          <InstallSteps kind="pos" />
          <p className="mt-4 border-t border-line2 pt-3.5 text-[13px] text-mut">
            Vous n&apos;avez ni compte ni adresse à créer pour une
            tablette&nbsp;: le code lui apprend chez qui elle travaille.
            Ensuite, vos équipiers ouvrent le service avec leur code à quatre
            chiffres, comme d&apos;habitude.
          </p>
        </Panel>

        <Panel
          title="Tablette perdue ou volée"
          sub="Le geste qui coupe l'accès"
        >
          <p className="text-[13px] leading-relaxed text-mut">
            <span className="font-semibold text-ink">
              «&nbsp;Réappairer&nbsp;» révoque immédiatement l&apos;appareil
            </span>{" "}
            et génère un code neuf. C&apos;est le seul geste qui empêche une
            tablette disparue de continuer à ouvrir votre caisse — changer les
            codes de l&apos;équipe n&apos;y suffirait pas.
          </p>
          <p className="mt-2.5 text-[13px] leading-relaxed text-mut">
            Pour une tablette simplement figée, inutile&nbsp;: fermez et
            rouvrez l&apos;application, elle repart avec son appairage.
          </p>
        </Panel>
      </div>

      {/* ── Création ── */}
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Ajouter un appareil"
        width={460}
        footer={
          <>
            <Btn variant="ghost" onClick={() => setCreating(false)}>
              Annuler
            </Btn>
            <Btn
              disabled={submitting || !draft.name.trim()}
              onClick={() => void submitCreate()}
            >
              {submitting ? "Création…" : "Créer et obtenir le code"}
            </Btn>
          </>
        }
      >
        <div className="flex flex-col gap-3.5">
          <Field label="Nature de l'appareil" htmlFor="device-kind">
            <Select
              id="device-kind"
              value={draft.kind}
              onChange={(e) => pickKind(e.target.value as DeviceKind)}
            >
              {DEVICE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {DEVICE_KIND_LABELS[k]}
                </option>
              ))}
            </Select>
          </Field>

          <p className="-mt-1 text-[13px] text-mut">{KIND_ROLE[draft.kind]}.</p>

          <Field
            label="Nom de l'appareil"
            htmlFor="device-name"
            error={createError}
            hint="Pour vous y retrouver quand vous en aurez plusieurs : « Caisse comptoir », « Caisse terrasse »…"
          >
            <Input
              id="device-name"
              value={draft.name}
              maxLength={60}
              autoFocus
              placeholder={KIND_PLACEHOLDER[draft.kind]}
              onChange={(e) => {
                setNameTouched(true);
                setDraft((d) => ({ ...d, name: e.target.value }));
                setCreateError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitCreate();
              }}
            />
          </Field>

          <p className="rounded-ctrl border border-line2 bg-surface2 px-3.5 py-2.5 text-[13px] leading-relaxed text-mut">
            Un code à six caractères, valable {PAIRING_TTL_LABEL}, s&apos;affiche
            juste après&nbsp;: gardez la tablette à portée de main.
          </p>
        </div>
      </Modal>

      {/* ── Marche à suivre + code ── */}
      <Modal
        open={installDevice !== null}
        onClose={() => setInstallId(null)}
        width={600}
        title={
          installDevice?.paired
            ? `« ${installDevice.name} » est appairé`
            : installFresh
              ? "Appareil créé — appairez-le maintenant"
              : `Appairer « ${installDevice?.name ?? ""} »`
        }
        footer={
          <>
            {installDevice && !installDevice.paired && (
              <Btn
                variant="ghost"
                onClick={() => {
                  setInstallId(null);
                  setRegenId(installDevice.id);
                }}
              >
                Générer un nouveau code
              </Btn>
            )}
            <Btn variant="ink" onClick={() => setInstallId(null)}>
              Terminé
            </Btn>
          </>
        }
      >
        {installDevice &&
          (installDevice.paired ? (
            /* L'appairage est arrivé pendant que la modale était ouverte : le
               gérant a tapé le code sur la tablette et voit ici la
               confirmation, sans avoir à traverser la salle pour vérifier. */
            <div className="flex flex-col items-center gap-2 py-4 text-center">
              <div className="grid size-12 place-items-center rounded-pill bg-ok text-white">
                <Icon name="check" size={24} />
              </div>
              <p className="text-sm font-bold text-ink">
                La tablette est à vos couleurs
              </p>
              <p className="max-w-[380px] text-[13px] text-mut">
                Elle affiche désormais votre établissement et attend le code
                équipe. Le code d&apos;appairage ne sera plus jamais demandé.
              </p>
            </div>
          ) : (
            // Le contenu est long par nature (code + trois étapes) : sur un
            // portable peu haut il défile plutôt que de déborder de l'écran.
            <div className="cf-scroll flex max-h-[calc(100vh-200px)] flex-col gap-4 overflow-y-auto">
              {/*
                Puits SOMBRE sous les tuiles du code : celles-ci valent #1a1a1a,
                et un support de la même valeur les ferait disparaître (DA §1).
              */}
              <div className="rounded-card border border-white/10 bg-black/35 px-4 py-4">
                <div className="mb-2.5 text-[11px] font-extrabold uppercase tracking-[0.06em] text-mut">
                  Code à saisir sur la tablette
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  {installDevice.pairing ? (
                    <>
                      <PairingCode
                        code={installDevice.pairing.code}
                        dimmed={installDevice.pairing.expired}
                      />
                      <div className="flex flex-wrap items-center gap-3">
                        <CodeCountdown
                          expiresAt={installDevice.pairing.expiresAt}
                          expired={installDevice.pairing.expired}
                        />
                        <CopyBtn
                          value={installDevice.pairing.code}
                          what="Le code"
                          variant="ink"
                        />
                      </div>
                    </>
                  ) : (
                    <p className="text-[13px] text-mut">
                      Aucun code actif. Générez-en un nouveau ci-dessous.
                    </p>
                  )}
                </div>
                {installDevice.pairing?.expired && (
                  <p className="mt-3 border-t border-line2 pt-3 text-[13px] text-alertt">
                    Ce code a expiré&nbsp;: il ne vit que {PAIRING_TTL_LABEL}.
                    Générez-en un nouveau.
                  </p>
                )}
              </div>

              <InstallSteps kind={installDevice.kind} />

              <p className="border-t border-line2 pt-3.5 text-[13px] text-mut">
                Le code n&apos;est valable que {PAIRING_TTL_LABEL}. Passé ce
                délai, revenez ici et générez-en un nouveau&nbsp;: la tablette,
                elle, n&apos;a rien à refaire.
              </p>
            </div>
          ))}
      </Modal>

      {/* ── Renommage ── */}
      <Modal
        open={renameDevice !== null}
        onClose={() => setRenameId(null)}
        title="Renommer cet appareil"
        width={440}
        footer={
          <>
            <Btn variant="ghost" onClick={() => setRenameId(null)}>
              Annuler
            </Btn>
            <Btn
              disabled={renaming || !renameValue.trim()}
              onClick={() => void submitRename()}
            >
              {renaming ? "Enregistrement…" : "Enregistrer"}
            </Btn>
          </>
        }
      >
        <Field
          label="Nom de l'appareil"
          htmlFor="device-rename"
          hint="Le nom n'apparaît que dans ce back-office : il vous sert à identifier la bonne tablette."
        >
          <Input
            id="device-rename"
            value={renameValue}
            maxLength={60}
            autoFocus
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitRename();
            }}
          />
        </Field>
      </Modal>

      {/* ── Réappairage (révoque l'appareil appairé) ── */}
      <Modal
        open={regenDevice !== null}
        onClose={() => setRegenId(null)}
        title={regenDevice?.paired ? "Réappairer cet appareil" : "Générer un nouveau code"}
        destructive
        width={480}
        footer={
          <>
            <Btn variant="ghost" onClick={() => setRegenId(null)}>
              Annuler
            </Btn>
            <Btn
              variant="ink"
              style={{ background: "var(--cf-red)" }}
              disabled={regenerating}
              onClick={() => void confirmRegenerate()}
            >
              {regenerating ? "Génération…" : "Générer un nouveau code"}
            </Btn>
          </>
        }
      >
        {regenDevice && (
          <div className="flex flex-col gap-3">
            {regenDevice.paired ? (
              <>
                {/* Bloc rouge sans icône, comme les autres avertissements du
                    back-office : la couleur porte déjà le signal. */}
                <div className="rounded-ctrl border border-alert/40 bg-alert/10 px-3.5 py-3">
                  <p className="text-[13px] leading-relaxed text-alertt">
                    <span className="font-bold">
                      L&apos;appareil actuellement appairé sera révoqué.
                    </span>{" "}
                    «&nbsp;{regenDevice.name}&nbsp;» se déconnectera et
                    redemandera un code d&apos;appairage
                    {regenDevice.kind === "pos"
                      ? " — plus aucun encaissement ne sera possible dessus d'ici là."
                      : " — la cuisine ne verra plus les tickets d'ici là."}
                  </p>
                </div>
                <p className="text-[13px] leading-relaxed text-mut">
                  Ne le faites que pour{" "}
                  <span className="font-semibold text-ink">
                    une tablette perdue, volée ou remplacée
                  </span>
                  . Pour un appareil simplement figé, fermez et rouvrez
                  l&apos;application&nbsp;: elle repart avec son appairage.
                </p>
              </>
            ) : (
              <p className="text-[13px] leading-relaxed text-mut">
                Un nouveau code à six caractères remplacera le précédent,
                valable {PAIRING_TTL_LABEL}. L&apos;ancien code cessera de
                fonctionner — si vous l&apos;avez déjà tapé sur la tablette,
                laissez-le plutôt aboutir.
              </p>
            )}
          </div>
        )}
      </Modal>

      {/* ── Suppression ── */}
      <Modal
        open={deleteDevice !== null}
        onClose={() => setDeleteId(null)}
        title="Supprimer cet appareil"
        destructive
        width={460}
        footer={
          <>
            <Btn variant="ghost" onClick={() => setDeleteId(null)}>
              Annuler
            </Btn>
            <Btn
              variant="ink"
              style={{ background: "var(--cf-red)" }}
              disabled={deleting}
              onClick={() => void confirmDelete()}
            >
              {deleting ? "Suppression…" : "Supprimer l'appareil"}
            </Btn>
          </>
        }
      >
        {deleteDevice && (
          <p className="leading-relaxed">
            «&nbsp;{deleteDevice.name}&nbsp;» sera retiré définitivement.
            {deleteDevice.paired
              ? " La tablette se déconnectera dans la minute et redemandera un code d'appairage."
              : " Son code d'appairage cessera de fonctionner."}{" "}
            Vos commandes et votre carte ne sont pas touchées.
          </p>
        )}
      </Modal>
    </div>
  );
}
