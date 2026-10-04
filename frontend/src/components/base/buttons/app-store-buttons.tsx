import { type ReactNode } from "react";

type Size = "sm" | "md";

const sizeClasses: Record<Size, string> = {
  sm: "h-9 px-3 text-xs gap-2",
  md: "h-11 px-4 text-sm gap-3",
};

function StoreButtonBase({
  children,
  size = "md",
  className = "",
}: {
  children: ReactNode;
  size?: Size;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-muted)] ${sizeClasses[size]} ${className}`}
    >
      {children}
    </button>
  );
}

export function GooglePlayButton({ size = "md" }: { size?: Size }) {
  return (
    <StoreButtonBase size={size} className="gap-3">
      <svg viewBox="0 0 24 24" className="size-5 shrink-0" fill="currentColor" aria-hidden="true">
        <path d="M3.609 1.814L13.792 12 3.61 22.186a.996.996 0 0 1-.61-.92V2.734a1 1 0 0 1 .609-.92zM14.5 13.5l2.5 2.5L14.5 18.5v-5zm2.5-2.5L14.5 5.5l2.5-2.5 2.5 2.5-2.5 2.5zm2.5 2.5l2.5 2.5 2.5-2.5-2.5-2.5-2.5 2.5z" />
      </svg>
      <span className="leading-tight">
        <small className="block text-[10px] uppercase tracking-wide opacity-70">Get it on</small>
        <span className="block text-sm font-semibold">Google Play</span>
      </span>
    </StoreButtonBase>
  );
}

export function AppStoreButton({ size = "md" }: { size?: Size }) {
  return (
    <StoreButtonBase size={size} className="gap-3">
      <svg viewBox="0 0 24 24" className="size-5 shrink-0" fill="currentColor" aria-hidden="true">
        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.21-1.96 1.07-3.11-1.05.05-2.31.71-3.06 1.54-.68.75-1.25 1.95-1.1 3.04 1.19.09 2.38-.6 3.09-1.47" />
      </svg>
      <span className="leading-tight">
        <small className="block text-[10px] uppercase tracking-wide opacity-70">Download on the</small>
        <span className="block text-sm font-semibold">App Store</span>
      </span>
    </StoreButtonBase>
  );
}

export function GalaxyStoreButton({ size = "md" }: { size?: Size }) {
  return (
    <StoreButtonBase size={size} className="gap-3">
      <svg viewBox="0 0 24 24" className="size-5 shrink-0" fill="currentColor" aria-hidden="true">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5v-9l6 4.5-6 4.5z" />
      </svg>
      <span className="leading-tight">
        <small className="block text-[10px] uppercase tracking-wide opacity-70">Get it on</small>
        <span className="block text-sm font-semibold">Galaxy Store</span>
      </span>
    </StoreButtonBase>
  );
}
