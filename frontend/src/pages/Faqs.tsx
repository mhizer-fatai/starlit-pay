import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";

import { FaqItem } from "@/components/FaqItem";
import { SectionHeader } from "@/components/SectionHeader";
import { ScrollToTopButton } from "@/components/ScrollToTopButton";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { container } from "@/lib/utils";

const faqs = [
  {
    question: "How do private transactions work?",
    answer:
      "Every payment is encrypted on your device and converted into a zero-knowledge proof that is verified on-chain. The Stellar network confirms the payment is valid without ever seeing your transaction amount, your recipient, or your balance.",
  },
  {
    question: "What assets are supported inside Starlit Pay?",
    answer:
      "Starlit Pay currently supports USDC digital dollars and XLM, the native token of the Stellar network. Support for additional Stellar-based assets is on our roadmap.",
  },
  {
    question: "How are network fees sponsored?",
    answer:
      "Our gasless gateway covers the Stellar network fees for every transaction, so you never pay gas. What your recipient claims is exactly the amount you sent.",
  },
  {
    question: "Are my private keys stored on Starlit servers?",
    answer:
      "No. Your keys are generated and encrypted on your device and never leave it. Starlit servers cannot access your wallet, your balances, or your transaction history.",
  },
  {
    question: "Is Starlit Pay open-source and audited?",
    answer:
      "Yes. The client-side cryptography and the Soroban vault contracts are open-source and independently audited, so you can verify exactly what the code does at any time.",
  },
];

const moreFaqs = [
  {
    question: "What happens if I lose my payment PIN?",
    answer:
      "Your PIN is never stored anywhere — not on your device and not on our servers. Without it your wallet keys cannot be recreated, so write it down somewhere safe when you create your account.",
  },
  {
    question: "How fast are payments?",
    answer:
      "Stellar settles in about 5 seconds. Private balance credits land once the gateway shields them, usually within a minute, and you will see them in your activity feed.",
  },
  {
    question: "How do I receive payments from someone?",
    answer:
      "Share your Starlit username or your deposit address with its memo. The sender pays through the app or any Stellar wallet, and the funds appear in your private balance once shielded.",
  },
  {
    question: "Is Starlit Pay free to use?",
    answer:
      "Yes. There are no app fees and network gas is sponsored, so sending and receiving costs you nothing while on testnet.",
  },
  {
    question: "Which Stellar network is supported?",
    answer:
      "Starlit Pay currently runs on the Stellar Testnet, which uses test tokens with no real-world value. Mainnet support is on the roadmap.",
  },
];

function Faqs() {
  useEffect(() => {
    document.title = "FAQs — Starlit Pay";
  }, []);

  return (
    <div className="relative overflow-x-clip">
      <SiteHeader />
      <section className={`${container} py-20 lg:py-28`}>
        <SectionHeader title="Frequently Asked Questions" />
        <div className="mx-auto mt-10 grid max-w-[1400px] gap-8 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:gap-10">
          <div className="flex flex-col gap-3">
            {faqs.map((faq) => (
              <FaqItem key={faq.question} {...faq} />
            ))}
          </div>
          <hr className="border-border md:hidden" aria-hidden="true" />
          <div className="hidden w-px bg-border md:block" aria-hidden="true" />
          <div className="flex flex-col gap-3">
            {moreFaqs.map((faq) => (
              <FaqItem key={faq.question} {...faq} />
            ))}
          </div>
        </div>
      </section>
      <SiteFooter />
      <ScrollToTopButton />
    </div>
  );
}

export default Faqs;
