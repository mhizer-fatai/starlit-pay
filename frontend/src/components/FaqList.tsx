import { FaqItem } from "@/components/FaqItem";
import { FAQS } from "@/content/site";

const half = Math.ceil(FAQS.length / 2);

/** All FAQs in two columns (one on small screens). */
export function FaqList() {
  return (
    <div className="mx-auto mt-10 grid max-w-[1400px] gap-8 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:gap-10">
      <div className="flex flex-col gap-3">
        {FAQS.slice(0, half).map((faq) => (
          <FaqItem key={faq.question} {...faq} />
        ))}
      </div>
      <hr className="border-border md:hidden" aria-hidden="true" />
      <div className="hidden w-px bg-border md:block" aria-hidden="true" />
      <div className="flex flex-col gap-3">
        {FAQS.slice(half).map((faq) => (
          <FaqItem key={faq.question} {...faq} />
        ))}
      </div>
    </div>
  );
}
