import { Router } from "express";
import { asyncHandler, HttpError } from "../../http/errors.js";
import { logger } from "../../http/logger.js";
import { stellarAddress } from "../../http/validate.js";
import { aspContractId, isAddressBlocked } from "../../asp_service.js";

// Lets the app check a recipient before preparing a withdrawal. The relayer
// checks again (fail closed) when the withdrawal is submitted.

export const complianceRouter = Router();
complianceRouter.get(
  "/api/compliance/check/:address",
  asyncHandler(async (req, res) => {
    const { address } = req.params;
    // Accounts (G…) and contracts such as smart wallets (C…): withdrawals go to both.
    if (!stellarAddress.safeParse(address).success) throw new HttpError(400, "Invalid Stellar address format.");
    let blocked;
    try {
      blocked = await isAddressBlocked(address);
    } catch (err) {
      logger.error("Compliance check failed:", err);
      throw new HttpError(500, "Failed to evaluate compliance status.");
    }
    res.json({ address, blocked, status: blocked ? "BLOCKED" : "CLEAN", aspContract: aspContractId || "local-compliance-filter" });
  })
);
