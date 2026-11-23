import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

import { SectionHeader } from "@/components/SectionHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { ScrollReveal } from "@/components/ScrollReveal";
import { ScrollToTopButton } from "@/components/ScrollToTopButton";
import { Button } from "@/components/ui/button";
import { FaqList } from "@/components/FaqList";
import { PRIVATE_VIEW, PUBLIC_VIEW, TRUST } from "@/content/site";
import { fetchStats } from "@/lib/backend";
import { container } from "@/lib/utils";

function StatCard({
  figure,
  title,
  caption,
  variant = "light",
}: {
  figure: string;
  title: string;
  caption: string;
  variant?: "light" | "primary";
}) {
  const isPrimary = variant === "primary";
  return (
    <div
      className={`flex min-h-[280px] flex-col rounded-md p-6 shadow-lg shadow-primary/10 sm:min-h-[420px] sm:p-8 ${
        isPrimary ? "stat-wash-primary" : "stat-wash"
      }`}
    >
      <p
        className={`text-[44px] font-medium leading-[1.05] tracking-normal ${
          isPrimary ? "text-primary-foreground" : "text-foreground"
        }`}
      >
        {figure}
      </p>
      <h3
        className={`mt-auto pt-7 text-[18px] font-semibold ${
          isPrimary ? "text-primary-foreground" : "text-foreground"
        }`}
      >
        {title}
      </h3>
      <p
        className={`mt-1 text-[16px] leading-[1.7] ${
          isPrimary ? "text-primary-foreground" : "text-foreground/75"
        }`}
      >
        {caption}
      </p>
    </div>
  );
}

function StepText({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h3 className="text-[19px] font-semibold text-foreground">{title}</h3>
      <p className="mt-3 text-[15px] leading-[1.7] text-foreground/75">{description}</p>
    </div>
  );
}

function FeatureCard({ title, image }: { title: string; image: string }) {
  return (
    <div className="relative aspect-[3/4] overflow-hidden rounded-md shadow-lg shadow-primary/10">
      <img
        src={image}
        alt={`${title} dashboard preview`}
        className="absolute inset-0 size-full object-cover"
        loading="lazy"
      />
      <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
      <h3 className="absolute inset-x-0 bottom-0 px-6 pb-6 text-[19px] font-semibold text-white">
        {title}
      </h3>
    </div>
  );
}

type Stats = Awaited<ReturnType<typeof fetchStats>>;

// While loading a figure shows "…"; if the stats cannot be loaded it shows "—".
function statCards(live: Stats | null, failed: boolean): { figure: string; title: string; caption: string; variant?: "light" | "primary" }[] {
  const pending = failed ? "—" : "…";
  const count = (n: number | undefined) => (typeof n === "number" ? n.toLocaleString("en-US") : pending);
  return [
    {
      figure: count(live?.zkProofsVerified),
      title: "Zero-Knowledge Proofs Verified",
      caption: "On chain · Stellar Testnet",
    },
    {
      figure: live?.tvlFormatted ?? pending,
      title: "Total Value Locked (TVL)",
      caption: "Private pools · XLM & USDC",
      variant: "primary",
    },
    {
      figure: count(live?.notesCommitted),
      title: "Notes Committed",
      caption: "Private pool Merkle trees",
    },
    {
      figure: "Testnet",
      title: "Preview Network",
      caption: "Not audited · No real funds",
    },
  ];
}

const steps = [
  {
    title: "Encrypted on Your Device",
    description:
      "Your payment details are locked safely on your device before sending. Your recipient's name, amount, and private info never leave your phone or computer unencrypted.",
  },
  {
    title: "Smart Proof Verification",
    description:
      "Your device creates a zero-knowledge proof that you have enough money for the payment. Stellar verifies it on chain without ever seeing your balance, your history, or your keys.",
  },
  {
    title: "Private Asset Vaults",
    description:
      "Payments are processed through secure digital vaults on the Stellar network. This disconnects your personal public wallet address from the payment, keeping your identity private.",
  },
  {
    title: "Zero Gas Fee Settlement",
    description:
      "Starlit submits your private payment to the Stellar network and pays the network fee for you, so you never need to hold XLM for gas.",
  },
  {
    title: "Direct & Private Delivery",
    description:
      "Money is delivered privately using secure digital keys. Only your chosen recipient can unlock and claim the incoming funds directly into their account balance.",
  },
  {
    title: "Optional Tax & Audit Keys",
    description:
      "Coming soon: share a read-only viewing key with your accountant or auditor for tax filing, without ever exposing your spending keys or wallet.",
  },
];

const features: { title: string; image: string }[] = [
  {
    title: "Total Privacy",
    image:
      "https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=900&q=70",
  },
  {
    title: "Zero Fees",
    image:
      "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?auto=format&fit=crop&w=900&q=70",
  },
  {
    title: "Complete Control",
    image:
      "https://images.unsplash.com/photo-1554224155-6726b3ff858f?auto=format&fit=crop&w=900&q=70",
  },
  {
    title: "Digital Dollars",
    image:
      "https://images.unsplash.com/photo-1579621970563-ebec7560ff3e?auto=format&fit=crop&w=900&q=70",
  },
];

function Index() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsFailed, setStatsFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchStats()
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch(() => {
        if (!cancelled) setStatsFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.title = "Starlit Pay: the private money app for the stablecoin era";
    document.documentElement.classList.remove("dark");
  }, []);

  return (
    <div className="relative overflow-x-clip">
      <SiteHeader />
      <div className="hero-wash relative -mt-28 pt-28">
        <main
          id="home"
          className="relative mx-auto w-full max-w-[1920px] px-7 pt-14 pb-2 sm:px-12 lg:px-[104px] lg:pt-[88px]"
        >
          <ScrollReveal>
            <section className="relative z-10 max-w-[960px]">
              <h1 className="max-w-[1050px] text-[34px] font-medium leading-[1.08] tracking-normal text-foreground sm:text-[46px] lg:text-[56px]">
                The private money app <br /> for the stablecoin era.
              </h1>
              <p className="mt-5 max-w-[680px] text-[14px] leading-[1.7] text-foreground/75 sm:text-[16px]">
                Hold dollars, pay anyone by username, and get paid, without making your finances
                public. Private payments, made simple.
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Button asChild className="cta-shadow h-12 rounded px-5 text-[15px]">
                  <Link id="demo" to="/auth">
                    Sign In{" "}
                    <span className="grid size-8 place-items-center rounded-full bg-primary-foreground text-primary">
                      <ArrowRight className="size-4" />
                    </span>
                  </Link>
                </Button>
              </div>
            </section>
          </ScrollReveal>
        </main>
      </div>

      <ScrollReveal>
        <section id="ecosystem" className={`${container} py-20 lg:py-24`}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {statCards(stats, statsFailed).map((stat) => (
              <StatCard key={stat.title} {...stat} />
            ))}
          </div>
        </section>
      </ScrollReveal>

      <ScrollReveal>
        <section id="about" className={`${container} py-20 lg:py-24`}>
          <SectionHeader title="Blockchains are public. Your money shouldn't be.">
            Stablecoins have made dollars faster, cheaper and more accessible than ever. But on most
            blockchains every payment is public: anyone can see what you earn, what you spend and
            what you hold. Starlit Pay gives you the simplicity of a modern payment app with the
            privacy of zero-knowledge cryptography, with no recovery phrases, no gas fees and no
            technical knowledge required.
          </SectionHeader>
          <div className="mt-10 grid gap-4 md:grid-cols-2">
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
                What Starlit Pay keeps private
              </p>
              <ul className="mt-4 grid gap-2 text-[15px] text-foreground/85">
                {PRIVATE_VIEW.map((line) => (
                  <li key={line}>→ {line}</li>
                ))}
              </ul>
            </div>
          </div>
          <p className="mt-6 text-[14px] text-foreground/70">
            We believe financial privacy is a right, and that privacy and accountability can coexist.{" "}
            <Link to="/about" className="font-medium text-primary hover:underline">
              More about Starlit Pay →
            </Link>
          </p>
        </section>
      </ScrollReveal>

      <ScrollReveal>
        <section id="how-it-works" className={`${container} py-20 lg:py-24`}>
          <SectionHeader title="How Privacy Works">
            Starlit Pay protects your transaction amounts, recipient identities, and balances with
            zero-knowledge proofs, made on your device and verified on chain by Stellar. It runs on
            testnet and has not been audited yet.
          </SectionHeader>

          <div className="mt-14 hidden lg:block">
            <div className="relative h-4">
              <div className="absolute top-1/2 left-[16.67%] right-0 -translate-y-1/2 border-t-[3px] border-dotted border-primary" />
              <span className="absolute top-1/2 left-1/3 size-0 -translate-x-1/2 -translate-y-1/2 border-y-[6px] border-l-[9px] border-y-transparent border-l-primary" />
              <span className="absolute top-1/2 left-2/3 size-0 -translate-x-1/2 -translate-y-1/2 border-y-[6px] border-l-[9px] border-y-transparent border-l-primary" />
              <span className="absolute top-0 left-[16.67%] size-4 -translate-x-1/2 rounded-full bg-primary" />
              <span className="absolute top-0 left-1/2 size-4 -translate-x-1/2 rounded-full bg-primary" />
              <span className="absolute top-0 left-[83.33%] size-4 -translate-x-1/2 rounded-full bg-primary" />
            </div>
            <div className="relative">
              <div className="absolute -top-2 bottom-2 right-0 border-l-[3px] border-dotted border-primary" />
              <div className="grid grid-cols-3">
                <div className="px-6 text-center">
                  <StepText {...steps[0]!} />
                </div>
                <div className="px-6 text-center">
                  <StepText {...steps[1]!} />
                </div>
                <div className="px-6 text-center">
                  <StepText {...steps[2]!} />
                </div>
              </div>
              <div className="relative mt-16 h-4">
                <div className="absolute top-1/2 left-[16.67%] right-0 -translate-y-1/2 border-t-[3px] border-dotted border-primary" />
                <span className="absolute top-1/2 left-1/3 size-0 -translate-x-1/2 -translate-y-1/2 border-y-[6px] border-r-[9px] border-y-transparent border-r-primary" />
                <span className="absolute top-1/2 left-2/3 size-0 -translate-x-1/2 -translate-y-1/2 border-y-[6px] border-r-[9px] border-y-transparent border-r-primary" />
                <span className="absolute top-0 left-[16.67%] size-4 -translate-x-1/2 rounded-full bg-primary" />
                <span className="absolute top-0 left-1/2 size-4 -translate-x-1/2 rounded-full bg-primary" />
                <span className="absolute top-0 left-[83.33%] size-4 -translate-x-1/2 rounded-full bg-primary" />
              </div>
            </div>
            <div className="grid grid-cols-3">
              <div className="px-6 text-center">
                <StepText {...steps[5]!} />
              </div>
              <div className="px-6 text-center">
                <StepText {...steps[4]!} />
              </div>
              <div className="px-6 text-center">
                <StepText {...steps[3]!} />
              </div>
            </div>
          </div>

          <div className="mt-12 ml-2 space-y-10 border-l-[3px] border-dotted border-primary pl-8 lg:hidden">
            {steps.map((step) => (
              <div key={step.title} className="relative">
                <span className="absolute top-1 size-4 -left-[41px] rounded-full bg-primary" />
                <StepText {...step} />
              </div>
            ))}
          </div>
        </section>
      </ScrollReveal>

      <ScrollReveal>
        <section id="product" className={`${container} py-20 lg:py-24`}>
          <SectionHeader title="Private Digital Payments" />
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {features.map((feature) => (
              <FeatureCard key={feature.title} {...feature} />
            ))}
          </div>
        </section>
      </ScrollReveal>

      <ScrollReveal>
        <section id="security" className={`${container} py-20 lg:py-24`}>
          <SectionHeader title="Built around trust, stated plainly." />
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {TRUST.map((item) => (
              <div key={item.title} className="rounded-md border border-border bg-background/40 p-6">
                <span className="grid size-10 place-items-center rounded-full bg-primary/10 text-primary">
                  <item.icon className="size-5" />
                </span>
                <p className="mt-4 text-[16px] font-semibold text-foreground">{item.title}</p>
                <p className="mt-2 text-[14px] leading-[1.7] text-foreground/75">{item.text}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 rounded-md border border-amber-500/30 bg-amber-500/5 p-5">
            <p className="text-[14px] font-semibold text-foreground">Live on testnet, not yet audited.</p>
            <p className="mt-1 max-w-[760px] text-[14px] leading-[1.7] text-foreground/75">
              Starlit Pay uses test tokens with no real-world value. An independent security audit comes
              before mainnet.{" "}
              <Link to="/terms#disclaimers" className="font-medium text-primary hover:underline">
                Read the risk notice →
              </Link>
            </p>
          </div>
        </section>
      </ScrollReveal>

      <ScrollReveal>
        <section id="faqs" className={`${container} py-20 lg:py-24`}>
          <SectionHeader title="Frequently Asked Questions" />
          <FaqList />
        </section>
      </ScrollReveal>

      <ScrollReveal>
        <section className={`${container} pb-24 lg:pb-32`}>
          <div className="hero-wash rounded-md px-7 py-14 text-center sm:px-12 lg:py-20">
            <h2 className="mx-auto max-w-[760px] text-[32px] font-medium leading-[1.15] text-primary sm:text-[40px] lg:text-[48px]">
              Ready for Private Payments?
            </h2>
            <p className="mx-auto mt-4 max-w-[560px] text-[16px] leading-[1.7] text-foreground/75">
              Set up your private digital wallet in seconds with no hidden fees.
            </p>
            <Button asChild className="cta-shadow mt-8 h-14 rounded px-6 text-[16px]">
              <Link to="/auth">
                Sign In{" "}
                <span className="grid size-8 place-items-center rounded-full bg-primary-foreground text-primary">
                  <ArrowRight className="size-4" />
                </span>
              </Link>
            </Button>
          </div>
        </section>
      </ScrollReveal>

      <ScrollReveal>
        <SiteFooter />
      </ScrollReveal>

      <ScrollToTopButton />
    </div>
  );
}

export default Index;
