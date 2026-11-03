import * as StellarSdk from "@stellar/stellar-sdk";
import { rpc, NETWORK_PASSPHRASE } from "./config.js";
import { createComplianceChecker } from "./compliance.js";

const ASP_CONTRACT_ID = process.env.ASP_CONTRACT_ID || null;
export const aspContractId = ASP_CONTRACT_ID;

// Known test/sanction addresses for local testing and simulation
const DEFAULT_SANCTION_LIST = new Set([
  // Example known blacklisted/bad actor accounts for test purposes
  "GBADACTORXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
]);

/** Read-only is_address_blocked call. Throws if the contract gave no answer. */
async function queryAspContract(address) {
  const contract = new StellarSdk.Contract(ASP_CONTRACT_ID);
  const simTx = new StellarSdk.TransactionBuilder(
    new StellarSdk.Account("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", "0"),
    { fee: StellarSdk.BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE }
  )
    .addOperation(contract.call("is_address_blocked", StellarSdk.Address.fromString(address).toScVal()))
    .setTimeout(30)
    .build();

  const sim = await rpc.simulateTransaction(simTx);
  if (StellarSdk.rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  if (!sim?.result?.retval) throw new Error("The compliance contract returned no result.");
  return Boolean(StellarSdk.scValToNative(sim.result.retval));
}

/**
 * Checks whether an address is blocked by the ASP policy: local list, cache,
 * then the Soroban ASP contract if one is configured.
 *
 * @param {string} address - Stellar G... or C... address to check
 * @param {{failClosed?: boolean}} [options] - throw ComplianceUnavailableError when the contract can't answer
 * @returns {Promise<boolean>} true if the address is blocked
 */
export const isAddressBlocked = createComplianceChecker({
  queryContract: ASP_CONTRACT_ID && /^C[A-Z2-7]{55}$/.test(ASP_CONTRACT_ID) ? queryAspContract : null,
  sanctionList: DEFAULT_SANCTION_LIST,
});

