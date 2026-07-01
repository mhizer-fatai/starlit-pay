import { app, supabase } from "./config.js";

// Retrieves symmetric encrypted transaction records for a specific user ID
app.get("/api/transactions/:userId", async (req, res) => {
  const { userId } = req.params;
  try {
    const { data: txs, error } = await supabase
      .from("transactions")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    res.status(200).json({ transactions: txs });
  } catch (error) {
    console.error("Fetch transactions error:", error.message);
    res.status(500).json({ error: "Failed to fetch transaction history" });
  }
});

// Logs a new symmetric encrypted transaction record for a user
app.post("/api/transactions", async (req, res) => {
  const { user_id, encrypted_payload } = req.body;
  if (!user_id || !encrypted_payload) {
    return res.status(400).json({ error: "Missing required parameters to log transaction." });
  }
  try {
    const { data: tx, error } = await supabase
      .from("transactions")
      .insert([{ user_id, encrypted_payload }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ transaction: tx });
  } catch (error) {
    console.error("Save transaction error:", error.message);
    res.status(500).json({ error: "Failed to log transaction record" });
  }
});
