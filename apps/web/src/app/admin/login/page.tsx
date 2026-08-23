"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, setToken } from "@/lib/api";
import { Btn, Card, Field, Input } from "@/components/ui";
import { LogoMark } from "@/components/brand/Logo";
import { armerSplashDeTransition } from "@/components/brand/SplashAuPremierPassage";

export default function LoginPage() {
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
      const { token } = await api.post<{ token: string }>("/auth/login", {
        email,
        password,
      });
      setToken(token);
      /*
       * ON ARME L'OUVERTURE AVANT DE NAVIGUER, pas après.
       *
       * Cette page disparaît au `replace` : un calque monté ici partirait avec
       * elle, précisément pendant la seconde qu'il est censé couvrir. Le
       * drapeau traverse la navigation, et c'est la coque `/admin` qui le
       * consomme — voir `SplashAuPremierPassage`.
       */
      armerSplashDeTransition();
      router.replace("/admin/dashboard");
    } catch {
      setError("Identifiants invalides");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-bg px-4">
      <Card className="w-full max-w-sm shadow-deep">
        <form onSubmit={submit} className="flex flex-col gap-4 p-8">
          {/*
            ═══ LE TITRE PORTE LA SURFACE, PAS NOTRE MARQUE ═══

            Le verrouillage Snack Manager tenait ici, en `<h1>`. La charte §10
            dit l'inverse, et sa raison est commerciale avant d'être
            esthétique : « le restaurateur vend son enseigne, pas la nôtre ».

            Dans l'application d'un client, notre mark « n'apparaît QU'UNE
            FOIS, en pied d'écran de connexion, à 60 % d'opacité, avec la
            mention "Propulsé par Snack Manager" ». En tête et à pleine encre,
            il faisait de notre nom le titre du back-office d'un restaurant.

            Le titre redevient donc ce que le gérant vient chercher — la porte
            de SON back-office. Notre signature descend en pied de carte.
          */}
          <div className="mb-2 flex flex-col gap-1.5 text-ink">
            <h1 className="text-[22px] font-extrabold leading-none tracking-[-0.03em]">
              Back-office
            </h1>
            <p className="text-sm text-mut">
              Connectez-vous pour gérer votre restaurant.
            </p>
          </div>

          <Field label="E-mail" htmlFor="login-email">
            <Input
              id="login-email"
              type="email"
              required
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>

          <Field label="Mot de passe" htmlFor="login-password">
            <Input
              id="login-password"
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
            {loading ? "Connexion…" : "Se connecter"}
          </Btn>

          {/*
            LA SIGNATURE D'ÉDITEUR — et c'est le SEUL endroit de /admin où
            notre marque paraît. Charte §10 : en pied d'écran de connexion, à
            60 % d'opacité, avec la mention. L'opacité n'est pas une coquetterie :
            elle dit que cette ligne n'est pas au même plan que ce qui la
            précède. Le signe suit `currentColor`, donc le gris de la mention.
          */}
          <p className="mt-2 flex items-center justify-center gap-1.5 text-[11px] font-medium text-mut opacity-60">
            <LogoMark size={14} className="shrink-0" />
            Propulsé par Snack&nbsp;Manager
          </p>
        </form>
      </Card>
    </main>
  );
}
