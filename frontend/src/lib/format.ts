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
