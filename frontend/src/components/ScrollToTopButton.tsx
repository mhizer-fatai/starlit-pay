import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { ArrowUp } from "lucide-react";

export function ScrollToTopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function onScroll() {
      setVisible(window.scrollY > 400);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function handleClick() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <motion.button
      type="button"
      className="scroll-to-top-btn"
      initial={false}
      animate={{ opacity: visible ? 1 : 0, pointerEvents: visible ? "auto" : "none" }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      onClick={handleClick}
      aria-label="Scroll to top"
    >
      <ArrowUp className="size-5" />
    </motion.button>
  );
}
