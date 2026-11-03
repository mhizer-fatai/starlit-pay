// Polls Horizon for payments to the gateway address. Its position lives in the
// database, so a deploy or restart continues where the last run stopped.

export const GATEWAY_STATE = "gateway";

export function createGatewayDaemon({ processor, chain, state, logger }) {
  let running = false;
  let warnedUnseeded = false;

  return async function tick() {
    if (running) return;
    running = true;
    try {
      const saved = await state.get(GATEWAY_STATE);
      if (!saved?.cursor) {
        // Starting from the beginning would replay every past deposit.
        if (!warnedUnseeded) logger.error("Gateway paused: no saved position. Run schema_gateway.sql and its seed first.");
        warnedUnseeded = true;
        return;
      }

      const records = await chain.listIncoming(saved.cursor);
      if (records.length) logger.info(`Gateway found ${records.length} new transaction(s)`);
      for (const record of records) {
        try {
          await processor.processTransaction(record);
        } catch (err) {
          // Not moving past it: the next run retries (failed attempts are
          // counted, and set aside for review after a few).
          logger.error(`Gateway could not process ${record.hash}; retrying next run`, err);
          break;
        }
        await state.set(GATEWAY_STATE, { cursor: record.paging_token });
      }

      await processor.retryStalled();
    } catch (err) {
      logger.error("Gateway daemon error:", err);
    } finally {
      running = false;
    }
  };
}
