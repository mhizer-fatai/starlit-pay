// Archived pool events, in RPC event-id order (ledger, then id).

export function createZkHistoryRepository(supabase) {
  const events = () => supabase.from("zk_events");
  const payloads = (rows) => rows.map((row) => row.payload);

  return {
    async upsertEvents(list) {
      if (!list.length) return;
      const rows = list.map((e) => ({ id: e.id, ledger: e.ledger, contract_id: e.contractId, payload: e }));
      const { error } = await events().upsert(rows, { onConflict: "id", ignoreDuplicates: true });
      if (error) throw error;
    },

    /** Events of `contractIds` with start <= ledger < cutoff. */
    async pageByLedger(contractIds, start, cutoff, limit) {
      const { data, error } = await events()
        .select("payload")
        .in("contract_id", contractIds)
        .gte("ledger", start)
        .lt("ledger", cutoff)
        .order("ledger")
        .order("id")
        .limit(limit);
      if (error) throw error;
      return payloads(data);
    },

    /** Ledger of any archived event, or null. */
    async eventLedger(id) {
      const { data, error } = await events().select("ledger").eq("id", id).maybeSingle();
      if (error) throw error;
      return data?.ledger ?? null;
    },

    /** Events after event `afterId` (at `afterLedger`), below the cutoff. `afterId` is checked by the caller. */
    async pageAfter(contractIds, afterLedger, afterId, cutoff, limit) {
      const { data, error } = await events()
        .select("payload")
        .in("contract_id", contractIds)
        .lt("ledger", cutoff)
        .or(`ledger.gt.${afterLedger},and(ledger.eq.${afterLedger},id.gt.${afterId})`)
        .order("ledger")
        .order("id")
        .limit(limit);
      if (error) throw error;
      return payloads(data);
    },
  };
}
