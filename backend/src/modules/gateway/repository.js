const UNIQUE_VIOLATION = "23505";

export function createGatewayRepository(supabase) {
  const deposits = () => supabase.from("gateway_deposits");
  const byKey = (query, { txHash, opIndex }) => query.eq("tx_hash", txHash).eq("op_index", opIndex);

  return {
    async findUserByMemo(memo) {
      const { data, error } = await supabase
        .from("users")
        .select("id, username, public_encryption_key")
        .eq("deposit_memo", memo)
        .maybeSingle();
      if (error) throw error;
      return data;
    },

    /** Records the payment as ours to process. False if it was already recorded. */
    async claim(key, details) {
      const now = new Date().toISOString();
      const { error } = await deposits().insert([
        { tx_hash: key.txHash, op_index: key.opIndex, ...details, status: "processing", attempts: 1, created_at: now, updated_at: now },
      ]);
      if (error?.code === UNIQUE_VIOLATION) return false;
      if (error) throw error;
      return true;
    },

    async get(key) {
      const { data, error } = await byKey(deposits().select("*"), key).maybeSingle();
      if (error) throw error;
      return data;
    },

    /**
     * Takes over a stalled or failed attempt. Matching updated_at means only
     * one process can win when two retry at once.
     */
    async takeOver(key, row) {
      const { data, error } = await byKey(deposits().update({ status: "processing", attempts: row.attempts + 1, updated_at: new Date().toISOString() }), key)
        .eq("updated_at", row.updated_at)
        .select();
      if (error) throw error;
      return data.length === 1;
    },

    async update(key, fields) {
      const { error } = await byKey(deposits().update({ ...fields, updated_at: new Date().toISOString() }), key);
      if (error) throw error;
    },

    async listRetryable(staleBefore, maxAttempts) {
      const { data, error } = await deposits()
        .select("tx_hash")
        .in("status", ["processing", "submitted", "failed"])
        .lt("updated_at", staleBefore)
        .lt("attempts", maxAttempts + 1)
        .limit(20);
      if (error) throw error;
      return [...new Set(data.map((row) => row.tx_hash))];
    },

    async noteExists(commitment) {
      const { data, error } = await supabase.from("shielded_notes").select("commitment").eq("commitment", commitment).maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },

    async insertNote(note) {
      const { error } = await supabase.from("shielded_notes").insert([{ ...note, status: "unspent" }]);
      if (error) throw error;
    },

    async deleteNote(commitment) {
      const { error } = await supabase.from("shielded_notes").delete().eq("commitment", commitment);
      if (error) throw error;
    },
  };
}
