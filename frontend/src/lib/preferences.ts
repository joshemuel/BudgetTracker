import type { Me } from "@/types";

export function preferredCurrency(me: Me | undefined): Me["default_currency"] {
  return me?.default_currency ?? "IDR";
}

export function withCurrency(path: string, currency: Me["default_currency"]): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}currency=${currency}`;
}
