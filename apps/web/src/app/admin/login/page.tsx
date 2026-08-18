"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, setToken } from "@/lib/api";

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
      router.replace("/admin/menu");
    } catch {
      setError("Identifiants invalides");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-panel border border-line bg-surface p-8"
      >
        <div className="mb-6 flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-xl bg-black text-lg font-black text-accent ring-1 ring-line">
            S
          </div>
          <div>
            <h1 className="text-lg font-extrabold leading-tight">Back-office</h1>
            <p className="text-sm text-ink2">Snack Manager</p>
          </div>
        </div>

        <label className="mb-1.5 block text-sm font-semibold text-ink2">
          E-mail
        </label>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mb-4 w-full rounded-ctrl border border-line bg-surface2 px-3.5 py-2.5 text-sm outline-none transition focus:border-accent"
        />

        <label className="mb-1.5 block text-sm font-semibold text-ink2">
          Mot de passe
        </label>
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-5 w-full rounded-ctrl border border-line bg-surface2 px-3.5 py-2.5 text-sm outline-none transition focus:border-accent"
        />

        {error && (
          <p className="mb-4 rounded-ctrl border border-alert/40 bg-alert/10 px-3 py-2 text-sm text-alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-ctrl bg-accent py-2.5 font-bold text-onaccent transition hover:bg-accenthover disabled:opacity-60"
        >
          {loading ? "Connexion…" : "Se connecter"}
        </button>
      </form>
    </main>
  );
}
