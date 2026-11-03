// Where background jobs keep their position. Render's disk is wiped on every
// deploy, so a position kept in a file sent the jobs back to the beginning.

export function createDaemonState(supabase) {
  return {
    async get(name) {
      const { data, error } = await supabase.from("daemon_state").select("value").eq("name", name).maybeSingle();
      if (error) throw error;
      return data?.value ?? null;
    },

    async set(name, value) {
      const { error } = await supabase
        .from("daemon_state")
        .upsert({ name, value, updated_at: new Date().toISOString() }, { onConflict: "name" });
      if (error) throw error;
    },
  };
}
