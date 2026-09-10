const PREFIX = "sm.admin.site.name-draft.v1:";
export type NameDraft = { base: string; draft: string; at: number };
export function parseNameDraft(raw: string | null, now = Date.now()): NameDraft | null {
  try {
    const value = JSON.parse(raw ?? "null") as NameDraft | null;
    return value && typeof value.base === "string" && typeof value.draft === "string" && value.base.length <= 120 && value.draft.length <= 120
      && Number.isFinite(value.at) && value.at <= now && now - value.at < 8 * 60 * 60 * 1000 ? value : null;
  } catch { return null; }
}
export function readNameDraft(id: string): NameDraft | null { try { return parseNameDraft(sessionStorage.getItem(PREFIX + id)); } catch { return null; } }
export function writeNameDraft(id: string, base: string, draft: string): void { try { sessionStorage.setItem(PREFIX + id, JSON.stringify({ base, draft, at: Date.now() })); } catch {} }
export function clearNameDraft(id: string): void { try { sessionStorage.removeItem(PREFIX + id); } catch {} }
