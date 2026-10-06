import { useEffect, useMemo, useState } from "react";
import {
  KeyRound,
  Link2,
  Receipt,
  Rocket,
  Search,
  Send,
  ShieldAlert,
  Wallet,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { FaqItem } from "@/components/FaqItem";
import { Input } from "@/components/ui/input";
import { ScrollToTopButton } from "@/components/ScrollToTopButton";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { container } from "@/lib/utils";

interface Article {
  title: string;
  category: string;
  body: string;
  popular?: boolean;
}

const CATEGORIES = [
  { key: "Getting Started", icon: Rocket, blurb: "Create your account and fund it" },
  { key: "Account & Security", icon: KeyRound, blurb: "Login, PIN, and staying safe" },
  { key: "Payments", icon: Send, blurb: "Failed, pending, and wrong-address help" },
  { key: "Wallet & Balances", icon: Wallet, blurb: "Receive, faucet, and balances" },
  { key: "Payment Links", icon: Link2, blurb: "Create, share, and claim links" },
  { key: "Transactions", icon: Receipt, blurb: "History, receipts, and statements" },
];

const ARTICLES: Article[] = [
  {
    title: "How do I create an account?",
    category: "Getting Started",
    body: "Choose Continue with Google on the sign-in page, pick your Google account, then create a 6-digit payment PIN and a username. Your wallet keys are derived on your device from your email and PIN — there is no recovery phrase to write down, but there is also no way to recover a forgotten PIN.",
    popular: true,
  },
  {
    title: "How do I get test tokens?",
    category: "Getting Started",
    body: "Open the Faucet page, solve the captcha, and claim either 100 XLM or 50 USDC per visit. Funds travel through the deposit gateway and are shielded to your private balance, usually within a minute. Each claim starts a 4-hour cooldown shown as a live countdown on the Claim button.",
    popular: true,
  },
  {
    title: "My PIN is rejected. What do I do?",
    category: "Account & Security",
    body: "Double-check each digit — the PIN must match exactly what you created. There is no reset: the PIN is never stored anywhere, so we cannot recover or change it for you. If you are locked out, use Switch Account on the unlock screen to start over with a different login.",
    popular: true,
  },
  {
    title: "How do I keep my account secure?",
    category: "Account & Security",
    body: "Never share your 6-digit PIN with anyone, and only ever sign in at starlitpay.xyz. Starlit Pay will never ask for your PIN, private keys, or recovery phrases — anyone who does is trying to scam you. Signing out clears your session on that browser.",
  },
  {
    title: "I think my account is compromised. What now?",
    category: "Account & Security",
    body: "Sign out on the device immediately so the local session is destroyed, then email support@starlitpay.xyz right away with your username and what happened. Do not interact with suspicious links, and never send your PIN or keys to anyone claiming to help.",
    popular: true,
  },
  {
    title: "Why did my payment fail?",
    category: "Payments",
    body: "The usual causes are a mistyped recipient username, an amount above your private balance, or a network hiccup. Check the recipient, confirm your balance covers the amount, and try again. Failed payments never move funds.",
    popular: true,
  },
  {
    title: "Why is my transaction pending?",
    category: "Payments",
    body: "Stellar itself settles in about 5 seconds, but Starlit Pay shields payments through a gateway first, which typically takes up to a minute. Give it a moment and refresh — the activity feed updates once the shielded note lands.",
    popular: true,
  },
  {
    title: "I sent funds to the wrong address or memo. Can I reverse it?",
    category: "Payments",
    body: "Usually not. Confirmed blockchain payments are irreversible, and deposits sent without your personal memo cannot be routed to you. Always verify the address, network, asset, and memo before confirming. If you paid the wrong Starlit user, only they can send it back.",
  },
  {
    title: "How do I receive payments?",
    category: "Wallet & Balances",
    body: "Open the Receive page and share your Starlit username, or send the deposit gateway address together with your personal 6-digit memo — both have copy buttons and QR codes. Anyone paying from another wallet must include the memo or the deposit cannot reach you.",
  },
  {
    title: "My balance shows $0.00 after a deposit. Where are my funds?",
    category: "Wallet & Balances",
    body: "Three common reasons: the gateway is still shielding the deposit (wait about a minute and refresh), you reloaded the tab and need to re-enter your PIN to unlock the wallet, or a deposit was sent without your memo and could not be routed. Faucet claims also start a 4-hour cooldown between visits.",
  },
  {
    title: "How do payment links work?",
    category: "Payment Links",
    body: "Create a link with an amount and optional note, share the URL anywhere, and anyone opening it can pay you through it. Each link tracks its status — pending or claimed — and you can delete links you no longer need from the Payment Links page.",
  },
  {
    title: "How do I download statements and receipts?",
    category: "Transactions",
    body: "Tap any entry in Recent Activity or the Transactions page for a full receipt with a PDF download. The Download Statement button opens options for PDF or Excel, last month, last 2 months, or a custom range — plus an optional emailed copy to your inbox.",
  },
  {
    title: "Why do balances show in USD?",
    category: "Transactions",
    body: "USDC tracks the dollar 1:1 and XLM is converted at a live market price fetched through our servers. Statements note the conversion basis so exported figures stay interpretable.",
  },
];

const POPULAR_SEARCHES = ["Can't log in", "Payment failed", "Transaction pending", "Wrong address"];

const URGENT = [
  "I can't access my account",
  "My payment failed",
  "My transaction is pending",
  "My funds haven't arrived",
  "I think my account is compromised",
];

function HelpPage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Help & Support — Starlit Pay";
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ARTICLES.filter((article) => {
      const matchesQuery =
        !q ||
        article.title.toLowerCase().includes(q) ||
        article.body.toLowerCase().includes(q);
      const matchesCategory = !category || article.category === category;
      return matchesQuery && matchesCategory;
    });
  }, [query, category]);

  const popular = ARTICLES.filter((article) => article.popular);

  return (
    <div className="relative overflow-x-clip">
      <SiteHeader />

      <div className="hero-wash relative -mt-28 pt-28">
        <div className={`${container} pt-14 pb-12 lg:pt-[88px]`}>
          <p className="text-[13px] font-semibold uppercase tracking-[0.18em] text-primary">
            Help &amp; Support
          </p>
          <h1 className="mt-3 max-w-[900px] text-[34px] font-medium leading-[1.08] text-foreground sm:text-[46px] lg:text-[56px]">
            How can we help?
          </h1>
          <div className="mt-7 max-w-[720px]">
            <div className="flex items-center gap-3 rounded-md border border-border bg-background px-4 shadow-sm">
              <Search className="size-5 shrink-0 text-muted-foreground" />
              <label htmlFor="help-search" className="sr-only">
                Search help articles
              </label>
              <Input
                id="help-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search for an article, feature, or problem…"
                className="h-14 border-0 bg-transparent px-0 text-[16px] shadow-none focus-visible:ring-0"
              />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
              <span className="font-semibold text-foreground/70">Popular:</span>
              {POPULAR_SEARCHES.map((term) => (
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
        <h2 className="text-[22px] font-medium text-foreground">What do you need help with?</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CATEGORIES.map((item) => {
            const active = category === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setCategory(active ? null : item.key)}
                aria-pressed={active}
                className={`rounded-md border p-6 text-left transition-colors ${
                  active
                    ? "border-primary/50 bg-primary/5"
                    : "border-border hover:bg-white/50"
                }`}
              >
                <span className="grid size-10 place-items-center rounded-full bg-primary/10 text-primary">
                  <item.icon className="size-5" />
                </span>
                <p className="mt-4 text-[16px] font-semibold text-foreground">{item.key}</p>
                <p className="mt-1 text-[14px] text-foreground/70">{item.blurb}</p>
              </button>
            );
          })}
        </div>

        <div className="mt-14">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-[22px] font-medium text-foreground">
              {query || category ? "Results" : "Popular articles"}
            </h2>
            {(query || category) && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setCategory(null);
                }}
                className="text-[14px] font-medium text-primary hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
          {(query || category ? results : popular).length === 0 ? (
            <div className="mt-6 rounded-md border border-border p-8 text-center">
              <p className="text-[15px] font-medium text-foreground">No articles found</p>
              <p className="mt-1 text-[14px] text-foreground/70">
                Try different words, or contact support below and we&apos;ll help directly.
              </p>
            </div>
          ) : (
            <div className="mt-6 grid max-w-[860px] gap-3">
              {(query || category ? results : popular).map((article) => (
                <FaqItem key={article.title} question={article.title} answer={article.body} />
              ))}
            </div>
          )}
        </div>

        <div className="mt-14 rounded-md bg-black p-8 text-white sm:p-10">
          <h2 className="text-[22px] font-medium">Having a problem right now?</h2>
          <p className="mt-2 max-w-[620px] text-[14px] leading-[1.7] text-white/70">
            Start with the urgent issue closest to yours — each one jumps straight to the answer.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {URGENT.map((term) => (
              <button
                key={term}
                type="button"
                onClick={() => {
                  setQuery(term);
                  document
                    .getElementById("help-search")
                    ?.scrollIntoView({ behavior: "smooth", block: "center" });
                }}
                className="rounded-full border border-white/20 px-4 py-2 text-[13px] font-medium text-white/85 transition-colors hover:bg-white/10 hover:text-white"
              >
                {term}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-14 grid gap-4 md:grid-cols-2">
          <div className="rounded-md border border-border p-8">
            <h2 className="text-[20px] font-medium text-foreground">Still need help?</h2>
            <p className="mt-2 text-[14px] leading-[1.7] text-foreground/70">
              Our support team replies by email. Include your username and, for payment issues, the
              transaction reference from your receipt.
            </p>
            <Button asChild className="mt-5 h-11 rounded">
              <a href="mailto:support@starlitpay.xyz?subject=Starlit%20Pay%20support%20request">
                Contact Support
              </a>
            </Button>
          </div>
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-8">
            <div className="flex items-center gap-2 text-[16px] font-semibold text-foreground">
              <ShieldAlert className="size-5 text-amber-600" />
              Think your account or funds are at risk?
            </div>
            <p className="mt-2 text-[14px] leading-[1.7] text-foreground/75">
              Contact us immediately and stop interacting with suspicious links. We will never ask
              for your PIN, private keys, seed phrase, or authentication codes.
            </p>
            <Button asChild variant="secondary" className="mt-5 h-11 rounded">
              <a href="mailto:support@starlitpay.xyz?subject=URGENT%3A%20possible%20security%20issue">
                Report a security issue
              </a>
            </Button>
          </div>
        </div>
      </div>

      <SiteFooter />
      <ScrollToTopButton />
    </div>
  );
}

export default HelpPage;
