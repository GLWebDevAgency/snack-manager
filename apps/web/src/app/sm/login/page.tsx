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
import { LogoLockup } from "@/components/brand/Logo";
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
      {/*
        La carte passe de `max-w-sm` à `max-w-md` (448 px) : le verrouillage
        posé à 52 px mesure ~295 px, et les 320 px utiles d'une carte `sm` ne
        lui laissaient qu'une marge de 8 % — le nom est en `white-space: nowrap`,
        une police de repli un peu plus large suffisait à le faire déborder.
        448 px reste très en deçà des 760 px du halo qui la porte.
      */}
      <Card className="relative w-full max-w-md shadow-deep">
        <form onSubmit={submit} className="flex flex-col gap-4 p-8">
          {/*
            L'ENTRÉE DE NOTRE PROPRE MAISON — donc le signe en entier.

            Aucun client de restaurant ne verra jamais cet écran : le
            verrouillage complet (mark + nom) est ici légitime, et il porte à
            lui seul l'identité — d'où la disparition du sous-titre
            « Snack Manager · HQ », qui répétait ce que le nom dit déjà.

            52 px : le seuil exact à partir duquel `tone="duo"` est admis. La
            garniture au laiton se lit enfin à cette échelle, et c'est le seul
            endroit du CRM où le signe a la place de se montrer entièrement.
            En dessous elle virerait à la tache brune sur le fond sombre.

            Le titre reste en 18 px SOUS le signe : la marque domine, le nom de
            la porte suit. L'éclair est un vide — le fond de la carte est un
            aplat (voile blanc à 4 %, invariant sur 52 px), il tient.
          */}
          <div className="mb-2 flex flex-col items-center gap-5 text-center">
            <LogoLockup size={52} tone="duo" />
            <h1 className="text-lg font-extrabold leading-tight tracking-[-0.03em] text-ink">
              Back-office interne · HQ
            </h1>
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
