const NOT_FOUND = "PGRST116";
const UNIQUE_VIOLATION = "23505";

// What any signed-in user may see about another user, to pay them.
const PUBLIC_PROFILE = "id, username, display_name, public_encryption_key, avatar_url, stellar_address";

export function createUsersRepository(supabase) {
  const users = () => supabase.from("users");

  return {
    /** Full row, including identity_commitment: never return it as is. */
    async findByEmail(email) {
      const { data, error } = await users().select("*").eq("email", email).maybeSingle();
      if (error) throw error;
      return data;
    },

    async findPublicByUsername(username) {
      const { data, error } = await users().select(PUBLIC_PROFILE).eq("username", username).single();
      if (error?.code === NOT_FOUND) return null;
      if (error) throw error;
      return data;
    },

    async depositMemoTaken(memo) {
      const { data, error } = await users().select("id").eq("deposit_memo", memo).maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },

    /** Null if the email or username is already taken. */
    async insert(user) {
      const { data, error } = await users().insert([user]).select().single();
      if (error?.code === UNIQUE_VIOLATION) return null;
      if (error) throw error;
      return data;
    },

    async update(id, fields) {
      const { data, error } = await users().update(fields).eq("id", id).select().maybeSingle();
      if (error) throw error;
      return data;
    },
  };
}
