import { app, supabase } from "./config.js";

// 1. Authenticate user by email (Login check)
app.post("/api/auth/login", async (req, res) => {
  const { email } = req.body;
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

    res.status(200).json({ exists: true, user });
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

    res.status(201).json({ user: newUser });
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
