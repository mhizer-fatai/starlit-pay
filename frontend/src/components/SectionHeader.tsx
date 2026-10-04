import type { ReactNode } from "react";

export function SectionHeader({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="max-w-[760px]">
      {eyebrow && (
        <p className="text-[13px] font-semibold uppercase tracking-[0.18em] text-primary">
          {eyebrow}
        </p>
      )}
      <h2
        className={`text-[32px] font-medium leading-[1.15] text-foreground sm:text-[40px] lg:text-[44px] ${
          eyebrow ? "mt-3" : ""
        }`}
      >
        {title}
      </h2>
      {children && (
        <p className="mt-4 max-w-[680px] text-[16px] leading-[1.7] text-foreground/75">
          {children}
        </p>
      )}
    </div>
  );
}
