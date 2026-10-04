import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { FaqItem } from "@/components/FaqItem";
import { SectionHeader } from "@/components/SectionHeader";
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

function Faqs() {
  return (
    <div className="relative overflow-x-clip">
      <SiteHeader />
      <section className={`${container} py-20 lg:py-28`}>
        <SectionHeader eyebrow="Common Inquiries" title="Frequently Asked Questions" />
        <div className="mt-10 flex max-w-[860px] flex-col gap-3">
          {faqs.map((faq) => (
            <FaqItem key={faq.question} {...faq} />
          ))}
        </div>
      </section>
    </div>
  );
}

export default Faqs;
