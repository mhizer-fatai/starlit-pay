import { useEffect } from "react";

import { FaqList } from "@/components/FaqList";
import { SectionHeader } from "@/components/SectionHeader";
import { ScrollToTopButton } from "@/components/ScrollToTopButton";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { container } from "@/lib/utils";

function Faqs() {
  useEffect(() => {
    document.title = "FAQs — Starlit Pay";
  }, []);

  return (
    <div className="relative overflow-x-clip">
      <SiteHeader />
      <section className={`${container} py-20 lg:py-28`}>
        <SectionHeader title="Frequently Asked Questions" />
        <FaqList />
      </section>
      <SiteFooter />
      <ScrollToTopButton />
    </div>
  );
}

export default Faqs;
