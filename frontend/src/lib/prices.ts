import { useEffect, useState } from "react";

import { BACKEND_URL } from "@/lib/backend";

/**
 * Live prices. `XLM` is null whenever no real market price is available, so the
 * UI says "Price unavailable" instead of valuing balances at a made-up rate.
 * USDC is pegged to $1.
 */
export type PriceStatus = "loading" | "live" | "unavailable";

export interface Prices {
  USDC: number;
  XLM: number | null;
  status: PriceStatus;
}

export const PRICE_UNAVAILABLE = "Price unavailable";

const POLL_MS = 60 * 1000;
// A cached upstream price older than this is no longer shown as current.
const MAX_PRICE_AGE_MS = 15 * 60 * 1000;

const LOADING: Prices = { USDC: 1, XLM: null, status: "loading" };
const UNAVAILABLE: Prices = { USDC: 1, XLM: null, status: "unavailable" };

interface PricesResponse {
  USDC?: unknown;
  XLM?: unknown;
  updatedAt?: unknown;
  source?: unknown;
}

function positive(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** One fetch of live prices through the backend proxy. */
export async function fetchPrices(): Promise<Prices> {
  const res = await fetch(`${BACKEND_URL}/api/prices`);
  if (!res.ok) throw new Error(`Prices ${res.status}`);
  const data = (await res.json()) as PricesResponse;

  const updatedAt = Number(data.updatedAt);
  const xlm = positive(data.XLM);
  const fresh = Number.isFinite(updatedAt) && updatedAt > 0 && Date.now() - updatedAt < MAX_PRICE_AGE_MS;
  if (!xlm || !fresh || data.source === "fallback") return UNAVAILABLE;

  return { USDC: positive(data.USDC) ?? 1, XLM: xlm, status: "live" };
}

/** Live prices, refreshed every 60s. Never substitutes a placeholder XLM price. */
export function usePrices(): Prices {
  const [prices, setPrices] = useState<Prices>(LOADING);
  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      void fetchPrices()
        .then((p) => {
          if (!cancelled) setPrices(p);
        })
        .catch(() => {
          if (!cancelled) setPrices(UNAVAILABLE);
        });
    };
    poll();
    const timer = window.setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
  return prices;
}

/** Formats unit price with appropriate decimal precision (e.g. $1.00 for USDC, $0.1972 for XLM). */
export function formatTokenPrice(price: number | null): string {
  if (price === null || !Number.isFinite(price) || price <= 0) return PRICE_UNAVAILABLE;
  if (price >= 0.999 && price <= 1.001) {
    return "$1.00";
  }
  if (price >= 1) {
    return `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}
