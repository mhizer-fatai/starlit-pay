// Loads a saved copy of the private pools' events into the history archive
// (zk_events), for ledgers Stellar RPC no longer holds. Safe to re-run:
// events already archived are skipped.
//   node scripts/zk_history_import.js <events.json>
// The file holds { events: [...] } exactly as RPC getEvents returned them.
import fs from "node:fs";
import { supabase } from "../src/config.js";
import { createZkHistoryRepository } from "../src/modules/zk_history/repository.js";

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/zk_history_import.js <events.json>");
  process.exit(1);
}
const { events } = JSON.parse(fs.readFileSync(file, "utf8"));
const valid = events.filter((e) => typeof e.id === "string" && Number.isInteger(e.ledger) && typeof e.contractId === "string");
if (valid.length !== events.length) throw new Error(`${events.length - valid.length} events are malformed; nothing imported`);

const repository = createZkHistoryRepository(supabase);
for (let i = 0; i < valid.length; i += 500) await repository.upsertEvents(valid.slice(i, i + 500));
console.log(`Imported ${valid.length} events (ledgers ${valid[0]?.ledger}-${valid.at(-1)?.ledger}).`);
