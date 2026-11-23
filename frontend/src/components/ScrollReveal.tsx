import { type ReactNode, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion, type Variants } from "motion/react";

type ScrollRevealProps = {
  children: ReactNode;
  variants?: Variants;
  className?: string;
  /** Animate only the first time it appears (default: every time, both ways). */
  once?: boolean;
  amount?: number;
};

const SHIFT = 28;
const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number];

// "from" is the side the section sits on while out of view: it slides up into
// place when you scroll down to it, and down into place when you scroll back up.
const defaultVariants: Variants = {
  hidden: (from: "above" | "below") => ({ opacity: 0, y: from === "above" ? -SHIFT : SHIFT, scale: 0.98 }),
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.6, ease: EASE } },
};

const stillVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.3 } },
};

export function ScrollReveal({ children, variants, className, once = false, amount = 0.15 }: ScrollRevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const [inView, setInView] = useState(false);
  const [from, setFrom] = useState<"above" | "below">("below");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          if (once) observer.disconnect();
        } else {
          setInView(false);
          // Left through the top: it is above us now, so it comes back from above.
          setFrom(entry.boundingClientRect.top < 0 ? "above" : "below");
        }
      },
      { threshold: amount }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [once, amount]);

  return (
    <motion.div
      ref={ref}
      className={className}
      custom={from}
      initial="hidden"
      animate={inView ? "visible" : "hidden"}
      variants={variants ?? (reduceMotion ? stillVariants : defaultVariants)}
    >
      {children}
    </motion.div>
  );
}
