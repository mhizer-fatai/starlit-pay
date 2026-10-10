export function BrandMark({ className = "h-9 w-11" }: { className?: string }) {
  return (
    <span className={`relative block ${className}`} aria-hidden="true">
      <span className="absolute inset-x-0 bottom-0 aspect-square rounded-full border-[9px] border-primary" />
      <span className="absolute left-0 top-0 h-1/2 w-[62%] bg-[var(--hero-sky)]" />
      <span className="absolute left-[31%] top-[7%] h-[38%] w-[38%] rounded-br-full bg-[var(--hero-sky)]" />
    </span>
  );
}
