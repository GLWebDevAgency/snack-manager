/** Concatène des classes conditionnelles (falsy ignorés). */
export const cx = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(" ");
