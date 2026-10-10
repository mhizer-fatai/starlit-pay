import { useEffect, useState } from "react";
import { Cookie, Download, Lock, Settings2, TrendingUp, X } from "lucide-react";
import { jsPDF } from "jspdf";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { ScrollToTopButton } from "@/components/ScrollToTopButton";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { getConsent, setConsent, type ConsentState } from "@/lib/consent";
import { container } from "@/lib/utils";

const APPROACH = [
  {
    icon: Lock,
    title: "Essential",
    text: "Always active — login, security, and core features cannot work without these.",
  },
  {
    icon: Settings2,
    title: "Preferences",
    text: "Optional. Remembers choices like theme, layout, and display settings.",
  },
  {
    icon: TrendingUp,
    title: "Analytics",
    text: "Optional. Helps us understand usage and improve the product where permitted.",
  },
];

const INVENTORY: { name: string; category: string; purpose: string; duration: string }[] = [
  { name: "starlit_jwt", category: "Necessary", purpose: "Backend login session", duration: "Until sign-out (token valid 7 days)" },
  { name: "starlit_user", category: "Necessary", purpose: "Account profile used across the app", duration: "Until sign-out" },
  { name: "sb-…-auth-token", category: "Necessary", purpose: "Google sign-in session (Supabase)", duration: "Until sign-out" },
  { name: "starlit_oauth", category: "Necessary", purpose: "Completes the login redirect (session storage)", duration: "Cleared after login" },
  { name: "Cloudflare challenge data", category: "Necessary", purpose: "Faucet bot protection", duration: "Short-lived" },
  { name: "Google sign-in cookies", category: "Necessary", purpose: "Set by Google only while you sign in", duration: "Session" },
  { name: "starlit-pay-theme", category: "Functional", purpose: "Remembers light/dark theme", duration: "Until changed" },
  { name: "starlit-pay-sidebar-collapsed", category: "Functional", purpose: "Remembers sidebar layout", duration: "Until changed" },
  { name: "starlit_faucet_last_claim_*", category: "Functional", purpose: "Backup of faucet cooldown timing", duration: "A few hours" },
  { name: "starlit_notif_read_*", category: "Functional", purpose: "Which notifications you have seen", duration: "Until site data is cleared" },
  { name: "Payment-links cache", category: "Functional", purpose: "Offline copy of your payment links", duration: "Until site data is cleared" },
];

function CategoryToggle({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="modal-row" style={{ alignItems: "flex-start" }}>
      <div>
        <p className="modal-value" style={{ fontSize: 14 }}>
          {label} {disabled && <span className="text-xs font-normal text-muted-foreground">· Always active</span>}
        </p>
        <p className="mt-1 text-[13px] text-muted-foreground">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`settings-toggle ${checked ? "settings-toggle-on" : "settings-toggle-off"}`}
        style={disabled ? { opacity: 0.6, cursor: "not-allowed" } : undefined}
      >
        <span className="settings-toggle-thumb" />
      </button>
    </div>
  );
}

function PreferencesModal({
  initial,
  onClose,
}: {
  initial: ConsentState;
  onClose: (saved: ConsentState | null) => void;
}) {
  const [functional, setFunctional] = useState(initial.functional);
  const [analytics, setAnalytics] = useState(initial.analytics);
  const [marketing, setMarketing] = useState(initial.marketing);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = (choice: { functional: boolean; analytics: boolean; marketing: boolean }) =>
    onClose(setConsent(choice));

  return createPortal(
    <div
      className="send-modal"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose(null);
      }}
    >
      <div
        className="send-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cookie-prefs-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h3 className="modal-title" id="cookie-prefs-title">
            Cookie Preferences
          </h3>
          <button type="button" className="modal-close" onClick={() => onClose(null)} aria-label="Close">
            <X />
          </button>
        </div>
        <div className="modal-body">
          <CategoryToggle
            label="Strictly Necessary"
            description="Login, security, fraud prevention. The platform cannot function without these."
            checked
            disabled
            onChange={() => {}}
          />
          <CategoryToggle
            label="Functional"
            description="Theme, layout, and convenience storage such as notification read-state."
            checked={functional}
            onChange={setFunctional}
          />
          <CategoryToggle
            label="Analytics"
            description="Helps us understand usage and improve Starlit Pay. Off unless you allow it."
            checked={analytics}
            onChange={setAnalytics}
          />
          <CategoryToggle
            label="Marketing"
            description="We currently set no advertising technologies. Keeping this off changes nothing today."
            checked={marketing}
            onChange={setMarketing}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              onClick={() => save({ functional: false, analytics: false, marketing: false })}
            >
              Reject Optional
            </Button>
            <Button
              type="button"
              className="flex-1"
              onClick={() => save({ functional: true, analytics: true, marketing: true })}
            >
              Accept All
            </Button>
          </div>
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            onClick={() => save({ functional, analytics, marketing })}
          >
            Save My Choices
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function downloadCookiesPdf() {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 56;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const width = pageW - margin * 2;
  let y = 72;
  const needPage = (extra: number) => {
    if (y + extra > pageH - 72) {
      doc.addPage();
      y = 72;
    }
  };
  const paragraph = (text: string, size: number, bold: boolean, gap: number) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor("#0f172a");
    for (const line of doc.splitTextToSize(text, width)) {
      needPage(20);
      y += 15;
      doc.text(line, margin, y);
    }
    y += gap;
  };
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor("#0f172a");
  doc.text("Starlit Pay — Cookie Policy", margin, y);
  y += 8;
  paragraph("Last updated: October 6, 2026  •  Effective date: October 6, 2026", 10, false, 10);
  const body: [string, string][] = [
    ["Our approach", "Essential technologies are always active. Preferences, analytics, and marketing are optional; we currently operate no analytics or advertising technologies, so keeping those off changes nothing today."],
    ["What are cookies?", "Cookies are small text files stored on your device. In this policy the term also covers similar technologies such as local storage, session storage, device identifiers, and security challenges."],
    ["Strictly Necessary", "Login sessions, account security, fraud and bot prevention (including the faucet challenge), and remembering your cookie choice. These cannot be disabled."],
    ["Functional", "Theme, sidebar layout, notification read-state, payment-link cache, and faucet timing backup."],
    ["Analytics", "Would cover product-usage measurement if introduced, only with consent where the law requires it."],
    ["Marketing", "We set no advertising cookies or cross-site tracking technologies."],
    ["Third parties", "Google (sign-in only), Cloudflare (faucet challenge), Supabase (auth/database), Google Fonts, and DiceBear avatars when displayed — each under its own privacy policy."],
    ["Security & fraud prevention", "Technical signals from your device, browser, and network may be used to detect bots, suspicious logins, and abuse. This protects the platform; it is not marketing tracking."],
    ["Managing preferences", "Use Manage Cookie Preferences on this page any time. You can also block or clear site data in your browser, but blocking strictly necessary technologies will sign you out and break core features."],
    ["Consent", "Essential technologies operate where legally permitted without separate consent. Optional ones need your consent where required; withdrawing it never affects prior lawful processing."],
    ["Changes & contact", "We update this policy when our technologies change. Questions: support@starlitpay.xyz. See also our Privacy Policy."],
  ];
  for (const [title, text] of body) {
    needPage(50);
    y += 16;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor("#0f172a");
    doc.text(title, margin, y);
    y += 4;
    paragraph(text, 10, false, 6);
  }
  doc.save("starlit-pay-cookie-policy.pdf");
}

function CookiesPage() {
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [savedNote, setSavedNote] = useState("");

  useEffect(() => {
    document.title = "Cookie Policy — Starlit Pay";
  }, []);

  return (
    <div className="relative overflow-x-clip [scroll-behavior:smooth]">
      <SiteHeader />
      <div className="hero-wash relative -mt-28 pt-28">
        <div className={`${container} pt-14 pb-10 lg:pt-[88px]`}>
          <h1 className="max-w-[900px] text-[34px] font-medium leading-[1.08] text-foreground sm:text-[46px] lg:text-[56px]">
            Cookie Policy
          </h1>
          <p className="mt-5 max-w-[680px] text-[14px] leading-[1.7] text-foreground/75 sm:text-[16px]">
            How we use cookies and similar technologies to keep Starlit Pay secure, remember your
            preferences, and understand how our services are used.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <Button
              type="button"
              variant="secondary"
              className="h-11 rounded"
              onClick={() => {
                setSavedNote("");
                setPrefsOpen(true);
              }}
            >
              <Cookie /> Manage Cookie Preferences
            </Button>
            <Button type="button" variant="ghost" className="h-11 rounded" onClick={downloadCookiesPdf}>
              <Download /> Download PDF
            </Button>
            <p className="text-[13px] text-foreground/70">
              Last updated: October 6, 2026 · Effective date: October 6, 2026
            </p>
          </div>
          {savedNote && (
            <p className="mt-3 text-[13px] text-foreground/70" role="status">
              {savedNote}
            </p>
          )}
        </div>
      </div>

      <div className={`${container} py-14 lg:py-20`}>
        <div className="grid gap-4 sm:grid-cols-3">
          {APPROACH.map((item) => (
            <div key={item.title} className="rounded-md border border-border p-5">
              <span className="grid size-9 place-items-center rounded-full bg-primary/10 text-primary">
                <item.icon className="size-4" />
              </span>
              <p className="mt-3 text-[15px] font-semibold text-foreground">{item.title}</p>
              <p className="mt-1 text-[14px] leading-[1.7] text-foreground/75">{item.text}</p>
            </div>
          ))}
        </div>

        <article className="mt-12 grid max-w-[860px] gap-10">
          <section id="what" className="scroll-mt-28">
            <p className="font-mono text-[12px] text-primary">01</p>
            <h2 className="mt-1 text-[26px] font-medium text-foreground">What Are Cookies?</h2>
            <p className="mt-3 text-[15px] leading-[1.8] text-foreground/80">
              Cookies are small text files stored on your device that let websites recognize it,
              remember preferences, and maintain sessions. In this policy the term also covers
              similar technologies: local storage, session storage, device identifiers, and
              security challenges.
            </p>
          </section>

          <section id="why" className="scroll-mt-28">
            <p className="font-mono text-[12px] text-primary">02</p>
            <h2 className="mt-1 text-[26px] font-medium text-foreground">Why We Use Them</h2>
            <div className="mt-4 grid gap-3">
              <div className="rounded-md border border-border p-4">
                <p className="text-[14px] font-semibold text-foreground">Strictly Necessary — always active</p>
                <p className="mt-1 text-[14px] leading-[1.7] text-foreground/75">
                  Login, session management, account security, fraud and bot prevention, and
                  remembering your cookie choice. The platform cannot function without these.
                </p>
              </div>
              <div className="rounded-md border border-border p-4">
                <p className="text-[14px] font-semibold text-foreground">Functional — optional</p>
                <p className="mt-1 text-[14px] leading-[1.7] text-foreground/75">
                  Theme, sidebar layout, notification read-state, cached payment links, and faucet
                  timing. Convenience only; the app works without them.
                </p>
              </div>
              <div className="rounded-md border border-border p-4">
                <p className="text-[14px] font-semibold text-foreground">Analytics — optional, currently unused</p>
                <p className="mt-1 text-[14px] leading-[1.7] text-foreground/75">
                  Would cover product-usage measurement if introduced, only with consent where the
                  law requires it. Nothing in this category runs today.
                </p>
              </div>
              <div className="rounded-md border border-primary/25 bg-primary/5 p-4">
                <p className="text-[14px] font-semibold text-foreground">Marketing — none</p>
                <p className="mt-1 text-[14px] leading-[1.7] text-foreground/75">
                  We set no advertising cookies and perform no cross-site tracking.
                </p>
              </div>
            </div>
          </section>

          <section id="inventory" className="scroll-mt-28">
            <p className="font-mono text-[12px] text-primary">03</p>
            <h2 className="mt-1 text-[26px] font-medium text-foreground">Technologies We Use</h2>
            <p className="mt-3 text-[15px] leading-[1.8] text-foreground/80">
              The complete list — every entry below is something Starlit Pay actually sets or loads
              today. Keys marked <code className="font-mono text-[13px]">*</code> include your
              account identifier.
            </p>
            <div className="table-scroll mt-4">
              <table className="w-full border-collapse text-left text-[14px]">
                <thead>
                  <tr>
                    {["Name", "Category", "Purpose", "Duration"].map((head) => (
                      <th
                        key={head}
                        className="border-b border-border px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground"
                      >
                        {head}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {INVENTORY.map((row) => (
                    <tr key={row.name} className="border-b border-border/60">
                      <td className="px-3 py-2.5 font-mono text-[13px] text-foreground">{row.name}</td>
                      <td className="px-3 py-2.5 text-foreground/75">{row.category}</td>
                      <td className="px-3 py-2.5 text-foreground/75">{row.purpose}</td>
                      <td className="px-3 py-2.5 text-foreground/75">{row.duration}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section id="third-parties" className="scroll-mt-28">
            <p className="font-mono text-[12px] text-primary">04</p>
            <h2 className="mt-1 text-[26px] font-medium text-foreground">Third-Party Technologies</h2>
            <p className="mt-3 text-[15px] leading-[1.8] text-foreground/80">
              Google sets cookies only while you complete Google sign-in. Cloudflare runs the faucet
              bot challenge. Supabase powers login sessions and the database. Google Fonts serves
              typefaces, and DiceBear serves default avatars when displayed. Each operates under its
              own privacy policy.
            </p>
          </section>

          <section id="security" className="scroll-mt-28">
            <p className="font-mono text-[12px] text-primary">05</p>
            <h2 className="mt-1 text-[26px] font-medium text-foreground">Security &amp; Fraud Prevention</h2>
            <p className="mt-3 text-[15px] leading-[1.8] text-foreground/80">
              Technical signals from your device, browser, and network may be used to detect bots,
              suspicious logins, and abuse of payment flows. This protects the platform and our
              users — it is not marketing tracking, and it cannot be disabled while using the
              Services.
            </p>
          </section>

          <section id="managing" className="scroll-mt-28">
            <p className="font-mono text-[12px] text-primary">06</p>
            <h2 className="mt-1 text-[26px] font-medium text-foreground">Managing Your Preferences</h2>
            <p className="mt-3 text-[15px] leading-[1.8] text-foreground/80">
              Open Cookie Preferences any time to accept all, reject optional technologies, or
              customize by category — your choice is stored on this device and can be changed
              whenever you like. Withdrawing consent never affects processing that already happened.
            </p>
            <Button
              type="button"
              variant="secondary"
              className="mt-4 h-11 rounded"
              onClick={() => {
                setSavedNote("");
                setPrefsOpen(true);
              }}
            >
              <Cookie /> Manage Cookie Preferences
            </Button>
          </section>

          <section id="browser" className="scroll-mt-28">
            <p className="font-mono text-[12px] text-primary">07</p>
            <h2 className="mt-1 text-[26px] font-medium text-foreground">Browser Controls</h2>
            <p className="mt-3 text-[15px] leading-[1.8] text-foreground/80">
              You can also block or clear site data directly in your browser settings. Note that
              blocking strictly necessary technologies will sign you out and break core features
              such as login, payments, and balance sync.
            </p>
          </section>

          <section id="changes" className="scroll-mt-28">
            <p className="font-mono text-[12px] text-primary">08</p>
            <h2 className="mt-1 text-[26px] font-medium text-foreground">Changes &amp; Contact</h2>
            <p className="mt-3 text-[15px] leading-[1.8] text-foreground/80">
              We update this policy when our technologies change; the date above always reflects the
              current version. For the bigger picture see our{" "}
              <a href="/privacy" className="font-medium text-primary hover:underline">
                Privacy Policy
              </a>
              . Questions about cookies: support@starlitpay.xyz.
            </p>
          </section>
        </article>
      </div>

      {prefsOpen && (
        <PreferencesModal
          initial={getConsent() ?? { necessary: true, functional: true, analytics: false, marketing: false }}
          onClose={(saved) => {
            setPrefsOpen(false);
            if (saved) setSavedNote("Preferences saved on this device.");
          }}
        />
      )}

      <SiteFooter />
      <ScrollToTopButton />
    </div>
  );
}

export default CookiesPage;
