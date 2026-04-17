const IDR = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

const COMPACT = new Intl.NumberFormat("id-ID", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function toNumber(v: string | number | null | undefined): number {
  if (v == null || v === "") return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : 0;
}

export function fmtIDR(v: string | number | null | undefined): string {
  return IDR.format(toNumber(v));
}

export function fmtShort(v: string | number | null | undefined): string {
  const n = toNumber(v);
  return "Rp " + COMPACT.format(n);
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
