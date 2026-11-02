import { app, supabase } from "./config.js";
import { authLayer } from "./auth_layer/mount.js";
import { logger } from "./http/logger.js";

/** The signed-in user, or null: for routes open to everyone that treat members differently. */
export function sessionUser(req) {
  const session = authLayer.sessions?.authenticate(req)?.session;
  return session ? { id: session.id, email: session.email, username: session.username } : null;
}

/** Authentication middleware: a passkey-layer session (access cookie or Bearer access token). */
export function requireAuth(req, res, next) {
  const result = authLayer.sessions?.authenticate(req);
  if (result?.session) {
    req.session = result.session;
    req.user = { id: result.session.id, email: result.session.email, username: result.session.username };
    return next();
  }
  if (result?.error === "csrf") {
    return res.status(403).json({ error: "Missing CSRF header.", code: "csrf" });
  }
  return res.status(401).json({ error: "Unauthorized: Missing or invalid authentication token." });
}

// 1. Authenticate user by email (Login check / PIN unlock)
// Lookup mode `{ email }` → returns { exists, user? } WITHOUT a token (used to
// decide between PIN-entry and PIN-setup; no session is created).
// PIN check mode `{ email, identity_commitment }` → verifies the PIN-derived
// commitment of an old email+PIN account so it can upgrade to a passkey. It
// issues no session: only the passkey layer does that.
app.post("/api/auth/login", async (req, res) => {
  const { email, identity_commitment } = req.body;
  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }

  try {
    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("email", email.toLowerCase())
      .single();

    if (error && error.code !== "PGRST116") {
      throw error;
    }

    if (!user) {
      return res.status(200).json({ exists: false });
    }

    // Lookup mode must not leak the stored commitment: it is the login secret.
    if (!identity_commitment) {
      return res.status(200).json({
        exists: true,
        user: { username: user.username, display_name: user.display_name, avatar_url: user.avatar_url },
      });
    }

    if (identity_commitment !== user.identity_commitment) {
      return res.status(401).json({ error: "Incorrect PIN." });
    }

    const { identity_commitment: _secret, ...safeUser } = user;
    res.status(200).json({ exists: true, user: safeUser });
  } catch (error) {
    logger.error("Login error:", error.message);
    res.status(500).json({ error: "Failed to authenticate user" });
  }
});

// 2. Register user (Create profile)
app.post("/api/users/register", async (req, res) => {
  const { email, username, display_name, identity_commitment, public_encryption_key, avatar_url, stellar_address } = req.body;

  if (!email || !username || !identity_commitment || !public_encryption_key) {
    return res.status(400).json({ error: "Missing required registration parameters" });
  }

  // The caller must prove they own the email (Google sign-in verified by
  // Supabase), so nobody can register an account under someone else's address.
  if (authLayer.provenEmail) {
    const proven = await authLayer.provenEmail(req);
    if (!proven || proven !== String(email).toLowerCase().trim()) {
      return res.status(401).json({ error: "Sign in with Google to create your account.", code: "email_proof_required" });
    }
  }

  try {
    // Generate unique 6-digit deposit memo
    let depositMemo = 0;
    let memoUnique = false;
    let attempts = 0;
    while (!memoUnique && attempts < 15) {
      depositMemo = Math.floor(100000 + Math.random() * 900000);
      const { data: existingUser } = await supabase
        .from("users")
        .select("id")
        .eq("deposit_memo", depositMemo)
        .maybeSingle();
      if (!existingUser) {
        memoUnique = true;
      }
      attempts++;
    }

    if (!memoUnique) {
      throw new Error("Failed to generate unique deposit memo ID.");
    }

    // Insert new user profile into Supabase
    const { data: newUser, error } = await supabase
      .from("users")
      .insert([
        {
          email: email.toLowerCase(),
          username: username.toLowerCase().replace("@", ""),
          display_name: display_name || username,
          identity_commitment,
          public_encryption_key,
          avatar_url: avatar_url || `https://api.dicebear.com/7.x/bottts/svg?seed=${username}`,
          stellar_address,
          deposit_memo: depositMemo
        }
      ])
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return res.status(400).json({ error: "Username or email already exists" });
      }
      throw error;
    }

    const { identity_commitment: _secret, ...safeUser } = newUser;
    res.status(201).json({ user: safeUser });
  } catch (error) {
    logger.error("Registration error:", error.message);
    res.status(500).json({ error: "Failed to register user" });
  }
});

// 3. Lookup user by username (returns public keys for sending payments)
app.get("/api/users/lookup/:username", async (req, res) => {
  const { username } = req.params;
  const cleanUsername = username.toLowerCase().replace("@", "");

  if (cleanUsername.toUpperCase().startsWith("G") && cleanUsername.length === 56) {
    return res.status(400).json({ error: "Stellar public keys are not valid usernames. Use Withdraw to send to an EOA address." });
  }

  try {
    const { data: user, error } = await supabase
      .from("users")
      .select("id, username, display_name, public_encryption_key, avatar_url, stellar_address")
      .eq("username", cleanUsername)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return res.status(404).json({ error: "User not found" });
      }
      throw error;
    }

    res.status(200).json({ user });
  } catch (error) {
    logger.error("User lookup error:", error.message);
    res.status(500).json({ error: "Failed to resolve user" });
  }
});

// 4. Update own profile (display name + avatar only — email/username are
// identity and can never change here). Authenticated: users edit only self.
const handleProfileUpdate = async (req, res) => {
  const { display_name, avatar_url } = req.body ?? {};
  const updates = {};

  if (display_name !== undefined) {
    const clean = String(display_name).trim();
    if (!clean) return res.status(400).json({ error: "Display name cannot be empty." });
    if (clean.length > 100) return res.status(400).json({ error: "Display name is too long." });
    updates.display_name = clean;
  }

  if (avatar_url !== undefined) {
    if (typeof avatar_url !== "string" || !avatar_url) {
      return res.status(400).json({ error: "Avatar URL is invalid." });
    }
    const isHttp = /^https?:\/\/.+/i.test(avatar_url);
    const isDataImage = /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(avatar_url);
    if (!isHttp && !isDataImage) {
      return res.status(400).json({ error: "Avatar must be an https URL or image upload." });
    }
    if (isDataImage && avatar_url.length > 1024 * 1024) {
      return res.status(413).json({ error: "Avatar image is too large (max 1MB)." });
    }
    updates.avatar_url = avatar_url;
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: "Nothing to update." });
  }

  try {
    const { data: user, error } = await supabase
      .from("users")
      .update(updates)
      .eq("id", req.user.id)
      .select()
      .single();

    if (error) throw error;
    if (!user) return res.status(404).json({ error: "User not found." });
    const { identity_commitment: _secret, ...safeUser } = user;
    res.status(200).json({ user: safeUser });
  } catch (error) {
    logger.error("Profile update error:", error.message);
    res.status(500).json({ error: "Failed to update profile" });
  }
};

app.patch("/api/users/me", requireAuth, handleProfileUpdate);
app.patch("/api/users/profile", requireAuth, handleProfileUpdate);
