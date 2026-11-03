// Reads the pool's events in ledger order and remembers how far it got.
//
// The position only moves past ledgers that were fully read and applied, so a
// failed RPC call or database write is retried on the next run, never skipped.
// RPC keeps about 7 days of events; anything older is gone, and the scan
// resumes from the oldest ledger still held.

export const INDEXER_STATE = "indexer";

export function createEventScanner({ rpc, contractId, state, applyEvent, logger, chunkSize = 10_000, pageLimit = 10_000 }) {
  let running = false;

  return async function scan() {
    if (running) return;
    running = true;
    try {
      const { oldestLedger, latestLedger } = await rpc.getHealth();
      const saved = await state.get(INDEXER_STATE);
      let from = saved?.nextLedger ?? oldestLedger;
      if (from < oldestLedger) {
        logger.warn(`Indexer resumed at ledger ${oldestLedger}: ledgers ${from}-${oldestLedger - 1} are no longer held by RPC`);
        from = oldestLedger;
      }

      const seen = new Set();
      while (from <= latestLedger) {
        const to = Math.min(latestLedger, from + chunkSize - 1);
        const { events } = await rpc.getEvents({
          startLedger: from,
          endLedger: to + 1,
          filters: [{ type: "contract", contractIds: [contractId] }],
          limit: pageLimit,
        });
        for (const event of events) {
          if (seen.has(event.id)) continue;
          seen.add(event.id);
          await applyEvent(event);
        }
        // A full page may have stopped mid-range: continue from its last ledger
        // (re-reading that ledger is harmless, events are applied idempotently).
        const full = events.length >= pageLimit;
        const next = full ? Math.max(events.at(-1).ledger, from + 1) : to + 1;
        await state.set(INDEXER_STATE, { nextLedger: next });
        from = next;
      }
    } catch (err) {
      logger.error("Indexer run failed; retrying from the saved position:", err);
    } finally {
      running = false;
    }
  };
}
