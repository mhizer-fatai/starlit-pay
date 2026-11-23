import { useEffect } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Eye,
  Globe,
  Layers,
  Lock,
  ScanEye,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollToTopButton } from "@/components/ScrollToTopButton";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { PRIVATE_VIEW, PUBLIC_VIEW, TRUST } from "@/content/site";
import { container } from "@/lib/utils";

const BELIEFS = [
  {
    no: "01",
    title: "ACCESSIBLE",
    text: "Financial privacy shouldn't require understanding cryptography. If you can send a message, you can send a private payment.",
  },
  {
    no: "02",
    title: "TRANSPARENT",
    text: "You should always know where your money goes, what something costs, and what the app does with your data.",
  },
  {
    no: "03",
    title: "USEFUL",
    text: "Privacy technology should solve real problems — hiding balances, recipients, and amounts from public view.",
  },
  {
    no: "04",
    title: "PRIVATE BY DEFAULT",
    text: "Privacy isn't a toggle buried in settings. Every payment on Starlit Pay is shielded automatically.",
  },
];

const BUILDING = [
  {
    icon: Zap,
    title: "Pay",
    text: "Send shielded payments to any Starlit username in seconds — amounts and recipients stay hidden from public explorers.",
  },
  {
    icon: ScanEye,
    title: "Receive",
    text: "Share your username or deposit code. Funds land in your private balance, visible only to you.",
  },
  {
    icon: Layers,
    title: "Request",
    text: "Create shareable payment links to ask anyone for money, with receipts for every transaction.",
  },
  {
    icon: Eye,
    title: "Track",
    text: "Watch balances, history, and statements in one dashboard — your data, decrypted only on your device.",
  },
];

const STEPS = [
  {
    no: "01",
    title: "Create",
    text: "Confirm your email with Google, create a passkey, and save your recovery code. Your keys live in a vault encrypted on your device — no recovery phrase to lose.",
  },
  {
    no: "02",
    title: "Fund",
    text: "Claim test funds from the faucet, or deposit from any Stellar wallet with your personal memo. Your device adds them to your private balance.",
  },
  {
    no: "03",
    title: "Pay",
    text: "Send to a username. Your device proves the payment with a zero-knowledge proof, Stellar verifies it on chain, and the new note is encrypted so only the recipient can open it.",
  },
  {
    no: "04",
    title: "Track",
    text: "Follow everything in your dashboard — balances, receipts, and downloadable statements.",
  },
];

const CHAIN_POINTS = [
  {
    icon: Zap,
    title: "Fast & cheap",
    text: "Stellar settles in about 5 seconds for a fraction of a cent — and network fees on Starlit Pay are sponsored.",
  },
  {
    icon: Eye,
    title: "Verifiable",
    text: "The shared pool is visible on-chain for anyone to audit, while individual payments stay private inside it.",
  },
  {
    icon: Globe,
    title: "Global",
    text: "Stablecoins move across borders and banking systems, 24/7, without intermediaries taking a cut.",
  },
  {
    icon: Lock,
    title: "Programmable",
    text: "Soroban contracts hold the pools, verify every zero-knowledge proof on chain, and reject notes that were already spent.",
  },
];

const ROADMAP = [
  {
    phase: "TODAY",
    items: "Private payments · Payment links · Shielded balances · Statements · Testnet faucet",
  },
  {
    phase: "NEXT",
    items: "Asset swap · Mainnet launch · More Stellar assets",
  },
  {
    phase: "FUTURE",
    items: "Broader financial products · Wider network integrations",
  },
];

function AboutPage() {
  useEffect(() => {
    document.title = "About Starlit Pay";
  }, []);

  return (
    <div className="relative overflow-x-clip">
      <SiteHeader />

      <div className="hero-wash relative -mt-28 pt-28">
        <div className={`${container} pt-14 pb-14 lg:pt-[88px] lg:pb-16`}>
          <h1 className="mt-3 max-w-[1000px] text-[34px] font-medium leading-[1.08] text-foreground sm:text-[46px] lg:text-[60px]">
            The private money app for the stablecoin era.
          </h1>
          <p className="mt-5 max-w-[680px] text-[14px] leading-[1.7] text-foreground/75 sm:text-[16px]">
            Stablecoins have made dollars faster, cheaper and more accessible than ever. But on most
            blockchains, every payment is public: anyone can see what you earn, what you spend and
            what you hold.
          </p>
          <p className="mt-4 max-w-[680px] text-[14px] leading-[1.7] text-foreground/75 sm:text-[16px]">
            Starlit Pay exists to change that: a place to hold dollars, pay people and get paid with
            the simplicity of a modern payment app and the privacy of zero-knowledge cryptography. No
            recovery phrases, no gas fees, no technical knowledge required. We believe financial
            privacy is a right, and that privacy and accountability can coexist, so Starlit Pay is
            designed to work with compliance, not against it.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Button asChild className="cta-shadow h-12 rounded px-5 text-[15px]">
              <Link to="/auth">
                Explore the platform{" "}
                <span className="grid size-8 place-items-center rounded-full bg-primary-foreground text-primary">
                  <ArrowRight className="size-4" />
                </span>
              </Link>
            </Button>
            <Button
              asChild
              variant="secondary"
              className="h-12 rounded bg-background/40 px-5 text-[15px] text-foreground/80 hover:bg-background/60"
            >
              <Link to="/faqs">How it works</Link>
            </Button>
          </div>
        </div>
      </div>

      <div className={`${container} py-14 lg:py-20`}>
        <h2 className="mt-3 max-w-[760px] text-[28px] font-medium leading-[1.12] text-foreground sm:text-[36px]">
          The future of finance should belong to everyone using it.
        </h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {BELIEFS.map((belief) => (
            <div key={belief.no} className="rounded-md border border-border p-6">
              <p className="font-mono text-[12px] text-primary">{belief.no}</p>
              <p className="mt-2 text-[15px] font-semibold tracking-wide text-foreground">
                {belief.title}
              </p>
              <p className="mt-2 text-[14px] leading-[1.7] text-foreground/75">{belief.text}</p>
            </div>
          ))}
        </div>
      </div>

      <div className={`${container} pb-14 lg:pb-20`}>
        <h2 className="mt-3 max-w-[760px] text-[28px] font-medium leading-[1.12] text-foreground sm:text-[36px]">
          Blockchains are public. Your life shouldn&apos;t have to be.
        </h2>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <div className="rounded-md bg-black p-8 text-white sm:p-10">
            <p className="text-[13px] font-semibold uppercase tracking-[0.18em] text-white/60">
              What everyone sees today
            </p>
            <ul className="mt-4 grid gap-2 text-[15px] text-white/85">
              {PUBLIC_VIEW.map((line) => (
                <li key={line}>→ {line}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-md border border-primary/25 bg-primary/5 p-8 sm:p-10">
            <p className="text-[13px] font-semibold uppercase tracking-[0.18em] text-primary">
              What Starlit Pay hides
            </p>
            <ul className="mt-4 grid gap-2 text-[15px] text-foreground/85">
              {PRIVATE_VIEW.map((line) => (
                <li key={line}>→ {line}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className={`${container} pb-14 lg:pb-20`}>
        <h2 className="mt-3 max-w-[760px] text-[28px] font-medium leading-[1.12] text-foreground sm:text-[36px]">
          One platform. Every part private.
        </h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {BUILDING.map((feature) => (
            <div key={feature.title} className="rounded-md border border-border p-6">
              <span className="grid size-10 place-items-center rounded-full bg-primary/10 text-primary">
                <feature.icon className="size-5" />
              </span>
              <p className="mt-4 text-[16px] font-semibold text-foreground">{feature.title}</p>
              <p className="mt-2 text-[14px] leading-[1.7] text-foreground/75">{feature.text}</p>
            </div>
          ))}
        </div>
      </div>

      <div className={`${container} pb-14 lg:pb-20`}>
        <h2 className="mt-3 max-w-[760px] text-[28px] font-medium leading-[1.12] text-foreground sm:text-[36px]">
          From signup to shielded in minutes.
        </h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step) => (
            <div key={step.no} className="rounded-md bg-black p-6 text-white sm:p-7">
              <p className="font-mono text-[12px] text-white/50">{step.no}</p>
              <p className="mt-2 text-[16px] font-semibold">{step.title}</p>
              <p className="mt-2 text-[14px] leading-[1.7] text-white/70">{step.text}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-black text-white">
        <div className={`${container} py-14 lg:py-20`}>
          <h2 className="mt-3 max-w-[760px] text-[28px] font-medium leading-[1.12] sm:text-[36px]">
            Used where it earns its place — not for the sake of it.
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {CHAIN_POINTS.map((point) => (
              <div key={point.title} className="rounded-md border border-white/15 p-6">
                <span className="grid size-10 place-items-center rounded-full bg-white/10 text-white">
                  <point.icon className="size-5" />
                </span>
                <p className="mt-4 text-[16px] font-semibold">{point.title}</p>
                <p className="mt-2 text-[14px] leading-[1.7] text-white/70">{point.text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className={`${container} py-14 lg:py-20`}>
        <h2 className="mt-3 max-w-[760px] text-[28px] font-medium leading-[1.12] text-foreground sm:text-[36px]">
          Built around trust, stated plainly.
        </h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {TRUST.map((item) => (
            <div key={item.title} className="rounded-md border border-border p-6">
              <span className="grid size-10 place-items-center rounded-full bg-primary/10 text-primary">
                <item.icon className="size-5" />
              </span>
              <p className="mt-4 text-[16px] font-semibold text-foreground">{item.title}</p>
              <p className="mt-2 text-[14px] leading-[1.7] text-foreground/75">{item.text}</p>
            </div>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap gap-3 text-[14px] font-medium">
          <Link to="/privacy" className="text-primary hover:underline">
            Privacy Policy →
          </Link>
          <Link to="/terms" className="text-primary hover:underline">
            Terms of Use →
          </Link>
          <Link to="/cookies" className="text-primary hover:underline">
            Cookie Policy →
          </Link>
        </div>
        <div className="mt-10 rounded-md border border-amber-500/30 bg-amber-500/5 p-5">
          <p className="text-[14px] font-semibold text-foreground">
            Innovation shouldn&apos;t hide the risks.
          </p>
          <p className="mt-1 max-w-[720px] text-[14px] leading-[1.7] text-foreground/75">
            Digital assets are volatile, networks can fail, and testnet tokens carry no value.
            Understand both the opportunity and the risk before moving money.{" "}
            <Link to="/terms#disclaimers" className="font-medium text-primary hover:underline">
              Read the risk notice →
            </Link>
          </p>
        </div>
      </div>

      <div className={`${container} pb-14 lg:pb-20`}>
        <h2 className="mt-3 max-w-[760px] text-[28px] font-medium leading-[1.12] text-foreground sm:text-[36px]">
          Built by people who care about better financial products.
        </h2>
        <p className="mt-4 max-w-[680px] text-[15px] leading-[1.8] text-foreground/75">
          Starlit Pay is an early-stage team of designers and engineers working in the open —
          shipping a real product on testnet, documenting how it works, and letting the cryptography
          speak for itself.
        </p>
      </div>

      <div className={`${container} pb-14 lg:pb-20`}>
        <h2 className="mt-3 max-w-[760px] text-[28px] font-medium leading-[1.12] text-foreground sm:text-[36px]">
          Today private payments. Tomorrow more.
        </h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {ROADMAP.map((stage) => (
            <div key={stage.phase} className="rounded-md border border-border p-6">
              <p className="font-mono text-[12px] text-primary">{stage.phase}</p>
              <p className="mt-2 text-[14px] leading-[1.8] text-foreground/80">{stage.items}</p>
            </div>
          ))}
        </div>
      </div>

      <div className={`${container} pb-14 lg:pb-20`}>
        <div className="hero-wash rounded-md px-7 py-14 text-center sm:px-12 lg:py-20">
          <h2 className="mx-auto max-w-[640px] text-[28px] font-medium leading-[1.12] text-foreground sm:text-[36px]">
            Your money should do more — starting with staying yours.
          </h2>
          <Button asChild className="cta-shadow mt-8 h-14 rounded px-6 text-[16px]">
            <Link to="/auth">
              Get Started{" "}
              <span className="grid size-8 place-items-center rounded-full bg-primary-foreground text-primary">
                <ArrowRight className="size-4" />
              </span>
            </Link>
          </Button>
        </div>
      </div>

      <SiteFooter />
      <ScrollToTopButton />
    </div>
  );
}

export default AboutPage;
