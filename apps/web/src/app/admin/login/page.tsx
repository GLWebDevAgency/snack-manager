"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, setToken } from "@/lib/api";
import { Btn, Card, Field, Input } from "@/components/ui";
import { LogoLockup } from "@/components/brand/Logo";

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
            ═══ LA SEULE SURFACE PUREMENT SNACK MANAGER DE /admin ═══

            Avant la connexion, aucun tenant n'est connu : le layout ne peut
            pas appeler /tenants/me sans jeton, donc `--cf-accent` porte encore
            le laiton par défaut et non la couleur du restaurant. À cet instant
            précis, l'écran n'appartient à personne d'autre qu'au logiciel —
            c'est LUI qui se présente, exactement comme un écran d'appairage.
            D'où le verrouillage complet plutôt que le signe seul : le nom
            doit être lu, pas deviné.

            Le verrouillage remplace la tuile « S » générique, qui ne disait
            rien et occupait la place de la marque. Il porte le `<h1>` : le
            titre accessible de la page devient « Snack Manager », ce qui est
            juste, et « Back-office » redevient ce qu'il est — la surface, pas
            le produit.

            L'encre suit `text-ink` posé sur le conteneur (le signe lit
            `currentColor`) ; le laiton bichrome est écarté, il ne se lit
            qu'à partir de 52 px. Le fond est celui de la carte : un voile
            blanc à 5 % qui s'éteint, assez uni pour que l'éclair — qui est un
            VIDE — se découpe proprement.
          */}
          <div className="mb-2 flex flex-col gap-1.5 text-ink">
            <h1 className="flex leading-none">
              <LogoLockup size={31} />
            </h1>
            <p className="text-sm text-mut">Back-office</p>
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
        </form>
      </Card>
    </main>
  );
}
