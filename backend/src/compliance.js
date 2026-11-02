import { logger } from "./http/logger.js";

// Address screening (Association Set Provider). Pure policy: the contract query
// is injected. When screening can't get an answer, callers choose: withdrawals
// fail closed, because money leaving the pool can't be pulled back.

export class ComplianceUnavailableError extends Error {
  constructor(address, cause) {
    super(`Compliance check unavailable for ${address}: ${cause?.message ?? cause}`);
    this.name = "ComplianceUnavailableError";
  }
}

export function createComplianceChecker({ queryContract, sanctionList = new Set(), cacheTtlMs = 60_000, now = Date.now, warn = logger.warn }) {
  const cache = new Map();

  return async function isAddressBlocked(address, { failClosed = false } = {}) {
    if (!address || typeof address !== "string") return false;
    if (sanctionList.has(address)) return true;

    const cached = cache.get(address);
    if (cached && now() - cached.timestamp < cacheTtlMs) return cached.blocked;

    if (!queryContract) return false; // no screening contract configured

    try {
      const blocked = await queryContract(address);
      cache.set(address, { blocked, timestamp: now() });
      return blocked;
    } catch (err) {
      warn(`[ASP Check] Failed to query ASP contract for ${address}:`, err?.message ?? err);
      if (failClosed) throw new ComplianceUnavailableError(address, err);
      return false;
    }
  };
}
