import { useEffect } from "react";
import { Download, Scale, ShieldAlert, TriangleAlert } from "lucide-react";
import { jsPDF } from "jspdf";

import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/SectionHeader";
import { ScrollToTopButton } from "@/components/ScrollToTopButton";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { container } from "@/lib/utils";

type Block =
  | { type: "p"; text: string }
  | { type: "sub"; text: string }
  | { type: "list"; items: string[] }
  | { type: "callout"; icon: "terms" | "risk" | "shield"; title: string; text: string }
  | { type: "table"; head: [string, string]; rows: [string, string][] };

interface TermsSection {
  id: string;
  no: string;
  title: string;
  blocks: Block[];
}

const SECTIONS: TermsSection[] = [
  {
    id: "about",
    no: "01",
    title: "About These Terms",
    blocks: [
      {
        type: "p",
        text: "These Terms of Use (\"Terms\") form a legally binding agreement between you and Starlit Pay (\"we\", \"us\", or \"our\") governing your access to and use of our website at starlitpay.xyz, our web application and dashboard, our APIs, and related digital-asset payment services (together, the \"Services\").",
      },
      {
        type: "p",
        text: "By accessing or using the Services you agree to be bound by these Terms. If you do not agree, do not use Starlit Pay. Our Privacy Policy explains how we handle your information and forms part of this agreement.",
      },
    ],
  },
  {
    id: "eligibility",
    no: "02",
    title: "Eligibility",
    blocks: [
      {
        type: "p",
        text: "You may use the Services only if you are at least 18 years old, have the legal capacity to enter into a binding agreement, and your use does not violate any law or regulation that applies to you — including sanctions regimes and restrictions on digital-asset activity in your jurisdiction. Availability may differ by country, and we may restrict access where required.",
      },
    ],
  },
  {
    id: "account",
    no: "03",
    title: "Your Account",
    blocks: [
      {
        type: "p",
        text: "You sign in with a Google account and create a 6-digit payment PIN, which derives your wallet keys on your own device. You are responsible for everything done through your account, for keeping your PIN secret, and for the accuracy of the information you provide (one account per email address).",
      },
      {
        type: "callout",
        icon: "shield",
        title: "No PIN recovery",
        text: "Your PIN is never stored anywhere and cannot be recovered or reset by us. If you lose it, your wallet cannot be unlocked — store it somewhere safe when you create your account.",
      },
    ],
  },
  {
    id: "services",
    no: "04",
    title: "Our Services",
    blocks: [
      {
        type: "p",
        text: "Starlit Pay currently provides:",
      },
      {
        type: "list",
        items: [
          "A self-custodial shielded wallet showing private balances in USDC and XLM.",
          "Private peer-to-peer sends and receives settled on the Stellar Testnet.",
          "Shareable payment links for requesting funds.",
          "A testnet faucet dispensing test tokens for trying the product.",
          "Transaction history, receipts, and account statements.",
        ],
      },
      {
        type: "p",
        text: "Features marked \"Soon\" or \"Coming soon\" (such as asset swap) are not part of the Services until we release them.",
      },
    ],
  },
  {
    id: "wallets",
    no: "05",
    title: "Wallets & Digital Assets",
    blocks: [
      {
        type: "p",
        text: "Starlit Pay operates on the Stellar Testnet and supports XLM and USDC test tokens, which have no real-world value. Deposits to your shielded balance go through our deposit gateway address with your personal 6-digit memo, which routes the funds to you.",
      },
      {
        type: "list",
        items: [
          "Always verify the destination address, network, asset, and memo before sending — blockchain transactions are generally irreversible once confirmed.",
          "A payment sent to the wrong address, wrong network, or without your memo generally cannot be recovered.",
          "Failed or rejected transactions simply do not settle; nothing is debited for work that did not complete.",
          "Testnet networks may be reset or behave unpredictably; balances shown are test balances only.",
        ],
      },
      {
        type: "callout",
        icon: "risk",
        title: "Important risk notice",
        text: "Digital assets can be highly volatile and you may lose some or all of their value. Networks can congest, fork, or fail, and smart contracts can contain vulnerabilities. Never commit funds you cannot afford to lose.",
      },
    ],
  },
  {
    id: "payments",
    no: "06",
    title: "Payments & Transactions",
    blocks: [
      {
        type: "p",
        text: "A payment moves through initiation, authorization with your keys, shielding, and blockchain confirmation. Most Stellar payments confirm within seconds, while private-balance credits land once the gateway shields them — usually within a minute.",
      },
      {
        type: "p",
        text: "There are no reversals, refunds, or chargebacks on confirmed blockchain payments. If you overpay or pay the wrong person, recovery depends entirely on that person's cooperation.",
      },
    ],
  },
  {
    id: "fees",
    no: "07",
    title: "Fees",
    blocks: [
      {
        type: "p",
        text: "Starlit Pay charges no app fees, and Stellar network (gas) fees on your transactions are currently sponsored, so using the product on testnet costs you nothing. If a fee schedule is introduced in future, it will be published and will apply only from its stated effective date. Third-party network fees outside our control, where they exist, are yours to bear.",
      },
    ],
  },
  {
    id: "prohibited",
    no: "08",
    title: "Prohibited Activities",
    blocks: [
      {
        type: "p",
        text: "You must not use the Services to:",
      },
      {
        type: "list",
        items: [
          "Commit fraud, launder money, finance illegal activity, or evade sanctions.",
          "Manipulate markets or exploit vulnerabilities in the platform, contracts, or networks.",
          "Attack, disrupt, or probe the platform, or use unauthorized bots and scrapers.",
          "Reverse-engineer protected components, impersonate others, or use stolen credentials.",
          "Upload unlawful, abusive, or infringing content, or use the platform for any unlawful purpose.",
        ],
      },
    ],
  },
  {
    id: "third-parties",
    no: "09",
    title: "Third-Party Services",
    blocks: [
      {
        type: "p",
        text: "Parts of the Services depend on providers we do not control — including Google sign-in, Supabase infrastructure, the Stellar network, price and security-screening providers, and our hosting platforms. Their outages, changes, or terms may affect features, and their own terms and privacy policies apply to their part of the experience.",
      },
    ],
  },
  {
    id: "ip",
    no: "10",
    title: "Intellectual Property",
    blocks: [
      {
        type: "p",
        text: "The Starlit Pay name, logo, interface, code, content, and documentation are owned by us or our licensors. You receive a limited, revocable, non-transferable right to use the Services for their intended purpose — nothing here transfers ownership of any intellectual property to you.",
      },
    ],
  },
  {
    id: "user-content",
    no: "11",
    title: "User Content",
    blocks: [
      {
        type: "p",
        text: "You keep ownership of content you provide, such as your display name, profile photo, and payment descriptions or memos. By submitting it you grant us a worldwide license to store, display, and transmit it as needed to operate the Services (for example, showing your username to a payment-link recipient). You are responsible for ensuring your content is lawful and does not infringe anyone's rights.",
      },
    ],
  },
  {
    id: "availability",
    no: "12",
    title: "Service Availability",
    blocks: [
      {
        type: "p",
        text: "The Services may be interrupted by blockchain congestion, RPC or provider outages, network upgrades, smart-contract issues, maintenance, security incidents, or internet failures. We do not promise uninterrupted availability or any particular uptime level, and testnet behavior in particular is not guaranteed.",
      },
    ],
  },
  {
    id: "disclaimers",
    no: "13",
    title: "Disclaimers",
    blocks: [
      {
        type: "p",
        text: "To the extent permitted by applicable law, the Services are provided on an \"as is\" and \"as available\" basis. We do not promise uninterrupted service, any particular transaction speed, that every transaction will succeed, or anything about asset values or returns. Nothing here is financial, legal, tax, or investment advice.",
      },
    ],
  },
  {
    id: "liability",
    no: "14",
    title: "Limitation of Liability",
    blocks: [
      {
        type: "p",
        text: "To the maximum extent permitted by law, we are not liable for indirect, incidental, consequential, or punitive damages — including lost profits, market losses, lost digital assets, or losses from network, provider, or third-party failures — even if advised of their possibility. Our total liability for any claim connected to the Services is limited to the amounts you paid to use them (currently zero on testnet). Some jurisdictions do not allow these limitations, so they apply only to the extent the law permits.",
      },
    ],
  },
  {
    id: "indemnification",
    no: "15",
    title: "Indemnification",
    blocks: [
      {
        type: "p",
        text: "You agree to indemnify and hold us harmless against claims, losses, and expenses (including reasonable legal fees) arising from your violation of these Terms, your misuse of the Services, your unlawful activity, or your infringement of anyone's rights.",
      },
    ],
  },
  {
    id: "suspension",
    no: "16",
    title: "Suspension & Termination",
    blocks: [
      {
        type: "p",
        text: "We may suspend, restrict, or terminate your access — including holding or declining transactions — for fraud, security concerns, suspected Terms violations, sanctions exposure, or legal and regulatory requirements. On termination, pending actions may not complete; your data is handled as described in the Privacy Policy. Because your wallet keys are derived on your device, losing access to the app does not by itself destroy keys you still hold — but without them, funds cannot be moved.",
      },
    ],
  },
  {
    id: "disputes",
    no: "17",
    title: "Dispute Resolution",
    blocks: [
      {
        type: "p",
        text: "If you have a dispute, contact support@starlitpay.xyz first so we can try to resolve it informally. If that fails, the dispute is settled under applicable law in the venue stated in any future governing-law designation; until one is designated, the parties will seek resolution through good-faith negotiation and, failing that, the competent courts. Nothing here limits rights the law gives you as a consumer.",
      },
    ],
  },
  {
    id: "changes",
    no: "18",
    title: "Changes to These Terms",
    blocks: [
      {
        type: "p",
        text: "We may update these Terms as the Services evolve. Material changes take effect as stated in the notice published here, and continued use of Starlit Pay after the effective date means you accept the updated Terms. The Last updated date below always reflects the current version.",
      },
    ],
  },
  {
    id: "contact",
    no: "19",
    title: "Contact Us",
    blocks: [
      {
        type: "p",
        text: "Questions about these Terms or the Services go to support@starlitpay.xyz. Please include enough detail for us to identify your account, such as your Starlit username.",
      },
    ],
  },
];

const CALLOUT_ICONS = {
  terms: Scale,
  risk: TriangleAlert,
  shield: ShieldAlert,
} as const;

function downloadTermsPdf() {
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
    const lines = doc.splitTextToSize(text, width);
    for (const line of lines) {
      needPage(20);
      y += 15;
      doc.text(line, margin, y);
    }
    y += gap;
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor("#0f172a");
  doc.text("Starlit Pay — Terms of Use", margin, y);
  y += 8;
  paragraph("Last updated: October 6, 2026  •  Effective date: October 6, 2026", 10, false, 10);

  for (const section of SECTIONS) {
    needPage(60);
    y += 18;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor("#0f172a");
    doc.text(`${section.no}  ${section.title}`, margin, y);
    y += 6;
    for (const block of section.blocks) {
      if (block.type === "p") paragraph(block.text, 10, false, 4);
      else if (block.type === "sub") paragraph(block.text, 11, true, 2);
      else if (block.type === "list") {
        for (const item of block.items) paragraph(`•  ${item}`, 10, false, 2);
        y += 2;
      } else if (block.type === "callout") {
        paragraph(`[${block.title}] ${block.text}`, 10, false, 4);
      } else if (block.type === "table") {
        paragraph(`${block.head[0]} / ${block.head[1]}`, 10, true, 2);
        for (const [a, b] of block.rows) paragraph(`•  ${a} — ${b}`, 10, false, 2);
        y += 2;
      }
    }
  }
  doc.save("starlit-pay-terms-of-use.pdf");
}

function TermsBlock({ block }: { block: Block }) {
  if (block.type === "p") {
    return <p className="text-[15px] leading-[1.8] text-foreground/80">{block.text}</p>;
  }
  if (block.type === "sub") {
    return <h3 className="pt-2 text-[16px] font-semibold text-foreground">{block.text}</h3>;
  }
  if (block.type === "list") {
    return (
      <ul className="grid list-disc gap-2 pl-5 text-[15px] leading-[1.8] text-foreground/80">
        {block.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    );
  }
  if (block.type === "callout") {
    const Icon = CALLOUT_ICONS[block.icon];
    return (
      <div className="flex gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-amber-500/10 text-amber-600">
          <Icon className="size-4" />
        </span>
        <div>
          <p className="text-[14px] font-semibold text-foreground">{block.title}</p>
          <p className="mt-1 text-[14px] leading-[1.7] text-foreground/75">{block.text}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="table-scroll">
      <table className="w-full border-collapse text-left text-[14px]">
        <thead>
          <tr>
            {block.head.map((cell) => (
              <th
                key={cell}
                className="border-b border-border px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map(([a, b]) => (
            <tr key={`${a}-${b}`} className="border-b border-border/60">
              <td className="px-3 py-2.5 font-medium text-foreground">{a}</td>
              <td className="px-3 py-2.5 text-foreground/75">{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TermsPage() {
  useEffect(() => {
    document.title = "Terms of Use — Starlit Pay";
  }, []);

  return (
    <div className="relative overflow-x-clip [scroll-behavior:smooth]">
      <SiteHeader />
      <div className="hero-wash relative -mt-28 pt-28">
        <div className={`${container} pt-14 pb-10 lg:pt-[88px]`}>
          <h1 className="max-w-[900px] text-[34px] font-medium leading-[1.08] text-foreground sm:text-[46px] lg:text-[56px]">
            Terms of Use
          </h1>
          <p className="mt-5 max-w-[680px] text-[14px] leading-[1.7] text-foreground/75 sm:text-[16px]">
            These Terms govern your access to and use of Starlit Pay&apos;s website, application,
            and financial services. Please read them carefully before using the platform.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <Button
              type="button"
              variant="secondary"
              className="h-11 rounded"
              onClick={downloadTermsPdf}
            >
              <Download /> Download PDF
            </Button>
            <p className="text-[13px] text-foreground/70">
              Last updated: October 6, 2026 · Effective date: October 6, 2026
            </p>
          </div>
        </div>
      </div>

      <div className={`${container} py-14 lg:py-20`}>
        <details className="mb-10 rounded-md border border-border p-4 md:hidden">
          <summary className="cursor-pointer text-[15px] font-semibold text-foreground">
            Contents
          </summary>
          <nav aria-label="Terms contents" className="mt-3 grid gap-1">
            {SECTIONS.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className="rounded px-2 py-2 text-[14px] text-foreground/75 transition-colors hover:bg-white/50"
              >
                <span className="mr-2 font-mono text-[12px] text-primary">{section.no}</span>
                {section.title}
              </a>
            ))}
          </nav>
        </details>

        <div className="grid gap-12 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-16">
          <aside className="hidden lg:block">
            <nav
              aria-label="Terms contents"
              className="sticky top-24 grid max-h-[calc(100vh-8rem)] gap-1 overflow-y-auto border-l border-border pl-4"
            >
              {SECTIONS.map((section) => (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  className="rounded px-2 py-1.5 text-[13px] text-foreground/70 transition-colors hover:bg-white/50 hover:text-foreground"
                >
                  <span className="mr-2 font-mono text-[11px] text-primary">{section.no}</span>
                  {section.title}
                </a>
              ))}
            </nav>
          </aside>

          <article className="grid min-w-0 gap-12">
            {SECTIONS.map((section) => (
              <section key={section.id} id={section.id} className="scroll-mt-28">
                <p className="font-mono text-[12px] text-primary">{section.no}</p>
                <h2 className="mt-1 text-[26px] font-medium text-foreground sm:text-[30px]">
                  {section.title}
                </h2>
                <div className="mt-4 grid gap-4">
                  {section.blocks.map((block, i) => (
                    <TermsBlock key={`${section.id}-${i}`} block={block} />
                  ))}
                </div>
              </section>
            ))}

            <section className="rounded-md bg-black p-8 text-white sm:p-10">
              <h2 className="text-[22px] font-medium">Questions about these Terms?</h2>
              <p className="mt-2 max-w-[560px] text-[14px] leading-[1.7] text-white/70">
                Contact our team and we will do our best to help — including informal resolution
                before anything formal.
              </p>
              <Button asChild className="mt-5 h-11 rounded">
                <a href="mailto:support@starlitpay.xyz">support@starlitpay.xyz</a>
              </Button>
            </section>
          </article>
        </div>
      </div>

      <SiteFooter />
      <ScrollToTopButton />
    </div>
  );
}

export default TermsPage;
