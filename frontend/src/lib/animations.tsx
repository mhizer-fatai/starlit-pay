import { useReducedMotion } from "motion/react";
import { motion, type Variants } from "motion/react";

const prefersReducedMotion = typeof window !== "undefined" 
  ? window.matchMedia("(prefers-reduced-motion: reduce)").matches 
  : false;

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { 
    opacity: 1, 
    y: 0,
    transition: { duration: 0.45, ease: [0.25, 0.1, 0.25, 1] as [number, number, number, number] }
  },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { 
    opacity: 1,
    transition: { duration: 0.4, ease: "easeOut" as const }
  },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.97 },
  visible: { 
    opacity: 1, 
    scale: 1,
    transition: { duration: 0.45, ease: [0.25, 0.1, 0.25, 1] as [number, number, number, number] }
  },
};

export const staggerContainer: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.05,
    },
  },
};

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { 
    opacity: 1, 
    y: 0,
    transition: { duration: 0.4, ease: [0.25, 0.1, 0.25, 1] as [number, number, number, number] }
  },
};

export function useShouldAnimate() {
  const reducedMotion = useReducedMotion();
  return !reducedMotion && !prefersReducedMotion;
}
