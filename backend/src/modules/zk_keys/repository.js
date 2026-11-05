const UNIQUE_VIOLATION = "23505";
const FIELDS = "id, username, stellar_address, public_encryption_key, zk_note_key, zk_encryption_key, zk_keys_signature";

export function createZkKeysRepository(supabase) {
  const users = () => supabase.from("users");

  return {
    async findById(id) {
      const { data, error } = await users().select(FIELDS).eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },

    async findByUsername(username) {
      const { data, error } = await users().select(FIELDS).eq("username", username).maybeSingle();
      if (error) throw error;
      return data;
    },

    /** Null if the note key is already another user's. */
    async saveKeys(id, fields) {
      const { data, error } = await users().update(fields).eq("id", id).select(FIELDS).maybeSingle();
      if (error?.code === UNIQUE_VIOLATION) return null;
      if (error) throw error;
      return data;
    },
  };
}
