import type { ReactNode } from "react";

export function Figure({
  label,
  value,
  sub,
  tone = "ink",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "ink" | "accent" | "gain" | "warn";
}) {
  const color =
    tone === "accent"
      ? "text-accent"
      : tone === "gain"
      ? "text-gain"
      : tone === "warn"
      ? "text-warn"
      : "text-ink";
  return (
    <div className="py-4">
      <p className="smallcaps text-ink-mute">{label}</p>
      <p className={`num ${color} mt-2 text-xl sm:text-2xl md:text-4xl`}>{value}</p>
      {sub && <p className="mt-1 text-xs sm:text-sm text-ink-soft">{sub}</p>}
    </div>
  );
}

export function SectionTitle({ children, kicker }: { children: ReactNode; kicker?: ReactNode }) {
  return (
    <div className="mb-4">
      {kicker && <p className="smallcaps text-ink-mute">{kicker}</p>}
      <h2 className="display text-2xl sm:text-3xl md:text-4xl text-ink">{children}</h2>
      <div className="mt-3 h-[1px] bg-ink w-10" />
    </div>
  );
}

export function Pullquote({ children }: { children: ReactNode }) {
  return (
    <blockquote className="display-italic text-lg sm:text-2xl md:text-3xl text-ink-soft leading-snug border-l-2 border-accent pl-4">
      {children}
    </blockquote>
  );
}
