/**
 * Artwork for the user's own cards, redrawn as vector art so it stays sharp and themable.
 * Bank names are set in type on top of the art (WalletCard), not reproduced logos.
 */
import { useId } from "react";

export const ART_THEMES = ["icici-student", "axis-privilege"] as const;
export const isArtTheme = (t: string) => (ART_THEMES as readonly string[]).includes(t);

/** EMV chip, drawn rather than imaged. */
export function Chip() {
  const id = useId();
  return (
    <svg className="emv" viewBox="0 0 36 27" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f7e7ae" /><stop offset="0.45" stopColor="#c9a24a" /><stop offset="0.7" stopColor="#f0d88a" /><stop offset="1" stopColor="#a8822f" />
        </linearGradient>
      </defs>
      <rect width="36" height="27" rx="5" fill={`url(#${id})`} />
      <path d="M0 9h11M0 18h11M25 9h11M25 18h11M11 0v27M25 0v27M11 13.5h14" stroke="rgba(92,62,12,.5)" strokeWidth=".8" fill="none" />
      <rect x="14" y="7" width="8" height="13" rx="2" fill="none" stroke="rgba(92,62,12,.45)" strokeWidth=".8" />
    </svg>
  );
}

/** ICICI Student Forex: maroon sky, an orange planet rising, study icons along its horizon. */
function IciciStudent() {
  const id = useId();
  return (
    <svg className="pc-art" viewBox="0 0 400 252" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <radialGradient id={`${id}sky`} cx="12%" cy="-10%" r="130%">
          <stop offset="0" stopColor="#2a0709" /><stop offset="0.45" stopColor="#5e1214" /><stop offset="0.8" stopColor="#8f1d16" /><stop offset="1" stopColor="#b33016" />
        </radialGradient>
        <radialGradient id={`${id}planet`} cx="50%" cy="8%" r="75%">
          <stop offset="0" stopColor="#f2741f" /><stop offset="0.25" stopColor="#d65316" /><stop offset="0.7" stopColor="#a83410" /><stop offset="1" stopColor="#6e1c0b" />
        </radialGradient>
        <filter id={`${id}glow`} x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6" /></filter>
      </defs>
      <rect width="400" height="252" fill={`url(#${id}sky)`} />
      <ellipse cx="300" cy="458" rx="388" ry="278" fill="#ff9a4a" opacity=".55" filter={`url(#${id}glow)`} />
      <ellipse cx="300" cy="458" rx="380" ry="270" fill={`url(#${id}planet)`} />
      <ellipse cx="300" cy="458" rx="380" ry="270" fill="none" stroke="#ffc58a" strokeWidth="1.4" opacity=".75" />
      <g fill="none" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" opacity=".82">
        {/* books */}
        <g transform="translate(250 190.3) scale(.8) translate(-213.5 -202)"><rect x="203" y="194" width="21" height="8" rx="1" /><rect x="206" y="186" width="18" height="8" rx="1" /><rect x="203" y="178" width="20" height="8" rx="1" /></g>
        {/* student */}
        <g transform="translate(274 188.6) scale(.8) translate(-241 -202)"><circle cx="241" cy="172" r="5.5" /><path d="M230 202q11-26 22 0" /><path d="M234 191h14" /></g>
        {/* globe */}
        <g transform="translate(300 188) scale(.8) translate(-271 -203.5)"><circle cx="271" cy="180" r="12.5" /><ellipse cx="271" cy="180" rx="5.5" ry="12.5" /><path d="M258.5 180h25M271 192.5v6M262 203.5h18M256 175a16 16 0 0 0 30 12" /></g>
        {/* graduation cap */}
        <g transform="translate(327 188.7) scale(.8) translate(-301 -197)"><path d="M285 186l16-7 16 7-16 7z" /><path d="M291 189v8q10 6 20 0v-8" /><path d="M317 186v9" /></g>
        {/* school */}
        <g transform="translate(352 190.5) scale(.8) translate(-335 -213)"><path d="M322 213v-19h26v19M319 194l16-12 16 12M332 213v-9h6v9M335 182v-10l8 3-8 3" /></g>
        {/* open book */}
        <g transform="translate(378 193.7) scale(.8) translate(-365 -222)"><path d="M352 214q6.5-4 13 0 6.5-4 13 0v8q-6.5-4-13 0-6.5-4-13 0z" /><path d="M365 214v8" /></g>
      </g>
    </svg>
  );
}

/** Axis Privilege: black card, a stepped magenta pyramid lit from the left. */
function AxisPrivilege() {
  const id = useId();
  return (
    <svg className="pc-art" viewBox="0 0 400 252" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}bg`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#1a1a1d" /><stop offset="1" stopColor="#040405" /></linearGradient>
        <linearGradient id={`${id}lit`} x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stopColor="#e2347f" /><stop offset="0.55" stopColor="#b8155e" /><stop offset="1" stopColor="#7d0c3f" /></linearGradient>
        <linearGradient id={`${id}shade`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#6a0c35" /><stop offset="1" stopColor="#2b0416" /></linearGradient>
        <pattern id={`${id}steps`} width="400" height="6.5" patternUnits="userSpaceOnUse"><path d="M0 6h400" stroke="rgba(0,0,0,.32)" strokeWidth="1" /></pattern>
        <pattern id={`${id}steps2`} width="400" height="6.5" patternUnits="userSpaceOnUse"><path d="M0 6h400" stroke="rgba(255,255,255,.07)" strokeWidth="1" /></pattern>
      </defs>
      <rect width="400" height="252" fill={`url(#${id}bg)`} />
      <polygon points="296,26 138,252 322,252" fill={`url(#${id}lit)`} />
      <polygon points="296,26 138,252 322,252" fill={`url(#${id}steps)`} />
      <polygon points="296,26 322,252 440,252" fill={`url(#${id}shade)`} />
      <polygon points="296,26 322,252 440,252" fill={`url(#${id}steps2)`} />
      <path d="M296 26L322 252" stroke="rgba(255,190,220,.35)" strokeWidth="1" />
    </svg>
  );
}

export function CardArt({ theme }: { theme: string }) {
  if (theme === "icici-student") return <IciciStudent />;
  if (theme === "axis-privilege") return <AxisPrivilege />;
  return null;
}
