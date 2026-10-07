import { app, supabase } from "./config.js";
import { requireAuth } from "./auth.js";

const DEFAULTS = {
  language: "en",
  currency: "USD",
  notif_email: true,
  notif_push: true,
  notif_sms: false,
  notif_marketing: false,
  sec_passkey: true,
  sec_google: true,
  sec_email: true,
  sec_phone: false,
  sec_password: true,
};

const LANGUAGES = ["en", "es", "fr", "de", "zh"];
const CURRENCIES = ["USD", "EUR", "GBP", "XLM"];

// GET own settings; lazily creates the defaults row on first read.
app.get("/api/users/me/settings", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("user_settings")
      .select("*")
      .eq("user_id", req.user.id)
      .maybeSingle();

    if (error) throw error;
    if (data) return res.status(200).json({ settings: data });

    const { data: created, error: insertError } = await supabase
      .from("user_settings")
      .insert([{ user_id: req.user.id, ...DEFAULTS }])
      .select()
      .single();

    if (insertError) throw insertError;
    res.status(200).json({ settings: created });
  } catch (error) {
    console.error("Fetch settings error:", error.message);
    res.status(500).json({ error: "Failed to load settings" });
  }
});

// PATCH own settings (whitelisted fields only).
app.patch("/api/users/me/settings", requireAuth, async (req, res) => {
  const body = req.body ?? {};
  const updates = {};

  if (body.language !== undefined) {
    if (!LANGUAGES.includes(body.language)) {
      return res.status(400).json({ error: "Unsupported language." });
    }
    updates.language = body.language;
  }
  if (body.currency !== undefined) {
    if (!CURRENCIES.includes(body.currency)) {
      return res.status(400).json({ error: "Unsupported currency." });
    }
    updates.currency = body.currency;
  }
  for (const key of [
    "notif_email",
    "notif_push",
    "notif_sms",
    "notif_marketing",
    "sec_passkey",
    "sec_google",
    "sec_email",
    "sec_phone",
    "sec_password",
  ]) {
    if (body[key] !== undefined) {
      if (typeof body[key] !== "boolean") {
        return res.status(400).json({ error: `Setting ${key} must be true or false.` });
      }
      updates[key] = body[key];
    }
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: "Nothing to update." });
  }
  updates.updated_at = new Date().toISOString();

  try {
    // Merge over the existing row so untouched settings are preserved.
    const { data: existing, error: fetchError } = await supabase
      .from("user_settings")
      .select("*")
      .eq("user_id", req.user.id)
      .maybeSingle();

    if (fetchError) throw fetchError;
    const { data, error } = await supabase
      .from("user_settings")
      .upsert({ user_id: req.user.id, ...DEFAULTS, ...existing, ...updates }, { onConflict: "user_id" })
      .select()
      .single();

    if (error) throw error;
    res.status(200).json({ settings: data });
  } catch (error) {
    console.error("Update settings error:", error.message);
    res.status(500).json({ error: "Failed to save settings" });
  }
});
