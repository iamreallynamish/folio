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

/** An answer written in quickly, word by word (fast enough that long answers stay readable). */
export function TypeIn({ text }: { text: string }) {
  const reduce = useReducedMotion();
  if (reduce) return <div className="text">{text}</div>;
  return (
    <TextEffect per="word" as="div" className="text" variants={{
      container: { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: Math.min(0.03, 1.2 / Math.max(1, text.split(/\s+/).length)) } } },
      item: { hidden: { opacity: 0, y: 4, filter: "blur(4px)" }, visible: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.25 } } },
    }}>{text}</TextEffect>
  );
}
