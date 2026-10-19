import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Fingerprint, KeyRound, LifeBuoy, Lock, Mail, ShieldCheck, User } from "lucide-react";

import { RecoveryCodePanel } from "@/components/RecoveryCodePanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getUser,
  getVaultSecrets,
  isUnlocked,
  isVaultMode,
  lookupByEmail,
  signOut,
  unlockWithPin,
  type SessionUser,
} from "@/lib/auth";
import { getStoredUser } from "@/lib/backend";
import { migrateLegacyAccount, migrationErrorMessage } from "@/lib/migration";
import { isValidPin } from "@/lib/keys";
import {
  accountUsesVault,
  createPasskeyAccount,
  friendlyAuthError,
  hasPasskeySession,
  passkeysSupported,
  signInWithPasskey,
  unlockWithRecovery,
  unlockWithVaultPin,
  type UnlockOutcome,
} from "@/lib/passkeyAccount";
import type { OpenedVault } from "@/lib/vault";
import { passkeyFlows } from "@/lib/vault/client";
import { PasskeyNeedsPinError } from "@/lib/vault/flows";
import { supabase } from "@/lib/supabase";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-10 shrink-0" aria-hidden="true">
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

// google      Continue with Google, or sign in with a passkey directly
// checking    finishing Google sign-in
// signup      new account: username + PIN, then create a passkey
// recovery    show the new recovery code once
// unlock      passkey account: unlock with passkey (PIN as fallback)
// unlock-pin  passkey account: unlock with PIN
// legacy-pin  older email+PIN account: enter the old PIN, then upgrade
// migrate     upgrade an email+PIN account to a passkey vault (moves funds)
// migrate-finish  an earlier upgrade stopped part-way; enter the PIN to finish
// recover     lost passkeys and PIN: Google + recovery code
// recover-pin after recovery: choose a new PIN
type Phase =
  | "google"
  | "checking"
  | "signup"
  | "recovery"
  | "unlock"
  | "unlock-pin"
  | "legacy-pin"
  | "migrate"
  | "migrate-finish"
  | "recover"
  | "recover-pin";

const PIN_INPUT_STYLE = {
  textAlign: "center",
  letterSpacing: "8px",
  fontSize: "20px",
} as const;

const PRIMARY_BUTTON = "h-16 w-full rounded-lg bg-primary text-[16px] font-medium shadow-none";
const SECONDARY_BUTTON = "h-12 w-full rounded-lg text-[15px]";

function StatusLine({ status, error }: { status: string; error: string }) {
  if (error) {
    return (
      <p className="text-sm text-red-500" role="alert">
        {error}
      </p>
    );
  }
  if (status) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        {status}
      </p>
    );
  }
  return null;
}

function AuthPage() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>("google");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(undefined);
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [passkeyCanUnlock, setPasskeyCanUnlock] = useState(true);
  // PIN unlock identifies the account by the passkey session when there is one,
  // otherwise by Google sign-in.
  const [pinUsesEmailProof, setPinUsesEmailProof] = useState(true);
  const canUsePasskeys = passkeysSupported();
  // Upgrade from email+PIN keys: the old PIN (same PIN for the new vault), and
  // for an interrupted upgrade, the already-opened vault awaiting completion.
  const [upgradePin, setUpgradePin] = useState("");
  const [pendingUpgrade, setPendingUpgrade] = useState<{ user: SessionUser; opened: OpenedVault } | null>(null);
  const [upgradeNote, setUpgradeNote] = useState("");
  const [recoveryInput, setRecoveryInput] = useState("");

  useEffect(() => {
    document.title = "Sign in — Starlit Pay";
    let cancelled = false;
    void (async () => {
      // Returning from Google OAuth: resolve the Supabase session, then route
      // the account to sign-up, passkey unlock, or the older PIN screen.
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const hash = window.location.hash;
      const hasHashToken = hash.includes("access_token") || hash.includes("code=");
      let oauthPending = false;
      try {
        oauthPending = sessionStorage.getItem("starlit_oauth") === "1";
      } catch {
        /* ignore */
      }
      const isOAuthReturn = Boolean(code) || hasHashToken || oauthPending;
      if (isOAuthReturn) {
        try {
          if (!cancelled) {
            setPhase("checking");
            setBusy(true);
            setError("");
            setStatus("Completing sign-in…");
          }
          // PKCE flow returns ?code= — exchange just the code (not the full
          // query string) for a session.
          if (code) {
            const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
            if (exchangeError) throw exchangeError;
            window.history.replaceState(null, "", "/auth");
          }
          const { data } = await supabase.auth.getSession();
          const googleEmail = data.session?.user.email;
          if (!googleEmail) {
            throw new Error("Google sign-in returned without a session. Please try again.");
          }
          if (hasHashToken) window.history.replaceState(null, "", "/auth");
          try {
            sessionStorage.removeItem("starlit_oauth");
          } catch {
            /* ignore */
          }
          const meta = data.session?.user.user_metadata ?? {};
          const name =
            (meta.full_name as string | undefined) ||
            (meta.name as string | undefined) ||
            "";
          const avatar =
            (meta.avatar_url as string | undefined) || (meta.picture as string | undefined);
          if (!cancelled) {
            setEmail(googleEmail);
            setDisplayName(name);
            setAvatarUrl(avatar);
            setStatus("Checking account…");
          }
          const { exists, user } = await lookupByEmail(googleEmail);
          if (cancelled) return;
          setPin("");
          setPinConfirm("");
          if (exists) {
            setUsername(user?.username ?? "");
            const usesVault = await accountUsesVault();
            if (cancelled) return;
            setPinUsesEmailProof(true);
            setPhase(usesVault ? "unlock" : "legacy-pin");
          } else {
            const base =
              googleEmail
                .split("@")[0]!
                .replace(/[^a-z0-9_]/g, "_")
                .slice(0, 24) || "user";
            setUsername(user?.username ?? base);
            if (!name) setDisplayName(base);
            setPhase("signup");
          }
        } catch (e) {
          if (!cancelled) {
            setError(friendlyAuthError(e));
            setPhase("google");
          }
          try {
            sessionStorage.removeItem("starlit_oauth");
          } catch {
            /* ignore */
          }
        } finally {
          if (!cancelled) {
            setBusy(false);
            setStatus("");
          }
        }
        return;
      }
      // Plain visit: signed in on an earlier page load, but keys only live in
      // memory, so the wallet is locked after a refresh.
      const user = await getUser();
      if (cancelled || !user) return;
      if (isUnlocked()) {
        navigate("/dashboard", { replace: true });
        return;
      }
      setEmail(user.email);
      setUsername(user.username ?? "");
      setPin("");
      setPinConfirm("");
      if (isVaultMode()) {
        const sessionAlive = await hasPasskeySession();
        if (cancelled) return;
        if (!sessionAlive) {
          await signOut();
          return;
        }
        setPinUsesEmailProof(false);
        setPhase("unlock");
        return;
      }
      setPhase("legacy-pin");
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  useEffect(() => {
    document.documentElement.classList.remove("dark");
  }, []);

  function resetMessages() {
    setError("");
    setStatus("");
  }

  async function handleGoogle() {
    resetMessages();
    setBusy(true);
    try {
      try {
        sessionStorage.setItem("starlit_oauth", "1");
      } catch {
        /* ignore */
      }
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth`,
          // Force Google to show the account chooser every time instead of
          // silently reusing the existing Google session.
          queryParams: { prompt: "select_account" },
        },
      });
      if (error) throw error;
    } catch (e) {
      try {
        sessionStorage.removeItem("starlit_oauth");
      } catch {
        /* ignore */
      }
      setError(e instanceof Error ? e.message : "Google sign-in failed.");
      setBusy(false);
    }
  }

  async function handleSwitchAccount() {
    await signOut();
    setPhase("google");
    setEmail("");
    setDisplayName("");
    setAvatarUrl(undefined);
    setUsername("");
    setPin("");
    setPinConfirm("");
    resetMessages();
  }

  async function handlePasskeyUnlock() {
    resetMessages();
    setBusy(true);
    setStatus("Confirm with your fingerprint, face or screen lock…");
    try {
      afterUnlock(await signInWithPasskey());
    } catch (err) {
      if (err instanceof PasskeyNeedsPinError) {
        // Signed in by the passkey; this device just can't open the vault with it.
        setPinUsesEmailProof(false);
        setEmail(err.user.email);
        setPhase("unlock-pin");
      }
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
      setStatus("");
    }
  }

  async function handleVaultPinUnlock(e: React.FormEvent) {
    e.preventDefault();
    if (!isValidPin(pin)) {
      setError("PIN must be exactly 6 digits.");
      return;
    }
    resetMessages();
    setBusy(true);
    setStatus("Unlocking wallet…");
    try {
      const outcome = await unlockWithVaultPin(pin, { useEmailProof: pinUsesEmailProof });
      if (outcome.status === "finish-upgrade") {
        // Same PIN as the old account: finish the upgrade straight away.
        await runUpgrade({ pin, user: outcome.user, opened: outcome.opened });
        return;
      }
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(friendlyAuthError(err));
      setPin("");
    } finally {
      setBusy(false);
      setStatus("");
    }
  }

  async function handleLegacyPinUnlock(e: React.FormEvent) {
    e.preventDefault();
    if (!isValidPin(pin)) {
      setError("PIN must be exactly 6 digits.");
      return;
    }
    resetMessages();
    setBusy(true);
    setStatus("Unlocking wallet…");
    try {
      await unlockWithPin(email, pin);
      if (!canUsePasskeys) {
        // Without passkey support the upgrade cannot run here; keep the old sign-in.
        navigate("/dashboard", { replace: true });
        return;
      }
      setUpgradePin(pin);
      setPin("");
      setPhase("migrate");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Incorrect PIN.");
      setPin("");
    } finally {
      setBusy(false);
      setStatus("");
    }
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    const cleanUsername = username.toLowerCase().trim().replace(/^@/, "");
    if (cleanUsername.length < 3 || !/^[a-z0-9_]+$/.test(cleanUsername)) {
      setError("Username must be at least 3 characters (letters, numbers, _).");
      return;
    }
    if (!isValidPin(pin) || !isValidPin(pinConfirm)) {
      setError("PIN must be exactly 6 digits.");
      return;
    }
    if (pin !== pinConfirm) {
      setError("PINs do not match.");
      return;
    }
    if (!canUsePasskeys) {
      setError("This browser doesn't support passkeys. Try a recent Chrome, Safari, Edge or Firefox.");
      return;
    }
    resetMessages();
    setBusy(true);
    try {
      const result = await createPasskeyAccount({
        email,
        username: cleanUsername,
        displayName: displayName || cleanUsername,
        avatarUrl,
        pin,
        onStatus: setStatus,
      });
      setPin("");
      setPinConfirm("");
      setRecoveryCode(result.recoveryCode);
      setPasskeyCanUnlock(result.passkeyCanUnlock);
      setPhase("recovery");
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
      setStatus("");
    }
  }

  function finishRecovery() {
    setRecoveryCode("");
    navigate("/dashboard", { replace: true });
  }

  function afterUnlock(outcome: UnlockOutcome) {
    if (outcome.status === "finish-upgrade") {
      setPendingUpgrade({ user: outcome.user, opened: outcome.opened });
      setPin("");
      setPhase("migrate-finish");
      return;
    }
    navigate("/dashboard", { replace: true });
  }

  /** Runs or resumes the upgrade from email+PIN keys to the passkey vault. */
  async function runUpgrade(input: { pin: string; user?: SessionUser; opened?: OpenedVault }) {
    const user = input.user ?? getStoredUser<SessionUser>();
    if (!user) {
      setError("Your session expired. Please sign in again.");
      setPhase("google");
      return;
    }
    resetMessages();
    setBusy(true);
    try {
      const result = await migrateLegacyAccount({ user, pin: input.pin, opened: input.opened, onStatus: setStatus });
      setUpgradePin("");
      setPendingUpgrade(null);
      const moved =
        result.notesMoved > 0
          ? ` ${result.notesMoved} private payment${result.notesMoved === 1 ? "" : "s"} moved to your new keys.`
          : "";
      const xlm =
        result.publicXlm.status === "moved"
          ? ` ${Number(result.publicXlm.amount).toFixed(2)} XLM moved from your old address.`
          : result.publicXlm.status === "skipped"
            ? ` Note: ${result.publicXlm.reason}`
            : "";
      setUpgradeNote(`Upgrade complete.${moved}${xlm}`);
      if (result.recoveryCode) {
        setRecoveryCode(result.recoveryCode);
        setPasskeyCanUnlock(result.passkeyCanUnlock);
        setPhase("recovery");
      } else {
        navigate("/dashboard", { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error && err.name === "AuthApiError" ? friendlyAuthError(err) : migrationErrorMessage(err));
    } finally {
      setBusy(false);
      setStatus("");
    }
  }

  async function handleFinishUpgrade(e: React.FormEvent) {
    e.preventDefault();
    if (!isValidPin(pin)) {
      setError("PIN must be exactly 6 digits.");
      return;
    }
    await runUpgrade({ pin, user: pendingUpgrade?.user, opened: pendingUpgrade?.opened });
    setPin("");
  }

  async function handleRecover(e: React.FormEvent) {
    e.preventDefault();
    resetMessages();
    setBusy(true);
    setStatus("Checking your recovery code…");
    try {
      const { outcome, newRecoveryCode } = await unlockWithRecovery(recoveryInput);
      setRecoveryInput("");
      if (outcome.status === "finish-upgrade") {
        setPendingUpgrade({ user: outcome.user, opened: outcome.opened });
        setPhase("migrate-finish");
        return;
      }
      setRecoveryCode(newRecoveryCode);
      setPin("");
      setPinConfirm("");
      setPhase("recover-pin");
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
      setStatus("");
    }
  }

  async function handleRecoverPin(e: React.FormEvent) {
    e.preventDefault();
    if (!isValidPin(pin) || pin !== pinConfirm) {
      setError(pin !== pinConfirm ? "PINs do not match." : "PIN must be exactly 6 digits.");
      return;
    }
    const secrets = getVaultSecrets();
    if (!secrets) {
      setError("Your session expired. Please start recovery again.");
      setPhase("recover");
      return;
    }
    resetMessages();
    setBusy(true);
    setStatus("Saving your new PIN…");
    try {
      await passkeyFlows.setPin(secrets, pin);
      setPin("");
      setPinConfirm("");
      setUpgradeNote(
        "Recovered. Add a passkey for this device in Settings > Security; it becomes active after a 24-hour safety wait."
      );
      setPhase("recovery");
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
      setStatus("");
    }
  }

  const recoveryLink = pinUsesEmailProof && (
    <Button
      type="button"
      variant="link"
      onClick={() => {
        resetMessages();
        setPhase("recover");
      }}
      disabled={busy}
      className="w-full text-[14px]"
    >
      <LifeBuoy /> Lost your passkey and PIN? Use your recovery code
    </Button>
  );

  const digitsOnly = (value: string) => value.replace(/\D/g, "").slice(0, 6);

  const pinInput = (props: {
    value: string;
    onChange: (v: string) => void;
    placeholder: string;
    autoComplete: string;
    autoFocus?: boolean;
  }) => (
    <Input
      type="password"
      inputMode="numeric"
      autoComplete={props.autoComplete}
      maxLength={6}
      placeholder={props.placeholder}
      value={props.value}
      onChange={(e) => props.onChange(digitsOnly(e.target.value))}
      required
      autoFocus={props.autoFocus}
      disabled={busy}
      style={PIN_INPUT_STYLE}
    />
  );

  return (
    <main className="auth-stage">
      <div className="auth-shell">
        <section className="auth-panel">
          <div className="auth-form-wrap">
            {(phase === "google" || phase === "checking") && (
              <>
                <div className="text-center">
                  <h1 className="text-[32px] font-medium text-foreground">Welcome to Starlit Pay</h1>
                  <p className="mt-3 text-[15px] leading-6 text-muted-foreground">
                    Start your experience with Starlit Pay by signing in or
                    <br className="hidden sm:block" /> signing up.
                  </p>
                </div>

                <div className="mt-8 space-y-6">
                  <Button
                    type="button"
                    onClick={handleGoogle}
                    disabled={busy}
                    className="h-16 w-full rounded-lg bg-background text-[18px] font-semibold text-foreground shadow-md shadow-primary/10 hover:bg-white/50"
                  >
                    <GoogleIcon /> {busy && phase === "checking" ? status || "Please wait…" : "Continue with Google"}
                  </Button>

                  {canUsePasskeys && phase === "google" && (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={handlePasskeyUnlock}
                      disabled={busy}
                      className="h-14 w-full rounded-lg text-[16px] font-semibold"
                    >
                      <Fingerprint /> {busy ? status || "Please wait…" : "Sign in with passkey"}
                    </Button>
                  )}

                  <StatusLine status={phase === "checking" ? "" : status} error={error} />

                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-[15px] font-semibold text-foreground">
                        Login with Email
                      </span>
                      <span className="rounded-full bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-primary">
                        Coming Soon
                      </span>
                    </div>
                    <div className="auth-input" aria-disabled="true">
                      <Mail />
                      <Input type="email" placeholder="Enter your email address" disabled />
                    </div>
                  </div>
                </div>
              </>
            )}

            {phase === "signup" && (
              <>
                <div className="text-center">
                  <KeyRound className="mx-auto size-8 text-primary" aria-hidden="true" />
                  <h1 className="mt-4 text-[28px] font-medium text-foreground">Create your wallet</h1>
                  <p className="mt-3 text-[15px] leading-6 text-muted-foreground">
                    <span className="font-semibold text-foreground">{email}</span> is new here. Pick a username
                    and a 6-digit backup PIN. Next, you'll create a passkey to unlock your wallet with your
                    fingerprint, face or screen lock.
                  </p>
                </div>

                <form onSubmit={handleSignup} className="mt-8 space-y-6">
                  <div>
                    <span className="text-[15px] font-semibold text-foreground">Username</span>
                    <div className="auth-input">
                      <User />
                      <Input
                        type="text"
                        placeholder="e.g. alice"
                        value={username}
                        onChange={(e) =>
                          setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))
                        }
                        required
                        disabled={busy}
                      />
                    </div>
                  </div>
                  <div>
                    <span className="text-[15px] font-semibold text-foreground">Backup PIN (6 digits)</span>
                    <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
                      For devices where your passkey can't unlock the wallet.
                    </p>
                    <div className="mt-2 space-y-3">
                      {pinInput({ value: pin, onChange: setPin, placeholder: "Enter 6-digit PIN", autoComplete: "new-password" })}
                      {pinInput({ value: pinConfirm, onChange: setPinConfirm, placeholder: "Confirm 6-digit PIN", autoComplete: "new-password" })}
                    </div>
                  </div>
                  <StatusLine status={status} error={error} />
                  <Button type="submit" disabled={busy} className={PRIMARY_BUTTON}>
                    <Fingerprint /> {busy ? status || "Creating…" : "Create wallet with passkey"}
                  </Button>
                  <Button type="button" variant="secondary" onClick={handleSwitchAccount} disabled={busy} className={SECONDARY_BUTTON}>
                    Switch Account
                  </Button>
                </form>
              </>
            )}

            {phase === "recovery" && (
              <>
                {upgradeNote && (
                  <p className="mb-6 rounded-lg bg-primary/10 p-3 text-[13px] leading-5 text-foreground" role="status">
                    {upgradeNote}
                  </p>
                )}
                {!passkeyCanUnlock && (
                  <p className="mb-6 rounded-lg bg-primary/5 p-3 text-[13px] leading-5 text-muted-foreground">
                    This device's passkey signs you in, but can't unlock the wallet by itself, so you'll also
                    enter your PIN here. Passkeys on most phones and newer computers unlock it directly.
                  </p>
                )}
                <RecoveryCodePanel code={recoveryCode} onDone={finishRecovery} doneLabel="Go to my wallet" />
              </>
            )}

            {phase === "unlock" && (
              <>
                <div className="text-center">
                  <Lock className="mx-auto size-8 text-primary" aria-hidden="true" />
                  <h1 className="mt-4 text-[28px] font-medium text-foreground">Unlock Wallet</h1>
                  <p className="mt-3 text-[15px] leading-6 text-muted-foreground">
                    Use your passkey for <span className="font-semibold text-foreground">{email}</span>
                  </p>
                </div>

                <div className="mt-8 space-y-6">
                  <Button type="button" onClick={handlePasskeyUnlock} disabled={busy || !canUsePasskeys} className={PRIMARY_BUTTON}>
                    <Fingerprint /> {busy ? status || "Unlocking…" : "Unlock with passkey"}
                  </Button>
                  <StatusLine status="" error={error} />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      resetMessages();
                      setPin("");
                      setPhase("unlock-pin");
                    }}
                    disabled={busy}
                    className={SECONDARY_BUTTON}
                  >
                    Use PIN instead
                  </Button>
                  {recoveryLink}
                  <Button type="button" variant="ghost" onClick={handleSwitchAccount} disabled={busy} className={SECONDARY_BUTTON}>
                    Switch Account
                  </Button>
                </div>
              </>
            )}

            {(phase === "unlock-pin" || phase === "legacy-pin") && (
              <>
                <div className="text-center">
                  <Lock className="mx-auto size-8 text-primary" aria-hidden="true" />
                  <h1 className="mt-4 text-[28px] font-medium text-foreground">Unlock Wallet</h1>
                  <p className="mt-3 text-[15px] leading-6 text-muted-foreground">
                    Enter the 6-digit PIN for{" "}
                    <span className="font-semibold text-foreground">{email}</span>
                  </p>
                </div>

                <form
                  onSubmit={phase === "unlock-pin" ? handleVaultPinUnlock : handleLegacyPinUnlock}
                  className="mt-8 space-y-6"
                >
                  {pinInput({ value: pin, onChange: setPin, placeholder: "••••••", autoComplete: "off", autoFocus: true })}
                  <StatusLine status={status} error={error} />
                  <Button type="submit" disabled={busy} className={PRIMARY_BUTTON}>
                    {busy ? status || "Unlocking…" : "Unlock"}
                  </Button>
                  {phase === "unlock-pin" && canUsePasskeys && (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        resetMessages();
                        setPhase("unlock");
                      }}
                      disabled={busy}
                      className={SECONDARY_BUTTON}
                    >
                      <Fingerprint /> Use passkey instead
                    </Button>
                  )}
                  {phase === "unlock-pin" && recoveryLink}
                  <Button type="button" variant="ghost" onClick={handleSwitchAccount} disabled={busy} className={SECONDARY_BUTTON}>
                    Switch Account
                  </Button>
                </form>
              </>
            )}
            {phase === "migrate" && (
              <>
                <div className="text-center">
                  <ShieldCheck className="mx-auto size-8 text-primary" aria-hidden="true" />
                  <h1 className="mt-4 text-[28px] font-medium text-foreground">Upgrade your wallet</h1>
                  <p className="mt-3 text-[15px] leading-6 text-muted-foreground">
                    Your wallet is protected only by your 6-digit PIN. We're moving it to new keys secured by a
                    passkey on this device, your PIN and a recovery code. Your balance moves with it.
                  </p>
                </div>
                <ul className="mt-6 space-y-2 text-[14px] leading-5 text-foreground">
                  <li>1. Create a passkey (fingerprint, face or screen lock)</li>
                  <li>2. Your private balance moves to the new keys (about a minute)</li>
                  <li>3. Save your recovery code</li>
                </ul>
                <div className="mt-8 space-y-6">
                  <StatusLine status={status} error={error} />
                  <Button
                    type="button"
                    onClick={() => runUpgrade({ pin: upgradePin })}
                    disabled={busy || !upgradePin}
                    className={PRIMARY_BUTTON}
                  >
                    <Fingerprint /> {busy ? status || "Upgrading…" : error ? "Try again" : "Upgrade now"}
                  </Button>
                  <p className="text-center text-[13px] text-muted-foreground">
                    Keep this page open until it finishes. If it stops, sign in again to continue where it left off.
                  </p>
                </div>
              </>
            )}

            {phase === "migrate-finish" && (
              <>
                <div className="text-center">
                  <ShieldCheck className="mx-auto size-8 text-primary" aria-hidden="true" />
                  <h1 className="mt-4 text-[28px] font-medium text-foreground">Finish your upgrade</h1>
                  <p className="mt-3 text-[15px] leading-6 text-muted-foreground">
                    Your upgrade stopped before your balance finished moving. Enter your PIN to complete it.
                  </p>
                </div>
                <form onSubmit={handleFinishUpgrade} className="mt-8 space-y-6">
                  {pinInput({ value: pin, onChange: setPin, placeholder: "••••••", autoComplete: "off", autoFocus: true })}
                  <StatusLine status={status} error={error} />
                  <Button type="submit" disabled={busy} className={PRIMARY_BUTTON}>
                    {busy ? status || "Finishing…" : "Finish upgrade"}
                  </Button>
                </form>
              </>
            )}

            {phase === "recover" && (
              <>
                <div className="text-center">
                  <LifeBuoy className="mx-auto size-8 text-primary" aria-hidden="true" />
                  <h1 className="mt-4 text-[28px] font-medium text-foreground">Recover your wallet</h1>
                  <p className="mt-3 text-[15px] leading-6 text-muted-foreground">
                    Enter the recovery code you saved for{" "}
                    <span className="font-semibold text-foreground">{email}</span>. It works once; you'll get a new one.
                  </p>
                </div>
                <form onSubmit={handleRecover} className="mt-8 space-y-6">
                  <Input
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                    value={recoveryInput}
                    onChange={(e) => setRecoveryInput(e.target.value.toUpperCase())}
                    required
                    autoFocus
                    disabled={busy}
                    className="text-center font-mono tracking-wider"
                  />
                  <StatusLine status={status} error={error} />
                  <Button type="submit" disabled={busy || recoveryInput.replace(/[\s-]/g, "").length < 28} className={PRIMARY_BUTTON}>
                    {busy ? status || "Checking…" : "Recover wallet"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      resetMessages();
                      setPhase("unlock");
                    }}
                    disabled={busy}
                    className={SECONDARY_BUTTON}
                  >
                    Back
                  </Button>
                </form>
              </>
            )}

            {phase === "recover-pin" && (
              <>
                <div className="text-center">
                  <KeyRound className="mx-auto size-8 text-primary" aria-hidden="true" />
                  <h1 className="mt-4 text-[28px] font-medium text-foreground">Choose a new PIN</h1>
                  <p className="mt-3 text-[15px] leading-6 text-muted-foreground">
                    Your wallet is unlocked. Set a new 6-digit PIN, then save your new recovery code.
                  </p>
                </div>
                <form onSubmit={handleRecoverPin} className="mt-8 space-y-6">
                  {pinInput({ value: pin, onChange: setPin, placeholder: "New 6-digit PIN", autoComplete: "new-password", autoFocus: true })}
                  {pinInput({ value: pinConfirm, onChange: setPinConfirm, placeholder: "Confirm new PIN", autoComplete: "new-password" })}
                  <StatusLine status={status} error={error} />
                  <Button type="submit" disabled={busy} className={PRIMARY_BUTTON}>
                    {busy ? status || "Saving…" : "Save PIN"}
                  </Button>
                </form>
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

export default AuthPage;
