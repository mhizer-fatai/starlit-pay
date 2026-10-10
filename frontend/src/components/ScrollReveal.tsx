import { type ReactNode, useRef } from "react";
import { motion, useInView, type Variants } from "motion/react";

type ScrollRevealProps = {
  children: ReactNode;
  variants?: Variants;
  className?: string;
  once?: boolean;
  amount?: number;
};

const defaultVariants: Variants = {
  hidden: { opacity: 0, y: 18 },
  visible: { 
    opacity: 1, 
    y: 0,
    transition: { duration: 0.5, ease: [0.25, 0.1, 0.25, 1] as [number, number, number, number] }
  },
};

export function ScrollReveal({
  children,
  variants = defaultVariants,
  className,
  once = true,
  amount = 0.15,
}: ScrollRevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once, amount });
  
  return (
    <motion.div
      ref={ref}
      className={className}
      initial="hidden"
      animate={inView ? "visible" : "hidden"}
      variants={variants}
    >
      {children}
    </motion.div>
  );
}
