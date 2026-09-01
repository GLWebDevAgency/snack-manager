import { ClientsView } from "./ClientsView";

export default async function LoyaltyClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ member?: string | string[] }>;
}) {
  const raw = (await searchParams).member;
  const member = typeof raw === "string" && /^[0-9a-f-]{36}$/i.test(raw) ? raw : null;
  return <ClientsView initialMemberId={member} />;
}
