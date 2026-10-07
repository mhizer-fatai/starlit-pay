import { useEffect } from "react";
import { Download, Globe, Link2, Lock, ShieldCheck } from "lucide-react";
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
  | { type: "callout"; icon: "lock" | "chain" | "id" | "globe"; title: string; text: string }
  | { type: "table"; head: [string, string]; rows: [string, string][] };

interface PolicySection {
  id: string;
  no: string;
  title: string;
  blocks: Block[];
}

const SECTIONS: PolicySection[] = [
  {
    id: "introduction",
    no: "01",
    title: "Introduction",
    blocks: [
      {
        type: "p",
        text: "This Privacy Policy explains how Starlit Pay (\"we\", \"us\", or \"our\") collects, uses, stores, discloses, and protects personal information when you access or use our website at starlitpay.xyz, our web application and dashboard, our APIs, and related digital-asset payment services (together, the \"Services\").",
      },
      {
        type: "p",
        text: "It applies to everyone who uses the Services. By using Starlit Pay you also agree to our Terms of Service; where the two conflict on privacy matters, this Policy controls. Third-party services we rely on (for example Google sign-in or the Stellar network) have their own privacy policies, which we do not control.",
      },
    ],
  },
  {
    id: "who-we-are",
    no: "02",
    title: "Who We Are",
    blocks: [
      {
        type: "p",
        text: "Starlit Pay is a self-custodial, privacy-preserving payments application currently operating on the Stellar Testnet. The product uses test tokens with no real-world value while in this phase. For any privacy question you can reach us at support@starlitpay.xyz.",
      },
    ],
  },
  {
    id: "information-we-collect",
    no: "03",
    title: "Information We Collect",
    blocks: [
      { type: "sub", text: "Information you provide" },
      {
        type: "list",
        items: [
          "Account details: display name, username, and email address (verified through Google sign-in).",
          "Profile photo where available (your Google picture, otherwise a generated default avatar).",
          "Preferences you set, such as language, currency, and notification or security settings.",
          "Messages you send to support, including their contents and metadata.",
        ],
      },
      { type: "sub", text: "Wallet information" },
      {
        type: "list",
        items: [
          "Your Stellar public (deposit) address and deposit memo used to route incoming funds.",
          "One-way cryptographic commitments derived from your keys, used only to verify your payment PIN.",
          "Your public viewing key, used to look up your encrypted payment notes.",
          "Asset types and amounts attached to your shielded payment notes (stored encrypted — see below).",
        ],
      },
      {
        type: "callout",
        icon: "lock",
        title: "Private keys stay with you",
        text: "We never collect, transmit, or store your private keys, recovery phrases, or your 6-digit payment PIN. Your PIN never leaves your device; only a one-way hash of a derived key is ever sent to our servers for verification.",
      },
      { type: "sub", text: "Identity verification" },
      {
        type: "p",
        text: "Starlit Pay does not currently require KYC identity documents (no government ID, selfies, or proof of address). The only identity signal we receive is the verified email address Google shares when you sign in.",
      },
      { type: "sub", text: "Device and technical information" },
      {
        type: "list",
        items: [
          "IP address, browser type, operating system, and device identifiers.",
          "Login timestamps, pages visited, and feature usage.",
          "Error and diagnostic logs needed to keep the Services reliable.",
        ],
      },
      { type: "sub", text: "Financial and transaction information" },
      {
        type: "list",
        items: [
          "Deposits, sends, payment links, and faucet claims, including counterparties, amounts, assets, and timestamps.",
          "Encrypted shielded-note payloads cached so your devices can sync balances. These ciphertexts cannot be read by us — only your viewing key decrypts them.",
        ],
      },
    ],
  },
  {
    id: "how-we-use",
    no: "04",
    title: "How We Use Your Information",
    blocks: [
      {
        type: "table",
        head: ["Purpose", "Information used"],
        rows: [
          ["Create and manage your account", "Account information"],
          ["Process transactions", "Wallet and transaction data"],
          ["Verify your payment PIN", "One-way key commitments"],
          ["Prevent fraud and abuse", "Account, device, and transaction data"],
          ["Secure the platform", "Device, IP, and activity data"],
          ["Provide customer support", "Contact and support data"],
          ["Improve our services", "Usage and technical data"],
          ["Meet legal obligations", "Identity and transaction data"],
          ["Send service communications", "Contact information"],
        ],
      },
      {
        type: "p",
        text: "Where data-protection law requires a legal basis, we rely on: performance of our contract with you (operating your account and payments); legal obligations (fraud prevention, financial record-keeping); our legitimate interests (security, reliability, product improvement); and your consent (optional marketing and any non-essential tracking).",
      },
    ],
  },
  {
    id: "blockchain",
    no: "05",
    title: "Blockchain & On-Chain Data",
    blocks: [
      {
        type: "p",
        text: "Payments on Starlit Pay settle on the Stellar network, a public, decentralized blockchain. To move funds, certain data — such as sending and receiving addresses, memos, amounts, assets, and transaction hashes — is broadcast to the network and recorded on the public ledger.",
      },
      {
        type: "table",
        head: ["What we control", "What we don't control"],
        rows: [
          ["Account information", "Public blockchain records"],
          ["Email and preferences", "On-chain transaction history"],
          ["Support messages", "Wallet addresses on-chain"],
          ["Encrypted note cache", "Transaction hashes and ledger entries"],
        ],
      },
      {
        type: "callout",
        icon: "chain",
        title: "On-chain data is permanent",
        text: "Records written to a public blockchain are public, permanent, and outside our control. We cannot modify, hide, or delete them — including in response to a deletion request.",
      },
    ],
  },
  {
    id: "cookies",
    no: "06",
    title: "Cookies & Local Storage",
    blocks: [
      {
        type: "p",
        text: "Starlit Pay primarily uses your browser's local storage rather than cookies: your login session, account profile copy, notification read-state, and faucet cooldown markers. Our testnet faucet uses a Cloudflare security challenge. We run no advertising trackers. You can clear site data in your browser settings at any time, though you will be signed out and will need your PIN to unlock your wallet again.",
      },
    ],
  },
  {
    id: "sharing",
    no: "07",
    title: "How We Share Information",
    blocks: [
      {
        type: "list",
        items: [
          "Service providers that operate infrastructure on our behalf (hosting, authentication, database, security screening).",
          "Blockchain networks: the transaction data necessary to execute your payments is broadcast publicly, as described above.",
          "Regulators and law-enforcement authorities where we are legally required to comply.",
          "Professional advisers such as lawyers and auditors under confidentiality obligations.",
          "A buyer or successor in a merger, acquisition, or restructuring, with notice to you where required.",
        ],
      },
      {
        type: "p",
        text: "We do not sell your personal information.",
      },
    ],
  },
  {
    id: "third-parties",
    no: "08",
    title: "Third-Party Services",
    blocks: [
      {
        type: "table",
        head: ["Category", "Purpose"],
        rows: [
          ["Google", "Sign-in identity verification"],
          ["Supabase", "Authentication sessions and application database"],
          ["Stellar Testnet / RPC", "Ledger access and transaction submission"],
          ["CoinGecko (via our servers)", "Market price data"],
          ["Cloudflare Turnstile", "Faucet anti-abuse challenge"],
          ["Render / Netlify", "Backend and website hosting"],
          ["DiceBear", "Default avatar images, loaded only when displayed"],
        ],
      },
      {
        type: "p",
        text: "Each of these providers processes information under its own privacy policy. Market prices are fetched through our servers so your browser never contacts price providers directly.",
      },
    ],
  },
  {
    id: "retention",
    no: "09",
    title: "Data Retention",
    blocks: [
      {
        type: "list",
        items: [
          "Account data: kept while your account remains active.",
          "Support messages: kept as long as needed to resolve your request and meet record-keeping duties.",
          "Preferences: kept until you change or delete them.",
          "Marketing: kept until you withdraw consent.",
          "On-chain records: permanent and outside our control, as described above.",
        ],
      },
    ],
  },
  {
    id: "security",
    no: "10",
    title: "Data Security",
    blocks: [
      {
        type: "p",
        text: "We use reasonable technical and organizational measures designed to protect personal information: encrypted connections, authenticated APIs, PIN-derived wallet keys that never leave your device, one-way commitments instead of stored secrets, and restricted infrastructure access with logging and monitoring.",
      },
      {
        type: "p",
        text: "No method of transmission or storage is completely secure, so we cannot guarantee absolute security. Protect your payment PIN as you would a password: anyone who learns both your email and PIN can access your wallet.",
      },
    ],
  },
  {
    id: "rights",
    no: "11",
    title: "Your Privacy Rights",
    blocks: [
      {
        type: "p",
        text: "Depending on where you live, you may have the right to access, correct, or delete your personal information; to receive a portable copy; to restrict or object to certain processing; to withdraw consent; to opt out of marketing; and to complain to a data-protection regulator.",
      },
      {
        type: "p",
        text: "To exercise any of these rights, contact support@starlitpay.xyz and we will respond within the timeframes the law requires.",
      },
      {
        type: "callout",
        icon: "id",
        title: "Blockchain limitation",
        text: "Deletion, correction, and portability rights apply to information we hold. They cannot be applied to public blockchain records, which are immutable and replicated across a decentralized network.",
      },
    ],
  },
  {
    id: "transfers",
    no: "12",
    title: "International Data Transfers",
    blocks: [
      {
        type: "p",
        text: "Our infrastructure and service providers may process information in countries other than your own. Where the law requires safeguards for such transfers, we rely on the mechanisms our providers offer, such as standard contractual clauses and equivalent protections.",
      },
      {
        type: "callout",
        icon: "globe",
        title: "Global by design",
        text: "Blockchains are global networks: on-chain transaction data is visible from every country by design.",
      },
    ],
  },
  {
    id: "children",
    no: "13",
    title: "Children's Privacy",
    blocks: [
      {
        type: "p",
        text: "The Services are not intended for anyone under 18, and we do not knowingly collect personal information from children. If you believe a child has provided us information, contact support@starlitpay.xyz and we will delete it.",
      },
    ],
  },
  {
    id: "changes",
    no: "14",
    title: "Changes to This Policy",
    blocks: [
      {
        type: "p",
        text: "We may update this Policy as the Services evolve. Material changes take effect as stated in the notice we publish here, and continued use of Starlit Pay after the effective date means you accept the updated Policy. The Last updated date below always reflects the current version.",
      },
    ],
  },
  {
    id: "contact",
    no: "15",
    title: "Contact Us",
    blocks: [
      {
        type: "p",
        text: "Questions about this Policy, or requests to exercise your privacy rights, go to our privacy team at support@starlitpay.xyz. Please include enough detail for us to identify your account, such as your Starlit username.",
      },
    ],
  },
];

const CALLOUT_ICONS = {
  lock: Lock,
  chain: Link2,
  id: ShieldCheck,
  globe: Globe,
} as const;

function downloadPolicyPdf() {
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
  doc.text("Starlit Pay — Privacy Policy", margin, y);
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
  doc.save("starlit-pay-privacy-policy.pdf");
}

function PolicyBlock({ block }: { block: Block }) {
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
      <div className="flex gap-3 rounded-md border border-primary/25 bg-primary/5 p-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
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

function PrivacyPage() {
  useEffect(() => {
    document.title = "Privacy Policy — Starlit Pay";
  }, []);

  return (
    <div className="relative overflow-x-clip [scroll-behavior:smooth]">
      <SiteHeader />
      <div className="hero-wash relative -mt-28 pt-28">
        <div className={`${container} pt-14 pb-10 lg:pt-[88px]`}>
          <h1 className="max-w-[900px] text-[34px] font-medium leading-[1.08] text-foreground sm:text-[46px] lg:text-[56px]">
            Privacy Policy
          </h1>
          <p className="mt-5 max-w-[680px] text-[14px] leading-[1.7] text-foreground/75 sm:text-[16px]">
            We respect your privacy and are committed to protecting the information you share with
            us. This policy explains how Starlit Pay collects, uses, shares, and protects your
            information.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <Button
              type="button"
              variant="secondary"
              className="h-11 rounded"
              onClick={downloadPolicyPdf}
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
          <nav aria-label="Policy contents" className="mt-3 grid gap-1">
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
              aria-label="Policy contents"
              className="sticky top-24 grid gap-1 border-l border-border pl-4"
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
                    <PolicyBlock
                      key={`${section.id}-${i}`}
                      block={block}
                    />
                  ))}
                </div>
              </section>
            ))}

            <section className="rounded-md bg-black p-8 text-white sm:p-10">
              <h2 className="text-[22px] font-medium">Questions about your privacy?</h2>
              <p className="mt-2 max-w-[560px] text-[14px] leading-[1.7] text-white/70">
                Contact our privacy team to ask a question or exercise your rights — access,
                correction, deletion, portability, and the rest.
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

export default PrivacyPage;
