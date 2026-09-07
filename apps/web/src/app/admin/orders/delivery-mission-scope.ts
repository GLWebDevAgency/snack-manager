/** Storage partition only; the authenticated API remains the authority. No JWT is persisted. */
export function managerMissionScope(token: string | null, tenantId: string): string {
  try {
    if (!token || !/^[a-f0-9]{24}$/.test(tenantId)) throw new Error();
    const encoded = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=")));
    if (!claims || claims.tenantId !== tenantId || !["user", "staff"].includes(claims.kind) || !/^[a-f0-9]{24}$/.test(claims.sub)) throw new Error();
    return `bo:${tenantId}:${claims.kind}:${claims.sub}`;
  } catch { throw new Error("L’identité de cette session doit être vérifiée avant une action de livraison."); }
}
