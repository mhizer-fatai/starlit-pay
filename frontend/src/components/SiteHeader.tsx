import { useEffect, useState } from "react";
import { ArrowRight, Menu, X } from "lucide-react";
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
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <header
      className={`sticky top-0 z-40 transition-colors duration-200 ${
        scrolled ? "bg-background/80 backdrop-blur-md" : "bg-transparent"
      }`}
    >
      <div className="mx-auto flex w-full max-w-[1710px] items-center justify-between px-7 pt-3 pb-3 sm:px-12 md:grid md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:px-[104px] lg:pt-4 lg:pb-3">
        <a
          href={home("#home")}
          aria-label="Starlit Pay home"
          className="flex shrink-0 items-center gap-2"
          onClick={() => setMenuOpen(false)}
        >
          <img src="/logo.png" alt="Starlit Pay" className="h-11 w-auto" />
          <span className="text-[17px] font-semibold whitespace-nowrap text-foreground">
            Starlit Pay
          </span>
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
        <div className="flex items-center justify-self-end">
          <Button
            asChild
            className="cta-shadow hidden h-9 rounded px-3 text-sm font-semibold sm:px-4 md:inline-flex"
          >
            <Link to="/auth">
              Get Started{" "}
              <span className="grid size-7 place-items-center rounded-full bg-primary-foreground text-primary">
                <ArrowRight className="size-4" />
              </span>
            </Link>
          </Button>
          <button
            type="button"
            className="app-menu-toggle md:hidden"
            onClick={() => setMenuOpen((value) => !value)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X /> : <Menu />}
          </button>
        </div>
      </div>
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-in-out md:hidden ${
          menuOpen ? "[grid-template-rows:1fr]" : "[grid-template-rows:0fr]"
        }`}
      >
        <div className="overflow-hidden">
        <nav
          aria-label="Mobile navigation"
          inert={!menuOpen}
          className="border-t border-foreground/10 bg-background/95 px-7 pt-2 pb-5 backdrop-blur-md"
        >
          <div className="grid gap-1 text-[15px] font-semibold text-foreground/80">
            <a
              href={home("#product")}
              className="rounded px-3 py-3 transition-colors hover:bg-white/50"
              onClick={() => setMenuOpen(false)}
            >
              Product
            </a>
            <a
              href={home("#how-it-works")}
              className="rounded px-3 py-3 transition-colors hover:bg-white/50"
              onClick={() => setMenuOpen(false)}
            >
              How It Works
            </a>
            <a
              href={home("#ecosystem")}
              className="rounded px-3 py-3 transition-colors hover:bg-white/50"
              onClick={() => setMenuOpen(false)}
            >
              Ecosystem
            </a>
            <a
              href={home("#security")}
              className="rounded px-3 py-3 transition-colors hover:bg-white/50"
              onClick={() => setMenuOpen(false)}
            >
              Security
            </a>
            <Link
              to="/faqs"
              className="rounded px-3 py-3 transition-colors hover:bg-white/50"
              onClick={() => setMenuOpen(false)}
            >
              FAQs
            </Link>
          </div>
          <Button asChild className="cta-shadow mt-3 h-12 w-full rounded text-[15px]">
            <Link to="/auth" onClick={() => setMenuOpen(false)}>
              Get Started{" "}
              <span className="grid size-8 place-items-center rounded-full bg-primary-foreground text-primary">
                <ArrowRight className="size-4" />
              </span>
            </Link>
          </Button>
        </nav>
        </div>
      </div>
    </header>
  );
}
