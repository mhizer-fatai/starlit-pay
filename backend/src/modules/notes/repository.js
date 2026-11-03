export function createNotesRepository(supabase) {
  return {
    async findUserByViewingKey(viewingKey) {
      const { data, error } = await supabase
        .from("users")
        .select("id, stellar_address, public_encryption_key")
        .eq("public_encryption_key", viewingKey)
        .maybeSingle();
      if (error) throw error;
      return data;
    },

    async listNotes(viewingKey, { includeSpent }) {
      let query = supabase.from("shielded_notes").select("*").eq("recipient_viewing_key", viewingKey);
      if (!includeSpent) query = query.eq("status", "unspent");
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },

    async insertNote(note) {
      const { data, error } = await supabase.from("shielded_notes").insert([note]).select().single();
      if (error) throw error;
      return data;
    },

    async findNote(commitment) {
      const { data, error } = await supabase.from("shielded_notes").select("recipient_viewing_key, status").eq("commitment", commitment).maybeSingle();
      if (error) throw error;
      return data;
    },

    async markSpent(commitment) {
      const { error } = await supabase.from("shielded_notes").update({ status: "spent" }).eq("commitment", commitment);
      if (error) throw error;
    },
  };
}
