import { app, supabase } from "./config.js";

// Create a payment link record
app.post("/api/payment-links", async (req, res) => {
  const { creator_id, amount, asset, commitment, description } = req.body;

  if (!creator_id || !amount || !commitment) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const { data: link, error } = await supabase
      .from("payment_links")
      .insert([
        {
          creator_id,
          amount,
          asset: asset || "USDC",
          commitment,
          description,
          status: "pending"
        }
      ])
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ link });
  } catch (error) {
    console.error("Payment link creation error:", error.message);
    res.status(500).json({ error: "Failed to create payment link" });
  }
});

// Get payment link by commitment
app.get("/api/payment-links/:commitment", async (req, res) => {
  const { commitment } = req.params;

  try {
    const { data: link, error } = await supabase
      .from("payment_links")
      .select("*, creator:creator_id(username, display_name, avatar_url)")
      .eq("commitment", commitment)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return res.status(404).json({ error: "Payment link not found" });
      }
      throw error;
    }

    // Checks if the link has already been claimed
    if (link.status === "claimed") {
      return res.status(400).json({ error: "This payment link has already been claimed and has expired." });
    }

    // Checks if the link was created more than 30 minutes ago
    const createdAt = new Date(link.created_at);
    const now = new Date();
    const durationMinutes = (now.getTime() - createdAt.getTime()) / (1000 * 60);

    if (durationMinutes > 30) {
      return res.status(400).json({ error: "This payment link has expired (30-minute limit exceeded)." });
    }

    res.status(200).json({ link });
  } catch (error) {
    console.error("Fetch payment link error:", error.message);
    res.status(500).json({ error: "Failed to fetch payment link" });
  }
});
