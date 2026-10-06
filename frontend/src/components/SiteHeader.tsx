import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Link, useLocation } from "react-router-dom";

import { Button } from "@/components/ui/button";

const activeClass =
  "rounded bg-primary px-6 py-2 text-primary-foreground transition-colors duration-200 hover:bg-primary/90";
const idleClass = "rounded px-6 py-2 transition-colors duration-200 hover:bg-white/50";

export function SiteHeader() {
  const { pathname } = useLocation();
  const onHome = pathname === "/";
  const home = (path: string) => (onHome ? path : `/${path}`);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-40 transition-colors duration-200 ${
        scrolled ? "bg-background/80 backdrop-blur-md" : "bg-transparent"
      }`}
    >
      <div className="mx-auto grid w-full max-w-[1710px] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center px-7 pt-3 pb-3 sm:px-12 lg:px-[104px] lg:pt-4 lg:pb-3">
        <a
          href={home("#home")}
          aria-label="Starlit Pay home"
          className="flex shrink-0 items-center gap-3"
        >
          <img src="/logo.png" alt="Starlit Pay" className="h-11 w-auto" />
          <span className="text-[17px] font-semibold text-foreground">Starlit Pay</span>
        </a>
        <nav
          aria-label="Primary navigation"
          className="hidden items-center justify-self-center gap-1 rounded bg-background/40 p-1.5 text-[13px] font-semibold text-foreground/80 shadow-[inset_0_0_0_1px_oklch(1_0_0/.2)] md:flex"
        >
          <a href={home("#product")} className={onHome ? activeClass : idleClass}>
            Product
          </a>
          <a href={home("#how-it-works")} className={idleClass}>
            How It Works
          </a>
          <a href={home("#ecosystem")} className={idleClass}>
            Ecosystem
          </a>
          <a href={home("#security")} className={idleClass}>
            Security
          </a>
          <Link to="/faqs" className={onHome ? idleClass : activeClass}>
            FAQs
          </Link>
        </nav>
        <Button
          asChild
          className="cta-shadow h-9 justify-self-end rounded px-3 text-sm font-semibold sm:px-4"
        >
          <Link to="/auth">
            Get Started{" "}
            <span className="grid size-7 place-items-center rounded-full bg-primary-foreground text-primary">
              <ArrowRight className="size-4" />
            </span>
          </Link>
        </Button>
      </div>
    </header>
  );
}
