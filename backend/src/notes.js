import { app, supabase } from "./config.js";
import * as StellarSdk from "@stellar/stellar-sdk";

// Helper to verify cryptographic signatures of current requests
function verifyRequestSignature(timestampStr, signatureHex, publicKey) {
  try {
    // 1. Verify timestamp is fresh (within 5 minutes) to prevent replay attacks
    const diff = Math.abs(Date.now() - parseInt(timestampStr));
    if (isNaN(diff) || diff > 5 * 60 * 1000) {
      return false;
    }
    // 2. Verify signature using public Ed25519 key
    const keypair = StellarSdk.Keypair.fromPublicKey(publicKey);
    return keypair.verify(Buffer.from(timestampStr), Buffer.from(signatureHex, "hex"));
  } catch (e) {
    return false;
  }
}

// Retrieves cached shielded notes for a specific viewing key (authenticated)
app.get("/api/notes/:viewingKey", async (req, res) => {
  const { viewingKey } = req.params;
  const { timestamp, signature } = req.query;

  if (!timestamp || !signature) {
    return res.status(401).json({ error: "Authentication parameters (timestamp, signature) are required." });
  }

  try {
    // 1. Lookup recipient's stellar address from users profile
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("stellar_address")
      .eq("public_encryption_key", viewingKey)
      .maybeSingle();

    if (userError || !user) {
      return res.status(404).json({ error: "User profile matching this viewing key not found." });
    }

    // 2. Cryptographically verify signature
    const verified = verifyRequestSignature(timestamp, signature, user.stellar_address);
    if (!verified) {
      return res.status(401).json({ error: "Unauthorized: Invalid request signature." });
    }

    // 3. Fetch notes
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

// Caches a new shielded note commitment (unauthenticated, anyone can send you a note)
app.post("/api/notes", async (req, res) => {
  const { commitment, encrypted_note, recipient_viewing_key } = req.body;
  if (!commitment || !encrypted_note || !recipient_viewing_key) {
    return res.status(400).json({ error: "Missing parameters to cache note." });
  }
  try {
    const { data: note, error } = await supabase
      .from("shielded_notes")
      .insert([{ commitment, encrypted_note, recipient_viewing_key }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ note });
  } catch (error) {
    console.error("Save note error:", error.message);
    res.status(500).json({ error: "Failed to save shielded note" });
  }
});

// Marks a commitment note as spent in cache database (authenticated)
app.post("/api/notes/spend", async (req, res) => {
  const { commitment, timestamp, signature } = req.body;
  if (!commitment || !timestamp || !signature) {
    return res.status(400).json({ error: "Commitment, timestamp, and signature are required." });
  }
  try {
    // 1. Fetch note to get recipient's viewing key
    const { data: note, error: noteError } = await supabase
      .from("shielded_notes")
      .select("recipient_viewing_key")
      .eq("commitment", commitment)
      .maybeSingle();

    if (noteError || !note) {
      return res.status(404).json({ error: "Shielded note not found." });
    }

    // 2. Lookup recipient's stellar address from users profile
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("stellar_address")
      .eq("public_encryption_key", note.recipient_viewing_key)
      .maybeSingle();

    if (userError || !user) {
      return res.status(404).json({ error: "User profile matching this note not found." });
    }

    // 3. Cryptographically verify signature
    const verified = verifyRequestSignature(timestamp, signature, user.stellar_address);
    if (!verified) {
      return res.status(401).json({ error: "Unauthorized: Invalid request signature." });
    }

    // 4. Update status
    const { error: updateError } = await supabase
      .from("shielded_notes")
      .update({ status: "spent" })
      .eq("commitment", commitment);

    if (updateError) throw updateError;
    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Spend note error:", error.message);
    res.status(500).json({ error: "Failed to mark note as spent" });
  }
});
