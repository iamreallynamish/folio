import { useId } from "react";

/**
 * Folio mark: a four-point spark whose upper ray is the longest (growth), folded down the middle
 * like a leaf of paper (folio), with a coin rising at its shoulder (money).
 */
export function LogoMark({ size = 28, mono = false }: { size?: number; mono?: boolean }) {
  const id = useId();
  const fill = mono ? "currentColor" : `url(#${id})`;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="Folio">
      <defs>
        <linearGradient id={id} x1="0.1" y1="1" x2="0.9" y2="0">
          <stop offset="0" stopColor="#19c37d" /><stop offset="0.5" stopColor="#20b7c9" /><stop offset="1" stopColor="#6c7bff" />
        </linearGradient>
      </defs>
      <path d="M46 6Q51 51 90 56Q51 61 46 96Q41 61 8 56Q41 51 46 6Z" fill={fill} />
      <path d="M46 6Q51 51 90 56Q51 61 46 96Z" fill="#fff" fillOpacity={mono ? 0.28 : 0.2} />
      <circle cx="79" cy="19" r="8" fill={fill} />
    </svg>
  );
}

export function AppIcon({ size = 76 }: { size?: number }) {
  return (
    <div className="app-icon" style={{ width: size, height: size, background: "linear-gradient(135deg,#16181d,#06070a)", display: "grid", placeItems: "center" }}>
      <LogoMark size={size * 0.62} />
    </div>
  );
}
