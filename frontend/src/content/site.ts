// Copy shared by the landing page, About and FAQs, so they never disagree.

import { EyeOff, ScanEye, ShieldCheck, Sparkles, type LucideIcon } from "lucide-react";

export interface Faq {
  question: string;
  answer: string;
}

export const FAQS: Faq[] = [
  {
    question: "How do private transactions work?",
    answer:
      "Your money sits in a shared private pool on Stellar as sealed notes that only your keys can open. When you pay, your device makes a zero-knowledge proof that you own enough, without revealing who you are, who you pay or how much. Stellar verifies the proof on chain, and the person you pay receives a new sealed note only they can open.",
  },
  {
    question: "What assets are supported inside Starlit Pay?",
    answer:
      "Starlit Pay currently supports USDC, a dollar stablecoin, and XLM, the native asset of the Stellar network. Support for more Stellar assets is on our roadmap.",
  },
  {
    question: "How are network fees sponsored?",
    answer:
      "Starlit pays the Stellar network fee for every private payment, so you never need to hold XLM for gas. A small privacy-pool fee is shown before you confirm a payment.",
  },
  {
    question: "Are my private keys stored on Starlit servers?",
    answer:
      "Not in readable form. Your keys are kept in a vault encrypted on your device, which only your passkey, your PIN or your recovery code can open. We store the vault only in encrypted form, and zero-knowledge proofs are made on your device.",
  },
  {
    question: "Is Starlit Pay open-source and audited?",
    answer:
      "Not yet audited. Starlit Pay runs on the Stellar test network only, so do not use real funds. Its privacy technology is built on Nethermind's open-source Stellar Private Payments, and an independent audit is planned before any mainnet launch.",
  },
  {
    question: "What happens if I forget my PIN or lose my phone?",
    answer:
      "You can unlock your wallet with any of your passkey, your PIN, or your one-time recovery code, so losing one is not the end. We cannot open your vault or reset it for you, though: if you lose all three, your wallet cannot be recovered. Keep your recovery code somewhere safe.",
  },
  {
    question: "How fast are payments?",
    answer:
      "A private payment is proven on your device, which can take up to a minute, then settles on Stellar in seconds. Deposits from other wallets are added to your private balance the next time you open the app, and you will see them in your activity feed.",
  },
  {
    question: "How do I receive payments from someone?",
    answer:
      "Share your Starlit username, a payment link, or your deposit address with its memo. Starlit users pay you privately by username; anyone else can pay from any Stellar wallet, and the funds are added to your private balance the next time you open the app.",
  },
  {
    question: "Is Starlit Pay free to use?",
    answer:
      "Yes. There are no app fees and network fees are covered, so on testnet sending and receiving costs you nothing beyond the small privacy-pool fee shown before you confirm.",
  },
  {
    question: "Which Stellar network is supported?",
    answer:
      "Starlit Pay currently runs on the Stellar test network, which uses test tokens with no real-world value. Mainnet support will follow an independent security audit.",
  },
];

/** What a public chain shows about you, and what Starlit Pay keeps private. */
export const PUBLIC_VIEW = [
  "Balances on public explorers",
  "Who paid whom, and how much",
  "Salary, habits, and history for anyone to read",
];

export const PRIVATE_VIEW = [
  "Private balances, readable only on your device",
  "Recipients and amounts, hidden inside zero-knowledge proofs",
  "One shared pool on chain, individual payments invisible",
];

export const TRUST: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: ShieldCheck,
    title: "Security",
    text: "Passkey sign-in, an encrypted key vault, fresh confirmation for every payment, and zero-knowledge proofs made on your device.",
  },
  {
    icon: EyeOff,
    title: "Privacy",
    text: "We collect the minimum needed to run the service and explain every part of it in our Privacy and Cookie Policies.",
  },
  {
    icon: ScanEye,
    title: "Transparency",
    text: "Open-source cryptography, public pool accounting, and plain-language policies, so you can verify instead of trusting.",
  },
  {
    icon: Sparkles,
    title: "Honesty",
    text: "Testnet means test tokens, risks are stated up front, and 'soon' means exactly that.",
  },
];
