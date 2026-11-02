export function createTransactionsRepository(supabase) {
  return {
    async listByUser(userId) {
      const { data, error } = await supabase
        .from("transactions")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },

    async create({ userId, encryptedPayload }) {
      const { data, error } = await supabase
        .from("transactions")
        .insert([{ user_id: userId, encrypted_payload: encryptedPayload }])
        .select()
        .single();
      if (error) throw error;
      return data;
    },
  };
}
