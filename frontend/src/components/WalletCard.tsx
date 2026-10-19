import type { ReactNode } from "react";

import { Skeleton } from "@/components/Skeleton";
import { formatTokenPrice, PRICE_UNAVAILABLE } from "@/lib/prices";
import { formatGrouped, splitDollarsCents } from "@/lib/wallet";

// Shared pieces of the two Dashboard balance cards (private and public).

export function WalletCardHeader({
  icon,
  tone,
  title,
  badge,
  actions,
}: {
  icon: ReactNode;
  tone: "private" | "public";
  title: string;
  badge: string;
  actions?: ReactNode;
}) {
  return (
    <div className="wallet-card-head">
      <span className={`wallet-card-icon wallet-card-icon-${tone}`}>{icon}</span>
      <div className="wallet-card-heading">
        <b>{title}</b>
        <span className={`wallet-badge wallet-badge-${tone}`}>{badge}</span>
      </div>
      {actions && <div className="wallet-card-tools">{actions}</div>}
    </div>
  );
}

export function WalletTotal({ usd, hidden, loading }: { usd: number | null; hidden: boolean; loading: boolean }) {
  if (hidden) return <div className="balance wallet-total">$ ••••••</div>;
  if (loading) return <Skeleton className="h-9 w-44" label="Loading balance" />;
  if (usd === null) return <div className="wallet-total wallet-total-unknown">{PRICE_UNAVAILABLE}</div>;
  const { dollars, cents } = splitDollarsCents(usd);
  return (
    <div className="balance wallet-total">
      ${dollars}
      <sup>{cents}</sup>
    </div>
  );
}

export function AssetRow({
  asset,
  amount,
  price,
  hidden,
  loading,
}: {
  asset: "USDC" | "XLM";
  amount: number;
  price: number | null;
  hidden: boolean;
  loading: boolean;
}) {
  const usd = price === null ? null : amount * price;
  return (
    <div className="wallet-asset">
      <span className={`wallet-token wallet-token-${asset.toLowerCase()}`} aria-hidden="true">
        {asset === "XLM" ? "✦" : "$"}
      </span>
      <div className="wallet-asset-name">
        <b>{asset}</b>
        <small>{formatTokenPrice(price)}</small>
      </div>
      <div className="wallet-asset-value">
        {loading ? (
          <Skeleton className="h-5 w-20" label={`Loading ${asset} balance`} />
        ) : (
          <>
            <b>{hidden ? "••••••" : formatGrouped(amount)}</b>
            <small>{hidden ? "••••" : usd === null ? PRICE_UNAVAILABLE : `≈ $${formatGrouped(usd)}`}</small>
          </>
        )}
      </div>
    </div>
  );
}
