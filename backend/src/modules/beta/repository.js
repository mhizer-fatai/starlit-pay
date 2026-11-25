// Closed-beta storage: invite codes, who redeemed them, and applications.

const UNIQUE_VIOLATION = "23505";
const APPLICATION_FIELDS = "id, name, email, x_handle, telegram_handle, persona, reason, status, created_at, reviewed_at";

export function createBetaRepository(supabase) {
  const invites = () => supabase.from("beta_invites");
  const redemptions = () => supabase.from("beta_redemptions");
  const applications = () => supabase.from("beta_applications");

  return {
    async findInvite(code) {
      const { data, error } = await invites().select("*").eq("code", code).maybeSingle();
      if (error) throw error;
      return data;
    },

    /** Null if the code already exists. */
    async insertInvite(invite) {
      const { data, error } = await invites().insert([invite]).select().single();
      if (error?.code === UNIQUE_VIOLATION) return null;
      if (error) throw error;
      return data;
    },

    /**
     * Moves a code's use count from `from` to `to`, only if it still reads
     * `from` (compare-and-set): two people redeeming the last use at once
     * can't both win. True if this call changed it.
     */
    async setInviteUses(code, from, to) {
      const { data, error } = await invites().update({ uses: to }).eq("code", code).eq("uses", from).select("code");
      if (error) throw error;
      return data.length === 1;
    },

    async invitesOwnedBy(ownerId) {
      const { data, error } = await invites().select("*").eq("owner_id", ownerId).order("created_at");
      if (error) throw error;
      return data;
    },

    async listInvites(kinds) {
      const { data, error } = await invites().select("*").in("kind", kinds).order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },

    async revokeInvite(code, at) {
      const { data, error } = await invites().update({ revoked_at: at }).eq("code", code).is("revoked_at", null).select("code");
      if (error) throw error;
      return data.length === 1;
    },

    async recordRedemption(code, userId) {
      const { error } = await redemptions().insert([{ code, user_id: userId }]);
      if (error) throw error;
    },

    /** Redemptions of the given codes, to count which golden tickets were used. */
    async redemptionsOf(codes) {
      if (!codes.length) return [];
      const { data, error } = await redemptions().select("code, user_id, redeemed_at").in("code", codes);
      if (error) throw error;
      return data;
    },

    /** Null if this email already applied. */
    async insertApplication(application) {
      const { data, error } = await applications().insert([application]).select(APPLICATION_FIELDS).single();
      if (error?.code === UNIQUE_VIOLATION) return null;
      if (error) throw error;
      return data;
    },

    /** True if this email's application was approved. */
    async isApprovedEmail(email) {
      const { data, error } = await applications().select("id").eq("email", email).eq("status", "approved").maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },

    async findApplicationByToken(token) {
      const { data, error } = await applications().select(APPLICATION_FIELDS).eq("status_token", token).maybeSingle();
      if (error) throw error;
      return data;
    },

    async listApplications(status) {
      let query = applications().select(APPLICATION_FIELDS).order("created_at", { ascending: true }).limit(500);
      if (status) query = query.eq("status", status);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },

    /** How many applications are pending, approved and rejected. */
    async countApplications() {
      const statuses = ["pending", "approved", "rejected"];
      const results = await Promise.all(
        statuses.map((status) => applications().select("id", { count: "exact", head: true }).eq("status", status))
      );
      const counts = {};
      results.forEach(({ count, error }, i) => {
        if (error) throw error;
        counts[statuses[i]] = count ?? 0;
      });
      return counts;
    },

    /** Only a pending application can be reviewed (so approving twice can't mint two codes). */
    async reviewApplication(id, fields) {
      const { data, error } = await applications()
        .update(fields)
        .eq("id", id)
        .eq("status", "pending")
        .select(APPLICATION_FIELDS)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  };
}
