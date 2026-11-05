// Copies every event of the private pools' contracts from Stellar RPC into
// the archive, in ledger windows, and remembers how far it got. The position
// only moves past windows that were fully stored, so failures retry.
//
// RPC drops events after ~7 days. If the position falls behind that, the
// missing events can't be fetched any more: it stops and says so, rather
// than serving a history with a hole in it (import a saved copy instead).

export const ZK_HISTORY_STATE = "zk_history";
const WINDOW = 2000;
const PAGE = 1000;

export function createZkHistoryIngest({ rpcCall, repository, state, contracts, startLedger, logger }) {
  const filters = [{ type: "contract", contractIds: contracts, topics: [["**"]] }];
  let running = false;

  return async function ingest() {
    if (running) return;
    running = true;
    try {
      const { sequence: latest } = await rpcCall("getLatestLedger", {});
      const saved = (await state.get(ZK_HISTORY_STATE)) ?? {};
      let from = saved.nextLedger ?? startLedger;
      let oldestLedger = saved.oldestLedger ?? 0;

      while (from <= latest) {
        const endLedger = Math.min(latest, from + WINDOW - 1) + 1;
        let page;
        try {
          page = await rpcCall("getEvents", { startLedger: from, endLedger, filters, pagination: { limit: PAGE } });
        } catch (err) {
          if (/ledger range/i.test(err.message)) {
            logger.error(`ZK history can't fetch ledger ${from}: RPC no longer holds it. Import the saved event archive to fill the gap.`);
          }
          throw err;
        }
        await repository.upsertEvents(page.events);
        oldestLedger = page.oldestLedger || oldestLedger;
        // A full page may stop mid-window: re-read from its last ledger (upserts are idempotent).
        from = page.events.length >= PAGE ? Math.max(page.events.at(-1).ledger, from + 1) : endLedger;
        await state.set(ZK_HISTORY_STATE, { ...saved, nextLedger: from, oldestLedger });
      }
      await state.set(ZK_HISTORY_STATE, { nextLedger: from, oldestLedger, tip: latest, ready: true });
    } catch (err) {
      logger.error("ZK history ingest failed; retrying from the saved position:", err);
    } finally {
      running = false;
    }
  };
}

/** Raw JSON-RPC to Stellar RPC: the archive keeps events exactly as RPC returns them. */
export function createRpcCall(url, fetchImpl = fetch) {
  return async function rpcCall(method, params) {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const body = await res.json();
    if (body.error) throw new Error(`${method}: ${body.error.message}`);
    return body.result;
  };
}
