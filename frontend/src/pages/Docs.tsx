import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  BookOpen,
  ChevronDown,
  CreditCard,
  Link2,
  Receipt,
  Rocket,
  Search,
  Send,
  ShieldCheck,
  Wallet,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { ScrollToTopButton } from "@/components/ScrollToTopButton";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { container } from "@/lib/utils";

interface DocArticle {
  title: string;
  body: string[];
  steps?: string[];
}

interface DocCategory {
  key: string;
  blurb: string;
  icon: typeof Rocket;
  articles: DocArticle[];
}

const CATEGORIES: DocCategory[] = [
  {
    key: "Getting Started",
    blurb: "Accounts, PINs, dashboard tour, and test tokens",
    icon: Rocket,
    articles: [
      {
        title: "Creating your account",
        body: [
          "Choose Continue with Google, pick your Google account, then create a 6-digit payment PIN and a username. Your wallet keys are derived on your device from your email and PIN — there is no recovery phrase.",
        ],
        steps: [
          "Open the sign-in page and choose Continue with Google.",
          "Pick your Google account from the chooser.",
          "New here? Create a 6-digit PIN (twice) and choose a username.",
          "Returning? Enter your PIN to unlock your wallet.",
        ],
      },
      {
        title: "Understanding your dashboard",
        body: [
          "The dashboard shows your private balance in USD, a balance trend chart, per-asset holdings in USDC and XLM, and your recent activity. Every figure is decrypted locally from your own data.",
        ],
      },
      {
        title: "Getting test tokens",
        body: [
          "The Faucet page dispenses test tokens for trying the product: 100 XLM or 50 USDC per claim, one claim per asset at a time. Solve the captcha to claim; each claim starts a 4-hour cooldown with a live countdown.",
        ],
      },
      {
        title: "Supported assets and limits",
        body: [
          "Starlit Pay supports USDC and XLM on the Stellar Testnet. Faucet claims are fixed at 100 XLM or 50 USDC per visit with a 4-hour cooldown. There are no minimums on sends beyond a positive amount.",
        ],
      },
    ],
  },
  {
    key: "Wallet & Balances",
    blurb: "Shielded balances, addresses, deposits, and confirmations",
    icon: Wallet,
    articles: [
      {
        title: "Understanding your shielded wallet",
        body: [
          "Your balance is a set of private notes, each encrypted so only your viewing key can read it. The app fetches your encrypted notes and decrypts them in your browser to compute your balance — our servers only ever see ciphertext.",
        ],
      },
      {
        title: "Depositing assets",
        body: [
          "Open Receive to find the shared gateway address and your personal 6-digit memo. Send funds to that address with your memo attached and the gateway shields them into your private balance, usually within a minute. Deposits without your memo cannot be routed to you.",
        ],
        steps: [
          "Copy the gateway deposit address and your personal memo.",
          "Send XLM or USDC to the address from any Stellar wallet.",
          "Include your 6-digit memo exactly.",
          "Wait about a minute, then refresh your dashboard.",
        ],
      },
      {
        title: "How confirmations work",
        body: [
          "Stellar settles in about 5 seconds. Shielding through the gateway adds up to roughly a minute before a deposit or faucet claim appears in your private balance.",
        ],
      },
    ],
  },
  {
    key: "Payments",
    blurb: "Making payments, statuses, fees, and failures",
    icon: CreditCard,
    articles: [
      {
        title: "Making a payment",
        body: [
          "Open Send, enter the recipient's Starlit username, pick USDC or XLM, enter the amount, and slide to confirm. A zero-knowledge proof settles the payment without revealing its details on-chain.",
        ],
        steps: [
          "Enter the recipient's username (usernames can be scanned from a QR code).",
          "Choose the asset and enter an amount greater than zero.",
          "Optionally add a Tag ID for your own reference.",
          "Review the confirmation screen, then slide to send.",
        ],
      },
      {
        title: "Payment fees",
        body: [
          "There are no app fees and Stellar network fees on your transactions are currently sponsored, so payments cost you nothing on testnet.",
        ],
      },
      {
        title: "Failed payments",
        body: [
          "The common causes are a mistyped username, an amount above your private balance, or a network hiccup. Failed payments never move funds — correct the details and try again.",
        ],
      },
    ],
  },
  {
    key: "Send & Receive",
    blurb: "Usernames, QR codes, and memos",
    icon: Send,
    articles: [
      {
        title: "Sending to a username",
        body: [
          "Every Starlit account has a unique username. Enter it with or without the @ prefix, or scan the recipient's QR code straight into the field. The app resolves usernames to private payment destinations automatically.",
        ],
      },
      {
        title: "Receiving with QR codes",
        body: [
          "Your Receive page shows two QR codes: one encodes the gateway deposit address, the other your personal memo. Share them together — a deposit needs both the address and your exact memo to reach you.",
        ],
      },
    ],
  },
  {
    key: "Payment Links",
    blurb: "Requesting money with shareable links",
    icon: Link2,
    articles: [
      {
        title: "Creating and sharing a payment link",
        body: [
          "On the Payment Links page, enter an amount and an optional note to generate a shareable URL. Anyone opening the link can pay you through it, and each link tracks its status from pending to claimed.",
        ],
        steps: [
          "Enter the amount and an optional description.",
          "Generate the link and copy the URL.",
          "Share it anywhere — chat, email, or QR.",
          "Watch its status flip to claimed once paid.",
        ],
      },
    ],
  },
  {
    key: "Transactions & Statements",
    blurb: "History, receipts, exports, and emailed copies",
    icon: Receipt,
    articles: [
      {
        title: "Reading your history",
        body: [
          "Recent Activity on the dashboard and the full Transactions page show incoming notes and outgoing records newest-first. Tap any entry for its receipt: type, date, counterparty, and reference.",
        ],
      },
      {
        title: "Downloading statements",
        body: [
          "The Download Statement button offers PDF or Excel, over the last month, last 2 months, or a custom range — with an option to email a copy to your inbox. Balances run oldest-first with before/after figures per asset.",
        ],
      },
    ],
  },
  {
    key: "Security",
    blurb: "PINs, sessions, and staying safe",
    icon: ShieldCheck,
    articles: [
      {
        title: "How your PIN protects you",
        body: [
          "Your PIN derives your wallet keys and is verified as a one-way hash — it is never stored or transmitted. Sessions expire, refreshing the tab always asks for the PIN again, and signing out wipes the session everywhere it matters on that browser.",
        ],
      },
      {
        title: "Staying safe",
        body: [
          "Only sign in at starlitpay.xyz, never share your PIN, and know that Starlit Pay will never ask for it, your keys, or authentication codes. Balances in USD use market prices fetched through our servers so your browser never touches price providers directly.",
        ],
      },
    ],
  },
];

const POPULAR = ["Getting Started", "Wallet", "Payments", "Statements"];

function DocArticleItem({ article }: { article: DocArticle }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-border bg-background/40">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center justify-between gap-4 px-6 py-5 text-left text-[16px] font-medium text-foreground"
      >
        {article.title}
        <ChevronDown
          className={`size-4 shrink-0 text-foreground/60 transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div className="grid gap-3 px-6 pb-5">
            {article.body.map((paragraph) => (
              <p key={paragraph.slice(0, 32)} className="text-[15px] leading-[1.7] text-foreground/75">
                {paragraph}
              </p>
            ))}
            {article.steps && (
              <ol className="grid list-decimal gap-2 pl-5 text-[15px] leading-[1.7] text-foreground/75">
                {article.steps.map((step) => (
                  <li key={step.slice(0, 32)}>{step}</li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DocsPage() {
  const [query, setQuery] = useState("");

  useEffect(() => {
    document.title = "Documentation — Starlit Pay";
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const matches: { category: string; article: DocArticle }[] = [];
    for (const category of CATEGORIES) {
      for (const article of category.articles) {
        const haystack = `${article.title} ${article.body.join(" ")} ${(article.steps ?? []).join(" ")}`.toLowerCase();
        if (haystack.includes(q)) matches.push({ category: category.key, article });
      }
    }
    return matches;
  }, [query]);

  return (
    <div className="relative overflow-x-clip">
      <SiteHeader />

      <div className="hero-wash relative -mt-28 pt-28">
        <div className={`${container} pt-14 pb-12 lg:pt-[88px]`}>
          <h1 className="max-w-[900px] text-[34px] font-medium leading-[1.08] text-foreground sm:text-[46px] lg:text-[56px]">
            Everything to use Starlit Pay.{" "}
            <span className="ml-1 inline-block rounded-full border border-foreground/15 px-3 py-1 align-middle text-[12px] font-medium text-foreground/70">
              v1.0
            </span>
          </h1>
          <div className="mt-7 max-w-[720px]">
            <div className="flex items-center gap-3 rounded-md border border-border bg-background px-4 shadow-sm">
              <Search className="size-5 shrink-0 text-muted-foreground" />
              <label htmlFor="docs-search" className="sr-only">
                Search documentation
              </label>
              <Input
                id="docs-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search documentation…"
                className="h-14 border-0 bg-transparent px-0 text-[16px] shadow-none focus-visible:ring-0"
              />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
              <span className="font-semibold text-foreground/70">Popular:</span>
              {POPULAR.map((term) => (
                <button
                  key={term}
                  type="button"
                  onClick={() => setQuery(term)}
                  className="rounded-full border border-border bg-background/60 px-3 py-1.5 text-foreground/75 transition-colors hover:bg-white/70"
                >
                  {term}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className={`${container} py-14 lg:py-20`}>
        {results ? (
          <div>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2 className="text-[22px] font-medium text-foreground">
                {results.length} result{results.length === 1 ? "" : "s"}
              </h2>
              <button
                type="button"
                onClick={() => setQuery("")}
                className="text-[14px] font-medium text-primary hover:underline"
              >
                Clear search
              </button>
            </div>
            {results.length === 0 ? (
              <div className="mt-6 rounded-md border border-border p-8 text-center">
                <p className="text-[15px] font-medium text-foreground">No docs found</p>
                <p className="mt-1 text-[14px] text-foreground/70">
                  Try different words, or visit Help &amp; Support for troubleshooting.
                </p>
              </div>
            ) : (
              <div className="mt-6 grid max-w-[860px] gap-3">
                {results.map(({ category, article }) => (
                  <div key={article.title}>
                    <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      {category}
                    </p>
                    <DocArticleItem article={article} />
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="grid gap-12">
            {CATEGORIES.map((category) => (
              <section key={category.key} id={category.key.toLowerCase().replace(/[^a-z]+/g, "-")}>
                <div className="flex items-center gap-3">
                  <span className="grid size-10 place-items-center rounded-full bg-primary/10 text-primary">
                    <category.icon className="size-5" />
                  </span>
                  <div>
                    <h2 className="text-[22px] font-medium text-foreground">{category.key}</h2>
                    <p className="text-[14px] text-foreground/70">{category.blurb}</p>
                  </div>
                </div>
                <div className="mt-5 grid max-w-[860px] gap-3">
                  {category.articles.map((article) => (
                    <DocArticleItem key={article.title} article={article} />
                  ))}
                </div>
              </section>
            ))}

            <section className="grid gap-4 md:grid-cols-2">
              <div className="rounded-md border border-border p-8">
                <div className="flex items-center gap-2 text-[16px] font-semibold text-foreground">
                  <BookOpen className="size-5 text-primary" /> Building with Starlit Pay?
                </div>
                <p className="mt-2 text-[14px] leading-[1.7] text-foreground/75">
                  We don&apos;t offer a public API, webhooks, or SDKs yet — the endpoints behind
                  this app are private and may change without notice. If you&apos;re exploring an
                  integration, talk to us first.
                </p>
              </div>
              <div className="rounded-md bg-black p-8 text-white">
                <p className="text-[16px] font-semibold">Stuck on a problem instead?</p>
                <p className="mt-2 text-[14px] leading-[1.7] text-white/70">
                  Troubleshooting, failed payments, and account recovery live in Help &amp; Support.
                </p>
                <a
                  href="/help"
                  className="mt-4 inline-block text-[14px] font-medium text-white underline-offset-4 hover:underline"
                >
                  Visit Help &amp; Support →
                </a>
              </div>
            </section>
          </div>
        )}
      </div>

      <SiteFooter />
      <ScrollToTopButton />
    </div>
  );
}

export default DocsPage;
