// The history service's JSON-RPC: the same narrow protocol as Nethermind's SPP
// bootnode (tools/bootnode/src/rpc.rs), so the SPP SDK can use it as its
// `bootnodeUrl`. It serves `getEvents` for the archived pool contracts up to
// a cutoff 5 days behind the tip, then hands off (-32002 with `fromLedger`)
// so the app continues on Stellar RPC, which still holds those ledgers.

export const RETENTION_HANDOFF = -32002;
export const NOT_READY = -32004;
const INVALID_PARAMS = -32602;
const METHOD_NOT_FOUND = -32601;
const INVALID_REQUEST = -32600;
const INTERNAL = -32603;

const GENESIS_CURSOR = "bootnode:genesis:";
const DEFAULT_PAGE = 1000;
// PostgREST returns at most 1000 rows per query; never promise more.
const MAX_PAGE = 1000;
const EVENT_ID = /^\d{19}-\d{10}$/;

class RpcError extends Error {
  constructor(code, message, data) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

const handoff = (fromLedger) =>
  new RpcError(RETENTION_HANDOFF, "Continue syncing on your RPC endpoint", { reason: "retention_threshold", fromLedger });

const isContractFilter = (filters) =>
  Array.isArray(filters) &&
  filters.length > 0 &&
  filters.every(
    (f) =>
      f?.type === "contract" &&
      Array.isArray(f.contractIds) &&
      f.contractIds.length > 0 &&
      JSON.stringify(f.topics) === JSON.stringify([["**"]])
  );

/**
 * `state()` returns { tip, oldestLedger, ready } from the ingester; `cutoffLedgers`
 * is the handoff distance behind the tip (5 days of ledgers by default).
 */
export function createZkHistoryRpc({ repository, contracts, minDeploymentLedger, state, cutoffLedgers, upstreamLatestLedger }) {
  async function getEvents(params = {}) {
    if (params.endLedger !== undefined) throw new RpcError(INVALID_PARAMS, "endLedger is not supported by bootnode");
    if (params.xdrFormat !== undefined) throw new RpcError(INVALID_PARAMS, "xdrFormat is not supported by bootnode");

    const { filters, startLedger } = params;
    const cursor = params.pagination?.cursor;
    if ((startLedger === undefined) === (cursor === undefined)) {
      throw new RpcError(INVALID_PARAMS, "getEvents params must include either startLedger or pagination.cursor");
    }
    if (startLedger !== undefined && !(Number.isInteger(startLedger) && startLedger >= 0)) throw new RpcError(INVALID_PARAMS, "invalid startLedger");
    if (cursor !== undefined && typeof cursor !== "string") throw new RpcError(INVALID_PARAMS, "invalid cursor");

    const requested = (Array.isArray(filters) ? filters : []).flatMap((f) => (Array.isArray(f?.contractIds) ? f.contractIds : []));
    if (!isContractFilter(filters) || !requested.every((id) => contracts.includes(id))) {
      // Some known ids: a client on a newer or older manifest.
      if (isContractFilter(filters) && requested.some((id) => contracts.includes(id))) {
        throw new RpcError(NOT_READY, `the bootnode does not follow contract ${requested.find((id) => !contracts.includes(id))}; retry later`);
      }
      throw new RpcError(INVALID_PARAMS, "unsupported filters");
    }

    const { tip, oldestLedger, ready } = await state();
    if (!tip || !ready) throw new RpcError(NOT_READY, "bootnode warming up; retry later");

    const cutoff = Math.max(0, tip - cutoffLedgers);
    const limit = Math.min(Math.max(Number(params.pagination?.limit) || DEFAULT_PAGE, 1), MAX_PAGE);
    if (startLedger !== undefined && startLedger >= cutoff) throw handoff(cutoff);

    const respond = (events, nextCursor) => ({
      events,
      latestLedger: tip,
      latestLedgerCloseTime: "",
      oldestLedger: oldestLedger || minDeploymentLedger,
      oldestLedgerCloseTime: "",
      cursor: events.length ? events.at(-1).id : nextCursor,
    });

    const genesisStart = cursor?.startsWith(GENESIS_CURSOR) ? Number(cursor.slice(GENESIS_CURSOR.length)) : null;
    if (cursor !== undefined && genesisStart === null) {
      if (!EVENT_ID.test(cursor)) throw new RpcError(INVALID_PARAMS, "invalid cursor");
      const cursorLedger = await repository.eventLedger(cursor);
      if (cursorLedger === null) throw new RpcError(INVALID_PARAMS, "invalid cursor");
      if (cursorLedger >= cutoff) throw handoff(cutoff);
      const events = await repository.pageAfter(requested, cursorLedger, cursor, cutoff, limit);
      if (!events.length) throw handoff(cutoff);
      return respond(events, cursor);
    }

    if (genesisStart !== null && !Number.isInteger(genesisStart)) throw new RpcError(INVALID_PARAMS, "invalid cursor");
    const start = genesisStart ?? startLedger ?? minDeploymentLedger;
    const events = await repository.pageByLedger(requested, start, cutoff, limit);
    if (!events.length && genesisStart !== null) throw handoff(cutoff);
    return respond(events, startLedger !== undefined ? `${GENESIS_CURSOR}${startLedger}` : cursor);
  }

  const methods = { getEvents, getLatestLedger: () => upstreamLatestLedger() };

  /** One JSON-RPC request in, one response out (batches are not supported). */
  return async function handle(body, logger) {
    const id = body?.id ?? null;
    try {
      if (body?.jsonrpc !== "2.0" || typeof body.method !== "string") throw new RpcError(INVALID_REQUEST, "invalid request");
      const method = Object.hasOwn(methods, body.method) ? methods[body.method] : null;
      if (!method) throw new RpcError(METHOD_NOT_FOUND, "method not found");
      return { jsonrpc: "2.0", id, result: await method(body.params) };
    } catch (err) {
      if (!(err instanceof RpcError)) {
        logger?.error("ZK history request failed:", err);
        err = new RpcError(INTERNAL, "internal error");
      }
      return { jsonrpc: "2.0", id, error: { code: err.code, message: err.message, ...(err.data ? { data: err.data } : {}) } };
    }
  };
}
