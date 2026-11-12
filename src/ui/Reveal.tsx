import { useReducedMotion } from "framer-motion";
import { useState } from "react";
import { TextEffect } from "@/components/ui/text-effect";

/**
 * Words resolve out of a soft blur (TextEffect "blur" preset). With `once`, it plays the first time
 * in a visit only — motion on frequently seen screens should be rare. Plain text under Reduce Motion.
 */
export function Reveal({ text, as = "span", className, delay = 0, once }: { text: string; as?: "span" | "h1" | "p"; className?: string; delay?: number; once?: string }) {
  const reduce = useReducedMotion();
  const [play] = useState(() => {
    if (!once) return true;
    try {
      const k = `folio-reveal-${once}`;
      if (sessionStorage.getItem(k)) return false;
      sessionStorage.setItem(k, "1");
    } catch { /* storage unavailable: just play */ }
    return true;
  });
  if (reduce || !play) { const Tag = as; return <Tag className={className}>{text}</Tag>; }
  return <TextEffect per="word" as={as} preset="blur" delay={delay} className={className}>{text}</TextEffect>;
}
