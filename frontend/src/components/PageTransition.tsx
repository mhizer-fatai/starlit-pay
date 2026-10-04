import { type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { motion, type Variants } from "motion/react";

const pageVariants: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { 
    opacity: 1, 
    y: 0,
    transition: { duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }
  },
  exit: { 
    opacity: 0, 
    y: -4,
    transition: { duration: 0.2, ease: "easeIn" }
  },
};

export function PageTransition({ children }: { children: ReactNode }) {
  const location = useLocation();
  
  return (
    <motion.div
      key={location.pathname}
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      {children}
    </motion.div>
  );
}
