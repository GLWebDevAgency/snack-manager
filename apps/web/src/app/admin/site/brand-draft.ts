import { BrandSchema, type Brand } from "@sm/contracts";
const PREFIX = "sm.admin.site.brand-draft.v1:";
const TTL = 8 * 60 * 60 * 1000;
export type BrandDraft = { base: Brand; draft: Brand; at: number };
export function parseBrandDraft(raw: string | null, now = Date.now()): BrandDraft | null {
  try {
    if (!raw) return null; const value = JSON.parse(raw);
    const base = BrandSchema.safeParse(value.base), draft = BrandSchema.safeParse(value.draft);
    return base.success && draft.success && Number.isFinite(value.at) && value.at <= now && now - value.at < TTL ? { base: base.data, draft: draft.data, at: value.at } : null;
  } catch { return null; }
}
export function readBrandDraft(id: string): BrandDraft | null { try { return parseBrandDraft(sessionStorage.getItem(PREFIX + id)); } catch { return null; } }
export function writeBrandDraft(id: string, base: Brand, draft: Brand): void { try { sessionStorage.setItem(PREFIX + id, JSON.stringify({ base, draft, at: Date.now() })); } catch {} }
export function clearBrandDraft(id: string): void { try { sessionStorage.removeItem(PREFIX + id); } catch {} }
