import { app, supabase } from "./config.js";
import { requireAuth } from "./auth.js";

// Create a payment link record
app.post("/api/payment-links", requireAuth, async (req, res) => {
  const { creator_id, amount, asset, commitment, description } = req.body;

  if (!creator_id || !amount || !commitment) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  if (req.user.id !== creator_id) {
    return res.status(403).json({ error: "Forbidden: Cannot create payment link for another user." });
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
      .select("*, creator:creator_id(username, display_name, avatar_url, deposit_memo, public_encryption_key)")
      .eq("commitment", commitment)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return res.status(404).json({ error: "Payment link not found" });
      }
      throw error;
    }

    // Compute effective status based on expiration
    const createdAt = new Date(link.created_at);
    const now = new Date();
    const durationMinutes = (now.getTime() - createdAt.getTime()) / (1000 * 60);

    let effectiveStatus = link.status;
    if (effectiveStatus !== "claimed" && durationMinutes > 30) {
      effectiveStatus = "expired";
    }

    res.status(200).json({ link: { ...link, status: effectiveStatus } });
  } catch (error) {
    console.error("Fetch payment link error:", error.message);
    res.status(500).json({ error: "Failed to fetch payment link" });
  }
});

// Mark a payment link as claimed / one-time completed
app.post("/api/payment-links/:commitment/claim", async (req, res) => {
  const { commitment } = req.params;
  const { txHash } = req.body || {};

  try {
    const { data: link, error: findError } = await supabase
      .from("payment_links")
      .select("*")
      .eq("commitment", commitment)
      .single();

    if (findError || !link) {
      return res.status(404).json({ error: "Payment link not found" });
    }

    if (link.status === "claimed") {
      return res.status(400).json({ error: "This payment link has already been claimed." });
    }

    const createdAt = new Date(link.created_at);
    const now = new Date();
    const durationMinutes = (now.getTime() - createdAt.getTime()) / (1000 * 60);
    if (durationMinutes > 30) {
      return res.status(400).json({ error: "This payment link has expired." });
    }

    const { data: updated, error: updateError } = await supabase
      .from("payment_links")
      .update({ status: "claimed" })
      .eq("commitment", commitment)
      .select()
      .single();

    if (updateError) throw updateError;
    res.status(200).json({ status: "ok", link: updated, txHash });
  } catch (error) {
    console.error("Claim payment link error:", error.message);
    res.status(500).json({ error: "Failed to claim payment link" });
  }
});
