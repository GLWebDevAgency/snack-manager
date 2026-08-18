"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { clearToken, getToken } from "@/lib/api";

const NAV = [
  { href: "/admin/menu", label: "Menu & prix", icon: "▤" },
  { href: "/admin/commandes", label: "Commandes", icon: "◷" },
  { href: "/admin/horaires", label: "Horaires", icon: "◔" },
  { href: "/admin/equipe", label: "Équipe", icon: "◉" },
];

export default function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  const isLogin = pathname === "/admin/login";

  useEffect(() => {
    if (!isLogin && !getToken()) {
      router.replace("/admin/login");
      return;
    }
    setReady(true);
  }, [isLogin, router]);

  if (isLogin) return <>{children}</>;
  if (!ready) return null;

  return (
    <div className="flex min-h-screen">
      {/* Sidebar rail — version compacte v1 ; l'overlay rétractable 66→232px
          de la maquette (docs/specs/backoffice-restaurant.md §Shell) suivra. */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-surface">
        <div className="flex items-center gap-2.5 px-4 py-5">
          <div className="grid size-9 place-items-center rounded-xl bg-black font-black text-accent ring-1 ring-line">
            S
          </div>
          <div>
            <div className="text-sm font-extrabold leading-tight">CLASS&apos;FOOD</div>
            <div className="text-xs text-ink2">Back-office</div>
          </div>
        </div>
        <nav className="flex flex-col gap-1 px-2">
          {NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-ctrl px-3 py-2.5 text-sm font-semibold transition ${
                  active
                    ? "bg-accent text-onaccent"
                    : "text-ink2 hover:bg-surface2 hover:text-ink"
                }`}
              >
                <span aria-hidden>{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <button
          onClick={() => {
            clearToken();
            router.replace("/admin/login");
          }}
          className="mx-2 mb-4 mt-auto rounded-ctrl px-3 py-2.5 text-left text-sm font-semibold text-ink2 transition hover:bg-surface2 hover:text-ink"
        >
          ⏻ Se déconnecter
        </button>
      </aside>
      <main className="min-w-0 flex-1 bg-bg">{children}</main>
    </div>
  );
}
