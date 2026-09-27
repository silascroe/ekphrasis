export function normalizeText(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.toLowerCase().normalize("NFKD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, " ").trim() || null;
}

function stripLeadingArticle(value: string): string {
  return value.replace(/^the /, "");
}

function containsWholePhrase(longer: string, shorter: string): boolean {
  if (shorter.length < 8) return false;
  return longer === shorter ||
    longer.startsWith(shorter + " ") ||
    longer.endsWith(" " + shorter) ||
    longer.includes(" " + shorter + " ");
}

export function equivalentText(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeText(a);
  const right = normalizeText(b);
  if (!left || !right) return false;

  const l = stripLeadingArticle(left);
  const r = stripLeadingArticle(right);
  if (l === r) return true;

  const [shorter, longer] = l.length <= r.length ? [l, r] : [r, l];
  return containsWholePhrase(longer, shorter);
}

export function equivalentDate(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const left = a.match(/\b\d{4}\b/)?.[0];
  const right = b.match(/\b\d{4}\b/)?.[0];
  return Boolean(left && right && left === right);
}
