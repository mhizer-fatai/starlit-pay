import { useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronDown, LogIn, Menu, Ticket, X } from "lucide-react";
import { Link, useLocation } from "react-router-dom";

import { Button } from "@/components/ui/button";

const activeClass =
  "rounded bg-primary px-6 py-2 text-primary-foreground transition-colors duration-200 hover:bg-primary/90";
const idleClass = "rounded px-6 py-2 transition-colors duration-200 hover:bg-white/50";

export function SiteHeader() {
  const { pathname } = useLocation();
  const onHome = pathname === "/";
  const onFaqs = pathname === "/faqs";
  const home = (path: string) => (onHome ? path : `/${path}`);
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const startRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
    setStartOpen(false);
  }, [pathname]);

  // The "Get Started" menu closes on Escape or a click anywhere else.
  useEffect(() => {
    if (!startOpen) return;
    function onDown(event: MouseEvent) {
      if (!startRef.current?.contains(event.target as Node)) setStartOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setStartOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [startOpen]);

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
          <a href={home("#about")} className={idleClass}>
            About
          </a>
          <a href={home("#security")} className={idleClass}>
            Security
          </a>
          <a href={home("#faqs")} className={onFaqs ? activeClass : idleClass}>
            FAQs
          </a>
        </nav>
        <div className="flex items-center justify-self-end">
          <div ref={startRef} className="relative hidden md:block">
            <Button
              type="button"
              className="cta-shadow h-9 rounded px-3 text-sm font-semibold sm:px-4"
              onClick={() => setStartOpen((value) => !value)}
              aria-haspopup="menu"
              aria-expanded={startOpen}
            >
              Get Started{" "}
              <span className="grid size-7 place-items-center rounded-full bg-primary-foreground text-primary">
                <ChevronDown className={`size-4 transition-transform ${startOpen ? "rotate-180" : ""}`} />
              </span>
            </Button>
            {startOpen && (
              <div
                role="menu"
                className="absolute right-0 z-50 mt-2 w-64 rounded-md border border-border bg-background p-1.5 shadow-[0_20px_50px_oklch(0.2_0.02_230/0.18)]"
              >
                <Link
                  to="/auth"
                  role="menuitem"
                  className="flex items-start gap-3 rounded px-3 py-2.5 transition-colors hover:bg-primary/10"
                  onClick={() => setStartOpen(false)}
                >
                  <LogIn className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span>
                    <span className="block text-sm font-semibold text-foreground">Sign in</span>
                    <span className="block text-xs text-foreground/60">Testers and invited friends</span>
                  </span>
                </Link>
                <a
                  href={home("#beta")}
                  role="menuitem"
                  className="flex items-start gap-3 rounded px-3 py-2.5 transition-colors hover:bg-primary/10"
                  onClick={() => setStartOpen(false)}
                >
                  <Ticket className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span>
                    <span className="block text-sm font-semibold text-foreground">Apply for the beta</span>
                    <span className="block text-xs text-foreground/60">Become a Founding Tester</span>
                  </span>
                </a>
              </div>
            )}
          </div>
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
              href={home("#about")}
              className="rounded px-3 py-3 transition-colors hover:bg-white/50"
              onClick={() => setMenuOpen(false)}
            >
              About
            </a>
            <a
              href={home("#security")}
              className="rounded px-3 py-3 transition-colors hover:bg-white/50"
              onClick={() => setMenuOpen(false)}
            >
              Security
            </a>
            <a
              href={home("#faqs")}
              className="rounded px-3 py-3 transition-colors hover:bg-white/50"
              onClick={() => setMenuOpen(false)}
            >
              FAQs
            </a>
          </div>
          <div className="mt-3 grid gap-2">
            <Button asChild className="cta-shadow h-12 w-full rounded text-[15px]">
              <a href={home("#beta")} onClick={() => setMenuOpen(false)}>
                Apply for the beta{" "}
                <span className="grid size-8 place-items-center rounded-full bg-primary-foreground text-primary">
                  <ArrowRight className="size-4" />
                </span>
              </a>
            </Button>
            <Button asChild variant="secondary" className="h-12 w-full rounded text-[15px]">
              <Link to="/auth" onClick={() => setMenuOpen(false)}>
                <LogIn className="size-4" /> Sign in
              </Link>
            </Button>
          </div>
        </nav>
        </div>
      </div>
    </header>
  );
}
