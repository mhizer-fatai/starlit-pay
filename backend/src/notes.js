import { app, supabase } from "./config.js";

// Retrieves cached shielded notes for a specific viewing key
app.get("/api/notes/:viewingKey", async (req, res) => {
  const { viewingKey } = req.params;
  try {
    const { data: notes, error } = await supabase
      .from("shielded_notes")
      .select("*")
      .eq("recipient_viewing_key", viewingKey)
      .eq("status", "unspent");

    if (error) throw error;
    res.status(200).json({ notes });
  } catch (error) {
    console.error("Fetch notes error:", error.message);
    res.status(500).json({ error: "Failed to fetch shielded notes" });
  }
});

// Caches a new shielded note commitment
app.post("/api/notes", async (req, res) => {
  const { commitment, token_address, amount, encrypted_note, recipient_viewing_key } = req.body;
  if (!commitment || !token_address || !amount || !encrypted_note || !recipient_viewing_key) {
    return res.status(400).json({ error: "Missing parameters to cache note." });
  }
  try {
    const { data: note, error } = await supabase
      .from("shielded_notes")
      .insert([{ commitment, token_address, amount, encrypted_note, recipient_viewing_key }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ note });
  } catch (error) {
    console.error("Save note error:", error.message);
    res.status(500).json({ error: "Failed to save shielded note" });
  }
});

// Marks a commitment note as spent in cache database
app.post("/api/notes/spend", async (req, res) => {
  const { commitment } = req.body;
  if (!commitment) {
    return res.status(400).json({ error: "Commitment is required." });
  }
  try {
    const { data, error } = await supabase
      .from("shielded_notes")
      .update({ status: "spent" })
      .eq("commitment", commitment)
      .select();

    if (error) throw error;
    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Spend note error:", error.message);
    res.status(500).json({ error: "Failed to mark note as spent" });
  }
});
