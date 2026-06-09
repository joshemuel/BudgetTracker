// Leo the lion, drawn in the app's stroke-icon idiom (currentColor lines,
// round caps, accent details via CSS var). Four poses cover the tour's moods.

export type LionPose = "wave" | "point" | "cheer" | "listen";

// Scalloped mane: quadratic bumps around a circle. Deterministic, computed once.
function scallopPath(cx: number, cy: number, r: number, bumps: number, k = 1.28): string {
  const pt = (i: number) => {
    const a = (i / bumps) * Math.PI * 2 - Math.PI / 2;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
  };
  const [x0, y0] = pt(0);
  let d = `M ${x0.toFixed(2)} ${y0.toFixed(2)}`;
  for (let i = 0; i < bumps; i++) {
    const [nx, ny] = pt(i + 1);
    const a = ((i + 0.5) / bumps) * Math.PI * 2 - Math.PI / 2;
    const cxp = cx + r * k * Math.cos(a);
    const cyp = cy + r * k * Math.sin(a);
    d += ` Q ${cxp.toFixed(2)} ${cyp.toFixed(2)} ${nx.toFixed(2)} ${ny.toFixed(2)}`;
  }
  return d + " Z";
}

const MANE = scallopPath(32, 26, 16, 11);

export default function Lion({
  pose = "point",
  size = 64,
  className,
}: {
  pose?: LionPose;
  size?: number;
  className?: string;
}) {
  const accent = "var(--color-accent)";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* mane + face */}
      <path d={MANE} />
      <circle cx="32" cy="26" r="10.5" />
      {/* ears */}
      <circle cx="24.6" cy="18.4" r="2.7" />
      <circle cx="39.4" cy="18.4" r="2.7" />
      {/* eyes (filled dots, like the masthead chart point) */}
      <circle cx="28.2" cy="24.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="35.8" cy="24.5" r="1.1" fill="currentColor" stroke="none" />
      {/* nose + muzzle */}
      <path d="M 30.6 28.2 h 2.8 l -1.4 1.9 Z" stroke={accent} />
      <path d="M 32 30.1 v 1.2" />
      <path d="M 32 31.3 c -1 1.6 -2.9 1.6 -3.7 0.4" />
      <path d="M 32 31.3 c 1 1.6 2.9 1.6 3.7 0.4" />
      {/* whiskers */}
      <path d="M 24.2 27.8 L 20.6 27.2" />
      <path d="M 24.4 30 L 21 30.6" />
      <path d="M 39.8 27.8 L 43.4 27.2" />
      <path d="M 39.6 30 L 43 30.6" />
      {/* chest under the mane (shared by all poses) */}
      <path d="M 26 45.5 c 0 4 2.6 6.8 6 6.8 s 6 -2.8 6 -6.8" />

      {pose === "point" && (
        <>
          <path d="M 38 48 C 44 47 49 44.5 52.5 41.5" />
          <circle cx="54" cy="40.6" r="2" />
        </>
      )}
      {pose === "wave" && (
        <>
          <path d="M 40 46 C 46.5 43.5 49.5 37 49.5 31.5" />
          <circle cx="49.5" cy="29.3" r="2.1" />
          <path d="M 54 25.5 l 2.6 -1.6" stroke={accent} />
          <path d="M 55 30.5 l 3 -0.2" stroke={accent} />
        </>
      )}
      {pose === "cheer" && (
        <>
          <path d="M 26 45.5 C 20 42 17.8 36 18.8 30.5" />
          <circle cx="18.6" cy="28.4" r="2.1" />
          <path d="M 38 45.5 C 44 42 46.2 36 45.2 30.5" />
          <circle cx="45.4" cy="28.4" r="2.1" />
          <path d="M 21.5 9 l 2 -2.8" stroke={accent} />
          <path d="M 32 5.5 v -3.2" stroke={accent} />
          <path d="M 42.5 9 l -2 -2.8" stroke={accent} />
        </>
      )}
      {pose === "listen" && (
        <>
          <path d="M 41 46.5 C 47 43.5 48.2 36 45.2 30.5" />
          <circle cx="44.6" cy="28.5" r="2.1" />
          <path d="M 50.5 21 a 7 7 0 0 0 -1.5 -8.5" />
          <path d="M 54.5 23 a 11.5 11.5 0 0 0 -2.5 -13.5" />
        </>
      )}
    </svg>
  );
}
