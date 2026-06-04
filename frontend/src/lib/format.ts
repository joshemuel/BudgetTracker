const IDR_INT = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const CURRENCY_SYMBOL: Record<string, string> = {
  IDR: "Rp",
  SGD: "S$",
  JPY: "JP¥",
  AUD: "A$",
  TWD: "NT$",
};

function compactKM(n: number): string | null {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(2)}M`;
  }
  if (abs >= 1_000) {
    return `${(n / 1_000).toFixed(2)}k`;
  }
  return null;
}

export function toNumber(v: string | number | null | undefined): number {
  if (v == null || v === "") return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : 0;
}

export function fmtIDR(v: string | number | null | undefined): string {
  return `Rp ${IDR_INT.format(Math.round(toNumber(v)))}`;
}

export function fmtMoney(
  v: string | number | null | undefined,
  currency: "IDR" | "SGD" | "JPY" | "AUD" | "TWD" = "IDR"
): string {
  const n = toNumber(v);
  const fixedDecimals = currency === "JPY" ? 0 : 2;
  const nf = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: fixedDecimals,
    maximumFractionDigits: fixedDecimals,
  });
  return `${CURRENCY_SYMBOL[currency] ?? currency} ${nf.format(n)}`;
}

export function fmtCompactMoney(
  v: string | number | null | undefined,
  currency: "IDR" | "SGD" | "JPY" | "AUD" | "TWD" = "IDR"
): string {
  const n = toNumber(v);
  const symbol = CURRENCY_SYMBOL[currency] ?? currency;
  const compact = compactKM(n);
  if (!compact) return fmtMoney(n, currency);
  return `${symbol} ${compact}`;
}

export function fmtShort(
  v: string | number | null | undefined,
  currency: "IDR" | "SGD" | "JPY" | "AUD" | "TWD" = "IDR"
): string {
  const n = toNumber(v);
  const symbol = CURRENCY_SYMBOL[currency] ?? currency;
  const compact = compactKM(n);
  if (compact) return `${symbol} ${compact}`;

  const fixedDecimals = currency === "JPY" ? 0 : 2;
  const nf = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: fixedDecimals,
    maximumFractionDigits: fixedDecimals,
  });
  return `${symbol} ${nf.format(n)}`;
}

export function fmtPct(v: number): string {
  return (v * 100).toFixed(0) + "%";
}

type CurrencyCode = "IDR" | "SGD" | "JPY" | "AUD" | "TWD";

function groupDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Strip grouping/symbols back to a plain numeric string for submission:
 * "1,234.50" -> "1234.50", "" -> "". Keeps a leading minus and a single
 * decimal point; drops a lone trailing dot.
 */
export function parseAmountInput(raw: string | number | null | undefined): string {
  if (raw == null) return "";
  const cleaned = String(raw).replace(/,/g, "").replace(/[^0-9.\-]/g, "");
  const neg = cleaned.startsWith("-");
  const unsigned = cleaned.replace(/-/g, "");
  const parts = unsigned.split(".");
  const intPart = parts[0] || "";
  const fracPart = parts.slice(1).join("");
  const body = fracPart ? `${intPart}.${fracPart}` : intPart;
  return `${neg ? "-" : ""}${body}`;
}

/**
 * Reformat an in-progress amount with thousands separators *while typing*.
 * Preserves a trailing "." and partial decimals so editing isn't disrupted;
 * JPY has no fractional part. Pairs with `handleAmountChange` for caret safety.
 */
export function formatAmountLive(raw: string, currency: CurrencyCode = "IDR"): string {
  let s = String(raw).replace(/[^0-9.\-]/g, "");
  const neg = s.startsWith("-");
  s = s.replace(/-/g, "");
  if (currency === "JPY") s = s.replace(/\./g, "");
  const firstDot = s.indexOf(".");
  let intPart: string;
  let frac: string | null;
  if (firstDot === -1) {
    intPart = s;
    frac = null;
  } else {
    intPart = s.slice(0, firstDot);
    frac = s.slice(firstDot + 1).replace(/\./g, ""); // collapse any extra dots
  }
  intPart = intPart.replace(/^0+(?=\d)/, ""); // trim leading zeros, keep a single 0
  const grouped = intPart === "" ? "" : groupDigits(intPart);
  const out = frac !== null ? `${grouped}.${frac}` : grouped;
  return `${neg ? "-" : ""}${out}`;
}

/**
 * `onChange` for grouped amount inputs: reformats live and restores the caret
 * to the same digit offset, so inserting a comma doesn't kick the cursor to
 * the end. Call with the input element, the active currency, and the setter.
 */
export function handleAmountChange(
  el: HTMLInputElement,
  currency: CurrencyCode,
  setValue: (v: string) => void
): void {
  const prev = el.value;
  const caret = el.selectionStart ?? prev.length;
  const digitsBefore = prev.slice(0, caret).replace(/[^0-9]/g, "").length;
  const next = formatAmountLive(prev, currency);
  setValue(next);
  requestAnimationFrame(() => {
    let pos = 0;
    let seen = 0;
    while (pos < next.length && seen < digitsBefore) {
      const code = next.charCodeAt(pos);
      if (code >= 48 && code <= 57) seen++;
      pos++;
    }
    try {
      el.setSelectionRange(pos, pos);
    } catch {
      /* element may be detached after a re-render */
    }
  });
}

const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monthName(m: number, short = false): string {
  const arr = short ? MONTHS_SHORT : MONTHS_LONG;
  return arr[Math.min(12, Math.max(1, m)) - 1] ?? "";
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) +
    " · " +
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  );
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
