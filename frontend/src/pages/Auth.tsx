import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Mail, User, Lock, ShieldCheck, ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getUser,
  deriveKeysFromEmailAndPin,
  unlockWalletWithPin,
  sha256,
  bytesToHex,
  signOut
} from "@/lib/auth";
import { login, register, setSession, type BackendUser } from "@/lib/backend";
import { supabase } from "@/lib/supabase";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-8 shrink-0" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.03 5.03 0 0 1-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.97 10.97 0 0 0 1 12c0 1.78.43 3.45 1.18 4.93l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

type AuthStep = "login" | "register-profile" | "unlock-pin";

function AuthPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<AuthStep>("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Pending user data from OAuth
  const [pendingEmail, setPendingEmail] = useState("");
  const [pendingDisplayName, setPendingDisplayName] = useState("");
  const [pendingAvatar, setPendingAvatar] = useState("");
  const [existingUser, setExistingUser] = useState<BackendUser | null>(null);

  // Form states for profile registration
  const [usernameInput, setUsernameInput] = useState("");
  const [pinInput, setPinInput] = useState("");
  const [pinConfirmInput, setPinConfirmInput] = useState("");

  // Returning user PIN unlock state
  const [loginPin, setLoginPin] = useState("");

  useEffect(() => {
    document.title = "Sign in — Starlit Pay";

    const isCallback =
      window.location.hash.includes("access_token") ||
      window.location.search.includes("code");

    if (!isCallback) {
      void getUser().then((user) => {
        if (user) navigate("/dashboard", { replace: true });
      });
    }

    async function handleSession(sessionUserEmail: string, sessionMetadata?: any) {
      try {
        setBusy(true);
        const cleanEmail = sessionUserEmail.toLowerCase().trim();
        setPendingEmail(cleanEmail);

        const dName =
          sessionMetadata?.full_name ||
          sessionMetadata?.name ||
          cleanEmail.split("@")[0] ||
          "User";
        const aUrl = sessionMetadata?.avatar_url || sessionMetadata?.picture || "";

        setPendingDisplayName(dName);
        setPendingAvatar(aUrl);

        // Check if user already exists in backend database
        const checkRes = await login(cleanEmail);
        if (checkRes.exists && checkRes.user) {
          setExistingUser(checkRes.user);
          setSession(checkRes.token, checkRes.user);
          setStep("unlock-pin");
        } else {
          // New user: user chooses their username and creates their PIN
          setUsernameInput("");
          setPinInput("");
          setPinConfirmInput("");
          setStep("register-profile");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Authentication error.");
      } finally {
        setBusy(false);
      }
    }

    // 1. Listen for Supabase auth state change (implicit OAuth redirect with #access_token)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user?.email && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) {
        const hasHashOrCode =
          window.location.hash.includes("access_token") ||
          window.location.search.includes("code");
        if (hasHashOrCode || step === "login") {
          await handleSession(session.user.email, session.user.user_metadata);
        }
      }
    });

    // 2. Also check if returning from OAuth directly via getSession
    void (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        if (params.has("code")) {
          setBusy(true);
          await supabase.auth.exchangeCodeForSession(window.location.search);
          window.history.replaceState(null, "", "/auth");
        }

        const { data } = await supabase.auth.getSession();
        if (data.session?.user?.email) {
          const hasHashOrCode =
            window.location.hash.includes("access_token") ||
            window.location.search.includes("code");
          if (hasHashOrCode) {
            await handleSession(data.session.user.email, data.session.user.user_metadata);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "OAuth session verification failed.");
      }
    })();

    return () => {
      subscription.unsubscribe();
    };
  }, [navigate]);

  useEffect(() => {
    document.documentElement.classList.remove("dark");
  }, []);

  async function handleGoogleLogin() {
    setError("");
    setBusy(true);
    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth` },
      });
      if (oauthError) throw oauthError;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Google sign-in failed.");
      setBusy(false);
    }
  }

  async function handleRegisterProfile(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const cleanUsername = usernameInput.toLowerCase().trim().replace(/^@/, "");
    if (!cleanUsername || cleanUsername.length < 3) {
      setError("Username must be at least 3 characters.");
      return;
    }

    if (!/^[a-z0-9_]+$/.test(cleanUsername)) {
      setError("Username can only contain lowercase letters, numbers, and underscores.");
      return;
    }

    if (pinInput.length !== 6 || !/^\d{6}$/.test(pinInput)) {
      setError("Security PIN must be exactly 6 digits.");
      return;
    }

    if (pinInput !== pinConfirmInput) {
      setError("Confirmation PIN does not match.");
      return;
    }

    setBusy(true);
    try {
      // 1. Derive encryption and signing keys from email and PIN
      const derived = await deriveKeysFromEmailAndPin(pendingEmail, pinInput);
      const identityCommitment = bytesToHex(await sha256(derived.spendingKey));

      // 2. Register profile in backend
      const regRes = await register({
        email: pendingEmail,
        username: cleanUsername,
        display_name: pendingDisplayName || cleanUsername,
        identity_commitment: identityCommitment,
        public_encryption_key: derived.viewing.publicKey,
        stellar_address: derived.stellar.publicKey,
        avatar_url: pendingAvatar || undefined,
      });

      // 3. Save JWT session and unlock wallet in local storage
      setSession(regRes.token, regRes.user);
      await unlockWalletWithPin(pendingEmail, pinInput, identityCommitment);

      // 4. Enter dashboard unlocked
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create profile.");
      setBusy(false);
    }
  }

  async function handleUnlockExisting(e: React.FormEvent) {
    e.preventDefault();
    if (loginPin.length !== 6 || !/^\d{6}$/.test(loginPin)) {
      setError("Please enter your 6-digit PIN.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      if (!existingUser) throw new Error("User profile not found.");
      const unlockRes = await unlockWalletWithPin(
        existingUser.email,
        loginPin,
        existingUser.identity_commitment || undefined
      );

      if (!unlockRes.success) {
        throw new Error(unlockRes.error || "Incorrect 6-digit PIN.");
      }

      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unlock failed.");
      setBusy(false);
    }
  }

  async function handleResetToLogin() {
    await signOut();
    setStep("login");
    setPendingEmail("");
    setExistingUser(null);
    setPinInput("");
    setPinConfirmInput("");
    setLoginPin("");
    setError("");
  }

  return (
    <main className="auth-stage">
      <div className="auth-shell">
        <section className="auth-panel">
          <div className="auth-form-wrap">
            {step === "login" && (
              <div>
                <div className="text-center">
                  <h1 className="text-[32px] font-medium text-foreground">Welcome to Starlit Pay</h1>
                  <p className="mt-3 text-[15px] leading-6 text-muted-foreground">
                    Start your confidential payment experience by signing in or creating an account.
                  </p>
                </div>

                <div className="mt-8 space-y-6">
                  <Button
                    type="button"
                    onClick={handleGoogleLogin}
                    disabled={busy}
                    className="h-16 w-full rounded-lg bg-background text-[18px] font-semibold text-foreground shadow-md shadow-primary/10 hover:bg-white/50"
                  >
                    <GoogleIcon /> {busy ? "Connecting to Google..." : "Continue with Google"}
                  </Button>

                  {error && (
                    <p className="text-sm text-red-500 text-center" role="alert">
                      {error}
                    </p>
                  )}

                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-[15px] font-semibold text-foreground">Login with Email</span>
                      <span className="rounded-full bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-primary">
                        Coming Soon
                      </span>
                    </div>
                    <div className="auth-input" aria-disabled="true">
                      <Mail />
                      <Input type="email" placeholder="Enter your email address" disabled />
                    </div>
                  </div>

                  <Button
                    className="h-16 w-full rounded-lg bg-primary text-[16px] font-medium shadow-none"
                    disabled
                    type="button"
                  >
                    Sign In
                  </Button>
                </div>
              </div>
            )}

            {step === "register-profile" && (
              <div>
                <div className="text-center">
                  <div className="inline-flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary mb-3">
                    <ShieldCheck className="size-6" />
                  </div>
                  <h1 className="text-[26px] font-medium text-foreground">Create Your Profile</h1>
                  <p className="mt-2 text-[14px] leading-5 text-muted-foreground">
                    Choose your username and set a 6-digit PIN to encrypt your private wallet.
                  </p>
                  <div className="mt-3 inline-block rounded-full bg-muted/60 px-3 py-1 text-xs text-muted-foreground font-mono">
                    {pendingEmail}
                  </div>
                </div>

                {error && (
                  <div className="mt-4 p-3 rounded-md bg-red-500/10 border border-red-500/20 text-red-500 text-xs text-center">
                    {error}
                  </div>
                )}

                <form onSubmit={handleRegisterProfile} className="mt-6 space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1.5">
                      Choose Username
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-sm text-muted-foreground">@</span>
                      <Input
                        type="text"
                        required
                        className="pl-7"
                        placeholder="yourname"
                        value={usernameInput}
                        onChange={(e) => setUsernameInput(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Used for payment links and receiving transfers.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1.5">
                      Create 6-Digit Payment PIN
                    </label>
                    <Input
                      type="password"
                      maxLength={6}
                      required
                      placeholder="••••••"
                      className="text-center text-lg tracking-[0.5em]"
                      value={pinInput}
                      onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ""))}
                    />
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Your PIN derives your private keys locally on this device.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1.5">
                      Confirm PIN
                    </label>
                    <Input
                      type="password"
                      maxLength={6}
                      required
                      placeholder="••••••"
                      className="text-center text-lg tracking-[0.5em]"
                      value={pinConfirmInput}
                      onChange={(e) => setPinConfirmInput(e.target.value.replace(/\D/g, ""))}
                    />
                  </div>

                  <Button
                    type="submit"
                    disabled={busy || !usernameInput || pinInput.length !== 6 || pinConfirmInput.length !== 6}
                    className="w-full h-12 text-sm font-semibold mt-4"
                  >
                    {busy ? "Encrypting Wallet & Creating Account..." : "Complete Setup & Launch Wallet"}
                  </Button>

                  <div className="text-center pt-2">
                    <button
                      type="button"
                      onClick={handleResetToLogin}
                      className="text-xs text-muted-foreground hover:text-foreground underline cursor-pointer"
                    >
                      Use a different account
                    </button>
                  </div>
                </form>
              </div>
            )}

            {step === "unlock-pin" && existingUser && (
              <div>
                <div className="text-center">
                  <div className="inline-flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary mb-3">
                    <Lock className="size-6" />
                  </div>
                  <h1 className="text-[26px] font-medium text-foreground">Welcome Back</h1>
                  <p className="mt-2 text-[14px] text-muted-foreground">
                    Enter your 6-digit PIN for <b>@{existingUser.username}</b> to unlock your private wallet.
                  </p>
                </div>

                {error && (
                  <div className="mt-4 p-3 rounded-md bg-red-500/10 border border-red-500/20 text-red-500 text-xs text-center">
                    {error}
                  </div>
                )}

                <form onSubmit={handleUnlockExisting} className="mt-6 space-y-4">
                  <div>
                    <Input
                      type="password"
                      maxLength={6}
                      required
                      autoFocus
                      placeholder="••••••"
                      className="text-center text-xl tracking-[0.5em] h-14"
                      value={loginPin}
                      onChange={(e) => setLoginPin(e.target.value.replace(/\D/g, ""))}
                    />
                  </div>

                  <Button
                    type="submit"
                    disabled={busy || loginPin.length !== 6}
                    className="w-full h-12 text-sm font-semibold"
                  >
                    {busy ? "Decrypting..." : "Unlock Wallet"}
                  </Button>

                  <div className="text-center pt-2">
                    <button
                      type="button"
                      onClick={handleResetToLogin}
                      className="text-xs text-muted-foreground hover:text-foreground underline cursor-pointer"
                    >
                      Sign in to a different account
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

export default AuthPage;
