import { useState } from "react";
import { ChevronDown } from "lucide-react";

export function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-border bg-background/40">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center justify-between gap-4 px-6 py-5 text-left text-[16px] font-medium text-foreground"
      >
        {question}
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
          <p className="px-6 pb-5 text-[15px] leading-[1.7] text-foreground/75">{answer}</p>
        </div>
      </div>
    </div>
  );
}
