"use client";

/**
 * Connexion au back-office INTERNE (HQ).
 *
 * Entrée dédiée plutôt que réutilisation de `/admin/login` : les deux surfaces
 * partagent le même endpoint (`POST /auth/login`) et le même jeton, mais pas la
 * même destination — un gérant qui atterrit sur notre CRM verrait notre
 * pipeline commercial, nos marges et nos autres clients.
 *
 * Le rôle est donc vérifié ICI, à la seconde où l'API répond : un compte
 * gérant ne se voit jamais poser de session sur cette entrée. La garde qui
 * protège réellement les données reste `@Roles('sm_admin')` côté API.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, clearToken, setToken } from "@/lib/api";
import { Btn, Card, Field, Icon, Input } from "@/components/ui";
import { HQ_ROLE } from "../crm";

type LoginResponse = {
  token: string;
  user: { email: string; name: string; role: string; tenantId: string | null };
};

export default function HqLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await api.post<LoginResponse>("/auth/login", { email, password });
      if (res.user?.role !== HQ_ROLE) {
        // Identifiants valides, mais pas pour cette porte. On ne conserve
        // aucune session : le gérant repart vers SON back-office.
        clearToken();
        setError(
          "Ce compte est un compte restaurant. Le back-office du restaurant se trouve sur /admin.",
        );
        return;
      }
      setToken(res.token);
      router.replace("/sm");
    } catch {
      setError("Identifiants invalides");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-bg px-4">
      {/*
        Halo laiton très large derrière la carte : la seule licence décorative
        de la surface, posée sur le noir plutôt que sur un élément (DA §1).
      */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(760px 420px at 50% -8%, rgba(201,161,90,.13), transparent 62%)",
        }}
      />
      <Card className="relative w-full max-w-sm shadow-deep">
        <form onSubmit={submit} className="flex flex-col gap-4 p-8">
          <div className="mb-2 flex items-center gap-3">
            <div
              className="grid size-11 place-items-center rounded-card border border-white/8 bg-[image:var(--cf-elev-gradient)] text-lg font-extrabold text-gold"
              aria-hidden
            >
              S
            </div>
            <div>
              <h1 className="text-lg font-extrabold leading-tight tracking-[-0.03em] text-ink">
                Back-office interne
              </h1>
              <p className="text-sm text-mut">Snack Manager · HQ</p>
            </div>
          </div>

          <Field label="E-mail" htmlFor="hq-email">
            <Input
              id="hq-email"
              type="email"
              required
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>

          <Field label="Mot de passe" htmlFor="hq-password">
            <Input
              id="hq-password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>

          {error && (
            <p
              role="alert"
              className="rounded-ctrl border border-alert/40 bg-alert/10 px-3 py-2 text-sm text-alertt"
            >
              {error}
            </p>
          )}

          <Btn type="submit" variant="primary" block disabled={loading}>
            {loading ? "Connexion…" : "Entrer"}
          </Btn>

          <p className="flex items-center justify-center gap-1.5 text-xs text-mut">
            <Icon name="user" size={13} />
            Réservé à l&apos;équipe Snack Manager
          </p>
        </form>
      </Card>
    </main>
  );
}
