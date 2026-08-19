"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, setToken } from "@/lib/api";
import { Btn, Card, Field, Input } from "@/components/ui";

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
          <div className="mb-2 flex items-center gap-3">
            <div
              // Tuile de niveau « élément » posée sur la carte, comme partout
              // ailleurs : un aplat noir creuserait un trou dans la carte au
              // lieu de l'élever (DA §1).
              className="grid size-11 place-items-center rounded-card border border-white/8 bg-[image:var(--cf-elev-gradient)] text-lg font-extrabold text-gold"
              aria-hidden
            >
              S
            </div>
            <div>
              <h1 className="text-lg font-extrabold leading-tight tracking-[-0.03em] text-ink">
                Back-office
              </h1>
              <p className="text-sm text-mut">Snack Manager</p>
            </div>
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
