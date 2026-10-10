import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { container } from "@/lib/utils";

const socials = [
  {
    label: "X (Twitter)",
    href: "#",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="size-4" aria-hidden="true">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
  },
  {
    label: "LinkedIn",
    href: "#",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="size-4" aria-hidden="true">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1 0-4.124 2.062 2.062 0 0 1 0 4.124zM7.119 20.452H3.554V9h3.565v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
      </svg>
    ),
  },
  {
    label: "Telegram",
    href: "#",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="size-4" aria-hidden="true">
        <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm4.962 7.224c.1-.002.321.023.465.14a.5.5 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
      </svg>
    ),
  },
  {
    label: "Discord",
    href: "#",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="size-4" aria-hidden="true">
        <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03M8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418m7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418" />
      </svg>
    ),
  },
];

const legalLinks: { label: string; href: string }[] = [
  { label: "FAQ", href: "/faqs" },
  { label: "Help & support", href: "/help" },
  { label: "Documentation", href: "/docs" },
  { label: "Blog", href: "#" },
  { label: "About Starlit Pay", href: "/about" },
  { label: "Privacy Policy", href: "/privacy" },
  { label: "Terms of Use", href: "/terms" },
  { label: "Cookie Policy", href: "/cookies" },
];

export function SiteFooter() {
  const [email, setEmail] = useState("");
  const [note, setNote] = useState<"ok" | "error" | "">("");

  function handleSubscribe(event: FormEvent) {
    event.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setNote("error");
      return;
    }
    setEmail("");
    setNote("ok");
  }

  return (
    <footer className="bg-black text-white">
      <div className={`${container} py-14 lg:py-16`}>
        <div className="flex flex-col gap-10 md:flex-row md:items-center md:justify-between">
          <a
            href="#home"
            aria-label="Starlit Pay home"
            className="flex items-center gap-3 self-start"
          >
            <img src="/logo.png" alt="Starlit Pay" className="h-9 w-auto" />
            <span className="text-[17px] font-semibold">Starlit Pay</span>
          </a>
          <div className="flex w-full flex-col gap-2 md:w-auto md:flex-1 md:items-center md:px-6">
            <form
              onSubmit={handleSubscribe}
              className="flex w-full items-center gap-2 md:max-w-md"
              aria-label="Newsletter signup"
            >
              <label htmlFor="newsletter-email" className="sr-only">
                Email address
              </label>
              <input
                id="newsletter-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Enter your email for updates"
                className="h-10 w-full rounded border border-white/15 bg-white/10 px-3 text-sm text-white placeholder:text-white/40 focus:border-white/40 focus:outline-none"
              />
              <Button type="submit" className="h-10 shrink-0 rounded">
                Subscribe
              </Button>
            </form>
            {note === "ok" && (
              <p className="text-xs text-white/70" role="status">
                Thanks for subscribing! Watch your inbox for updates.
              </p>
            )}
            {note === "error" && (
              <p className="text-xs text-red-400" role="alert">
                Please enter a valid email address.
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            {socials.map((social) => (
              <a
                key={social.label}
                href={social.href}
                aria-label={social.label}
                className="grid size-10 place-items-center rounded-md border border-white/15 text-white/80 transition-colors duration-200 hover:bg-white/10 hover:text-white"
              >
                {social.icon}
              </a>
            ))}
          </div>
        </div>
        <div className="mt-12 flex flex-col gap-4 border-t border-white/10 pt-8 md:flex-row md:items-center md:justify-between">
          <nav
            aria-label="Legal"
            className="flex flex-wrap gap-x-8 gap-y-2 text-[14px] text-white/70"
          >
            {legalLinks.map((link) => (
              <a key={link.label} href={link.href} className="transition-colors duration-200 hover:text-hero-sky">
                {link.label}
              </a>
            ))}
          </nav>
          <p className="text-[13px] text-white/50">
            © {new Date().getFullYear()} Starlit Pay. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
