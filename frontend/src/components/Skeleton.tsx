import type { CSSProperties } from "react";

interface SkeletonProps {
  className?: string;
  style?: CSSProperties;
  label?: string;
}

/** Pulsing placeholder shown while database reads complete. */
export function Skeleton({ className = "", style, label = "Loading" }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      role="presentation"
      className={`animate-pulse rounded-md bg-muted motion-reduce:animate-none ${className}`}
      style={style}
      data-loading={label}
    />
  );
}

/** Placeholder mimicking one activity-list row (icon + two lines + amount). */
export function ActivitySkeletonRow() {
  return (
    <li aria-hidden="true">
      <Skeleton className="size-[38px] shrink-0 rounded-full" />
      <div className="activity-copy" style={{ display: "grid", gap: 6 }}>
        <Skeleton className="h-3.5 w-2/5" />
        <Skeleton className="h-3 w-1/3" />
      </div>
      <Skeleton className="h-4 w-20" />
    </li>
  );
}
