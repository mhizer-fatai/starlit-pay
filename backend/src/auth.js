import jwt from "jsonwebtoken";
import { app, supabase } from "./config.js";

const JWT_SECRET =
  process.env.JWT_SECRET || "starlit_jwt_secure_signing_secret_prod_2026";
if (!process.env.JWT_SECRET && process.env.NODE_ENV === "production") {
  console.warn("Security notice: Using default JWT_SECRET. Configure JWT_SECRET in environment for maximum security.");
}

/**
 * Generates a signed JWT for authenticated user sessions
 */
export function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, username: user.username },
    JWT_SECRET,
    { algorithm: "HS256", expiresIn: "7d" }
  );
}

/**
 * Authentication middleware verifying Bearer JWT headers
 */
export function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: Missing authentication token header." });
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Unauthorized: Invalid or expired authentication token." });
  }
}

// 1. Authenticate user by email (Login check / PIN unlock)
// Lookup mode `{ email }` → returns { exists, user? } WITHOUT a token (used to
// decide between PIN-entry and PIN-setup; no session is created).
// Unlock mode `{ email, identity_commitment }` → verifies the PIN-derived
// commitment against the stored one and only then issues a JWT.
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

    if (!identity_commitment) {
      return res.status(200).json({ exists: true, user });
    }

    if (identity_commitment !== user.identity_commitment) {
      return res.status(401).json({ error: "Incorrect PIN." });
    }

    const token = generateToken(user);
    res.status(200).json({ exists: true, user, token });
  } catch (error) {
    console.error("Login error:", error.message);
    res.status(500).json({ error: "Failed to authenticate user" });
  }
});

// 2. Register user (Create profile)
app.post("/api/users/register", async (req, res) => {
  const { email, username, display_name, identity_commitment, public_encryption_key, avatar_url, stellar_address } = req.body;

  if (!email || !username || !identity_commitment || !public_encryption_key) {
    return res.status(400).json({ error: "Missing required registration parameters" });
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

    const token = generateToken(newUser);
    res.status(201).json({ user: newUser, token });
  } catch (error) {
    console.error("Registration error:", error.message);
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
      .select("id, username, display_name, identity_commitment, public_encryption_key, avatar_url, stellar_address")
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
    console.error("User lookup error:", error.message);
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
    res.status(200).json({ user });
  } catch (error) {
    console.error("Profile update error:", error.message);
    res.status(500).json({ error: "Failed to update profile" });
  }
};

app.patch("/api/users/me", requireAuth, handleProfileUpdate);
app.patch("/api/users/profile", requireAuth, handleProfileUpdate);
