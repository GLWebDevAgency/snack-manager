import Link from "next/link";

export default function Home() {
  return (
    <main className="grid min-h-screen place-items-center">
      <div className="text-center">
        <div className="mx-auto mb-6 grid size-14 place-items-center rounded-2xl bg-black text-2xl font-black text-accent ring-1 ring-line">
          S
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight">Snack Manager</h1>
        <p className="mt-2 text-ink2">Site vitrine en construction — le back-office est prêt.</p>
        <Link
          href="/admin"
          className="mt-6 inline-block rounded-ctrl bg-accent px-5 py-2.5 font-bold text-onaccent transition hover:bg-accenthover"
        >
          Accéder au back-office
        </Link>
      </div>
    </main>
  );
}
