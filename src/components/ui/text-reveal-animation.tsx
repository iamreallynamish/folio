import { useState, type CSSProperties, type ElementType } from "react";
import { cn } from "@/lib/utils";

/**
 * Text that rises into place one character at a time.
 * Adapted from the shared snippet: typed props, its styles moved into the app stylesheet
 * (`.text-reveal` in styles.css; Vite has no styled-jsx), screen-reader friendly (the whole text is
 * read once, the characters are hidden), and the replay button is optional.
 */
export function TextReveal({
  word,
  as: Tag = "h1",
  className,
  delay = 0,
  step = 0.02,
  replayable = false,
}: {
  word?: string;
  as?: ElementType;
  className?: string;
  /** Seconds before the first character moves. */
  delay?: number;
  /** Seconds between characters. */
  step?: number;
  /** Show a "Replay animation" button below (handy in demos). */
  replayable?: boolean;
}) {
  const [reset, setReset] = useState(0);
  const WORD = word || "Animations";
  const text = (
    <Tag key={reset} className={cn("text-reveal", className)} aria-label={WORD}>
      {WORD.split("").map((char, i) => (
        <span key={i} aria-hidden="true" style={{ "--index": i, "--delay": `${delay}s`, "--step": `${step}s` } as CSSProperties}>
          {char === " " ? " " : char}
        </span>
      ))}
    </Tag>
  );
  if (!replayable) return text;
  return (
    <div>
      {text}
      <button className="text-reveal-replay" onClick={() => setReset(reset + 1)}>Replay animation</button>
    </div>
  );
}
