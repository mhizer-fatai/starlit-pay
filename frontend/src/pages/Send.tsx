import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  AtSign,
  Check,
  ChevronDown,
  Fingerprint,
  Hash,
  Loader2,
  QrCode,
  Send,
  TriangleAlert,
  Wallet,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { AppTopbar } from "@/components/AppTopbar";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { PageTransition } from "@/components/PageTransition";
import { ReceiptModal } from "@/components/ReceiptModal";
import { Input } from "@/components/ui/input";
import { getSpendingKey, getUser, getViewingSecret, isVaultMode, signAuthRequest, type SessionUser } from "@/lib/auth";
import { isValidPin } from "@/lib/keys";
import { confirmPaymentWithPasskey, confirmPaymentWithPin, friendlyAuthError } from "@/lib/passkeyAccount";
import { selfNoteSecret } from "@/lib/ownedNotes";
import { withNoteLock } from "@/lib/reshield";
import {
  lookupUser,
  postNote,
  postTransaction,
  fetchNotes,
  spendNote,
  claimPaymentLink,
  submitRelayerTransfer,
  submitRelayerWithdraw,
} from "@/lib/backend";
import { getSpendableNotes, spendRootFor } from "@/lib/notes";
import { bytesToHex, encryptNote } from "@/lib/crypto";
import { calculateCommitment, generateShieldedPaymentProof } from "@/lib/zk";
import { TOKENS } from "@/lib/stellar";
import {
  formatGrouped,
  loadPrivateBalances,
  type ActivityItem,
} from "@/lib/wallet";
import { useSidebar } from "@/lib/sidebar";

function SlideToConfirm({ label, onComplete }: { label: string; onComplete: () => void }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [maxDrag, setMaxDrag] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const dragXRef = useRef(0);
  const maxDragRef = useRef(0);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    const track = trackRef.current;
    if (!track || confirmed) return;
    const max = Math.max(track.offsetWidth - 54, 0);
    maxDragRef.current = max;
    setMaxDrag(max);
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!dragging || confirmed) return;
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.min(Math.max(event.clientX - rect.left - 28, 0), maxDragRef.current);
    dragXRef.current = x;
    setDragX(x);
  }

  function onPointerUp() {
    if (!dragging || confirmed) return;
    setDragging(false);
    if (maxDragRef.current > 0 && dragXRef.current >= maxDragRef.current - 2) {
      setConfirmed(true);
      return;
    }
    dragXRef.current = 0;
    setDragX(0);
  }

  useEffect(() => {
    if (!confirmed) return;
    const timer = window.setTimeout(() => onCompleteRef.current(), 900);
    return () => window.clearTimeout(timer);
  }, [confirmed]);

  const progress = maxDrag > 0 ? Math.min(dragX / maxDrag, 1) : 0;

  return (
    <div ref={trackRef} className="slide-track">
      <span className="slide-label" style={{ opacity: 1 - progress }}>
        {label}
      </span>
      <span
        className="slide-fill"
        style={{
          width: `${dragX + 58}px`,
          transition: dragging ? "none" : "width 0.25s ease",
        }}
      />
      <button
        type="button"
        className="slide-knob"
        style={{
          transform: `translateX(${dragX}px)`,
          transition: dragging ? "none" : "transform 0.25s ease",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        aria-label="Slide to confirm transaction"
        disabled={confirmed}
      >
        <span className={`slide-icon ${confirmed ? "hidden" : "visible"}`}>
          <Send />
        </span>
        <span className={`slide-icon ${confirmed ? "visible" : "hidden"}`}>
          <Check />
        </span>
      </button>
    </div>
  );
}

function SendPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [checking, setChecking] = useState(true);
  const { collapsed, toggleCollapsed, mobileOpen, setMobileOpen } = useSidebar();
  const [displayName, setDisplayName] = useState("Jane");
  const [username, setUsername] = useState("");
  const [asset, setAsset] = useState("USDC");
  const [assetBalances, setAssetBalances] = useState<{ USDC: number; XLM: number }>({
    USDC: 0,
    XLM: 0,
  });
  const [balancesRefreshing, setBalancesRefreshing] = useState(false);
  const [amount, setAmount] = useState("");
  const [tagId, setTagId] = useState("");
  const [mode, setMode] = useState<"starlit" | "external">(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("mode") === "external" ? "external" : "starlit";
  });
  const [linkCommitment, setLinkCommitment] = useState<string | null>(null);
  const [assetOpen, setAssetOpen] = useState(false);
  const assetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("mode") === "external") {
      setMode("external");
    }
    const toParam = params.get("to");
    if (toParam) setUsername(toParam);
    const amtParam = params.get("amount");
    if (amtParam) setAmount(amtParam);
    const linkParam = params.get("link");
    if (linkParam) setLinkCommitment(linkParam);
  }, [location.search]);


  useEffect(() => {
    function onDocClick(event: MouseEvent) {
      if (assetRef.current && !assetRef.current.contains(event.target as Node)) {
        setAssetOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [receipt, setReceipt] = useState<ActivityItem | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanTarget, setScanTarget] = useState<"username" | "tagId">("username");
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Passkey accounts confirm each private payment with one biometric tap
  // (or the PIN). slide -> passkey -> (pin fallback)
  const [confirmStage, setConfirmStage] = useState<"slide" | "passkey" | "pin" | "pin-checking">("slide");
  const [confirmPin, setConfirmPin] = useState("");
  const [confirmError, setConfirmError] = useState("");
  const [errors, setErrors] = useState<{ username?: string; amount?: string }>({});
  const scanInputRef = useRef<HTMLInputElement>(null);

  async function handleScanQR(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      // @ts-expect-error BarcodeDetector is not in the TS lib
      const detector = new BarcodeDetector({ formats: ["qr_code"] });
      const codes = await detector.detect(bitmap);
      if (codes[0]?.rawValue) {
        if (scanTarget === "tagId") {
          setTagId(codes[0].rawValue);
        } else {
          setUsername(codes[0].rawValue);
          setErrors((prev) => ({ ...prev, username: undefined }));
        }
      }
    } catch {
      // ignore scan errors
    } finally {
      setScanning(false);
      if (scanInputRef.current) scanInputRef.current.value = "";
    }
  }

  useEffect(() => {
    document.title = "Send — Starlit Pay";
    let cancelled = false;
    void getUser().then((user) => {
      if (cancelled) return;
      if (!user) {
        navigate("/auth", { replace: true });
        return;
      }
      const name = user.display_name || user.username || user.email.split("@")[0] || user.email;
      setDisplayName(name.charAt(0).toUpperCase() + name.slice(1));
      setChecking(false);
      // Live per-asset balances for the selector (read-only here).
      void refreshAssetBalances(user).catch(() => {});
    });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  async function refreshAssetBalances(user: SessionUser) {
    setBalancesRefreshing(true);
    try {
      const balances = await loadPrivateBalances(user);
      if (balances) setAssetBalances({ USDC: balances.usdc, XLM: balances.xlm });
    } finally {
      setBalancesRefreshing(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const nextErrors: { username?: string; amount?: string } = {};
    const trimmedUsername = username.trim();
    if (!trimmedUsername) {
      nextErrors.username =
        mode === "starlit"
          ? "Recipient username is required"
          : "Recipient Stellar wallet address is required";
    } else if (mode === "starlit" && !/^[A-Za-z0-9._-]+$/.test(trimmedUsername.replace(/^@/, ""))) {
      nextErrors.username = "Use only letters, numbers, dots, dashes or underscores";
    } else if (mode === "external" && (!trimmedUsername.startsWith("G") || trimmedUsername.length !== 56)) {
      nextErrors.username = "Enter a valid 56-character Stellar public address starting with G";
    }
    if (!amount.trim()) {
      nextErrors.amount = "Amount is required";
    } else if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
      nextErrors.amount = "Enter an amount greater than 0";
    }
    setErrors(nextErrors);
    if (nextErrors.username) {
      document.getElementById("send-username")?.focus();
      return;
    }
    if (nextErrors.amount) {
      document.getElementById("send-amount")?.focus();
      return;
    }
    setConfirmOpen(true);
  }

  function closeConfirm() {
    setConfirmOpen(false);
    setConfirmStage("slide");
    setConfirmPin("");
    setConfirmError("");
  }

  function sendConfirmed() {
    closeConfirm();
    void submitPayment();
  }

  async function confirmAndSend() {
    if (!isVaultMode()) {
      sendConfirmed();
      return;
    }
    setConfirmStage("passkey");
    setConfirmError("");
    try {
      await confirmPaymentWithPasskey();
      sendConfirmed();
    } catch (err) {
      setConfirmStage("pin");
      setConfirmError(`${friendlyAuthError(err)} You can confirm with your PIN instead.`);
    }
  }

  async function confirmWithPin(event: FormEvent) {
    event.preventDefault();
    if (!isValidPin(confirmPin)) {
      setConfirmError("PIN must be exactly 6 digits.");
      return;
    }
    setConfirmStage("pin-checking");
    setConfirmError("");
    try {
      await confirmPaymentWithPin(confirmPin);
      sendConfirmed();
    } catch (err) {
      setConfirmPin("");
      setConfirmStage("pin");
      setConfirmError(friendlyAuthError(err));
    }
  }

  useEffect(() => {
    if (!confirmOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") closeConfirm();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirmOpen]);

  // Shares the note lock with background re-shielding, so both never spend the same note.
  function submitPayment() {
    return withNoteLock(submitPaymentUnlocked);
  }

  async function submitPaymentUnlocked() {
    setBusy(true);
    setMessage("Initializing transaction...");
    try {
      const me = await getUser();
      if (!me) throw new Error("Sign in first.");
      const rawTarget = username.trim();
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0) throw new Error("Enter an amount greater than 0");

      const viewingSecret = getViewingSecret(me.email);
      if (!viewingSecret) {
        throw new Error("Wallet is locked. Please unlock your wallet on the Dashboard first.");
      }

      const tokenAddress = TOKENS[asset];
      if (!tokenAddress) throw new Error(`Unsupported asset: ${asset}`);

      // 1. Fetch user's current private notes
      setMessage("Fetching your shielded notes...");
      const notesRes = await fetchNotes(me.public_encryption_key || "");
      const spendableNotes = getSpendableNotes(notesRes.notes, viewingSecret, asset);

      const totalAvailable = spendableNotes.reduce((acc, n) => acc + n.amount, 0);
      if (totalAvailable < amt) {
        throw new Error(
          `Insufficient private balance. Required: ${amt} ${asset}, Available: ${totalAvailable.toFixed(2)} ${asset}`
        );
      }

      // 2. Select input notes to cover the amount
      let remaining = amt;
      const inputNotes: typeof spendableNotes = [];
      let inputSum = 0;

      for (const note of spendableNotes) {
        inputNotes.push(note);
        inputSum += note.amount;
        remaining -= note.amount;
        if (inputNotes.length === 2 || remaining <= 0.0001) break;
      }

      if (inputSum < amt) {
        throw new Error("Unable to compose notes to cover exact payment. Try cashing out in smaller increments.");
      }

      const input1 = inputNotes[0];
      const input2 = inputNotes[1] || null;
      const spendAmount = amt;
      const changeAmount = inputSum - spendAmount;
      const spendRoot = await spendRootFor(input1);

      // Dummy note setup if only 1 input note is used
      let secret2Hex = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
      let commitment2Hex = await calculateCommitment(0, me.public_encryption_key || "", tokenAddress, secret2Hex);

      if (input2) {
        secret2Hex = input2.secret;
        commitment2Hex = input2.commitment;
      }

      // Prepare change note if any change
      let changeCommitmentHex = "0000000000000000000000000000000000000000000000000000000000000000";
      let changeEncryptedHex = "00";
      if (changeAmount > 0.0001) {
        // Change goes back to the sender, so its secret is derived from their own
        // spending key: only they can spend it (see lib/ownedNotes).
        const spendingKey = getSpendingKey(me.email);
        if (!spendingKey) throw new Error("Wallet is locked. Please unlock your wallet first.");
        const { secret: changeSecret, n: changeN } = await selfNoteSecret(spendingKey);
        changeCommitmentHex = await calculateCommitment(changeAmount, me.public_encryption_key || "", tokenAddress, changeSecret);
        const changeEncrypted = encryptNote(
          changeAmount,
          asset,
          changeSecret,
          me.username,
          me.public_encryption_key || "",
          { n: changeN }
        );
        changeEncryptedHex = changeEncrypted.ephemeralPublicKey + changeEncrypted.nonce + changeEncrypted.ciphertext;
      }

      if (mode === "external") {
        // WITHDRAWAL FLOW
        if (!rawTarget.startsWith("G") || rawTarget.length !== 56) {
          throw new Error("Enter a valid 56-character Stellar public address starting with G");
        }

        setMessage("Preparing secure withdrawal...");
        const zkData = await generateShieldedPaymentProof(
          input1.secret,
          input1.commitment,
          secret2Hex,
          commitment2Hex,
          rawTarget,
          tokenAddress,
          spendAmount,
          changeAmount,
          (msg) => setMessage(msg)
        );

        setMessage("Submitting transaction...");
        const relayerRes = await submitRelayerWithdraw({
          proof: zkData.proofHex,
          nullifier_1: zkData.nullifier1Hex,
          nullifier_2: zkData.nullifier2Hex,
          recipient: rawTarget,
          token: tokenAddress,
          amount: spendAmount,
          root: spendRoot,
          change_commitment: changeCommitmentHex,
          encrypted_change_note: changeEncryptedHex,
        });

        // 1. Save change note first if generated so user balance is preserved
        if (changeAmount > 0.0001) {
          try {
            await postNote({
              commitment: changeCommitmentHex,
              encrypted_note: changeEncryptedHex,
              recipient_viewing_key: me.public_encryption_key || "",
            });
          } catch (postErr) {
            console.error("Failed to register change note:", postErr);
          }
        }

        // 2. Mark spent notes with signed authorization request
        const timestamp = Date.now().toString();
        const signature = me?.email ? (signAuthRequest(me.email, timestamp) || undefined) : undefined;
        const spendAuth = signature ? { timestamp, signature } : {};

        try {
          await spendNote({ commitment: input1.commitment, ...spendAuth });
        } catch (spendErr) {
          console.error("Failed to mark input1 as spent in DB:", spendErr);
        }

        if (input2) {
          try {
            await spendNote({ commitment: input2.commitment, ...spendAuth });
          } catch (spendErr) {
            console.error("Failed to mark input2 as spent in DB:", spendErr);
          }
        }

        // Save transaction history
        const payload = JSON.stringify({
          to: rawTarget,
          amount: spendAmount,
          asset,
          type: "withdraw",
          hash: relayerRes.hash,
          at: new Date().toISOString(),
        });
        await postTransaction({ user_id: me.id, encrypted_payload: btoa(payload) });

        if (linkCommitment) {
          try {
            await claimPaymentLink(linkCommitment, relayerRes.hash);
          } catch (claimErr) {
            console.error("Failed to mark payment link as claimed:", claimErr);
          }
        }

        setMessage(`Withdrawal of ${spendAmount} ${asset} to ${rawTarget.slice(0, 4)}...${rawTarget.slice(-4)} completed! Tx: ${relayerRes.hash ? relayerRes.hash.slice(0, 8) + '...' : 'confirmed'}`);
        setReceipt({
          key: `withdraw-${relayerRes.hash || Date.now()}`,
          direction: "out",
          amount: spendAmount,
          asset,
          party: `${rawTarget.slice(0, 4)}...${rawTarget.slice(-4)}`,
          date: Date.now(),
          reference: relayerRes.hash || rawTarget,
          referenceLabel: "Withdrawal Tx",
          hash: relayerRes.hash,
        });
        void refreshAssetBalances(me).catch(() => {});
        setUsername("");
        setAmount("");
      } else {
        // SEND TO STARLIT USER FLOW
        const recipient = rawTarget.replace(/^@/, "");
        setMessage(`Connecting with @${recipient}...`);
        const found = await lookupUser(recipient);
        if (!found?.user?.public_encryption_key) {
          throw new Error(`User @${recipient} has not set up their encryption keys.`);
        }
        const recipientViewingKey = found.user.public_encryption_key;
        const recipientStellarAddress = found.user.stellar_address || found.user.public_encryption_key;

        const recipientSecret = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
        const recipientCommitmentHex = await calculateCommitment(
          spendAmount,
          recipientViewingKey,
          tokenAddress,
          recipientSecret
        );
        const recipientEncrypted = encryptNote(
          spendAmount,
          asset,
          recipientSecret,
          me.username,
          recipientViewingKey
        );
        const recipientEncryptedHex =
          recipientEncrypted.ephemeralPublicKey + recipientEncrypted.nonce + recipientEncrypted.ciphertext;

        setMessage("Preparing secure payment...");
        const zkData = await generateShieldedPaymentProof(
          input1.secret,
          input1.commitment,
          secret2Hex,
          commitment2Hex,
          recipientStellarAddress,
          tokenAddress,
          spendAmount,
          changeAmount,
          (msg) => setMessage(msg)
        );

        setMessage("Sending payment...");

        const relayerRes = await submitRelayerTransfer({
          proof: zkData.proofHex,
          nullifier_1: zkData.nullifier1Hex,
          nullifier_2: zkData.nullifier2Hex,
          output_commitment_1: recipientCommitmentHex,
          encrypted_note_1: recipientEncryptedHex,
          output_commitment_2: changeCommitmentHex,
          encrypted_note_2: changeEncryptedHex,
          root: spendRoot,
        });

        // 1. Save recipient note first
        try {
          await postNote({
            commitment: recipientCommitmentHex,
            encrypted_note: recipientEncryptedHex,
            recipient_viewing_key: recipientViewingKey,
          });
        } catch (postErr) {
          console.error("Failed to register recipient note:", postErr);
        }

        // 2. Save change note if generated
        if (changeAmount > 0.0001) {
          try {
            await postNote({
              commitment: changeCommitmentHex,
              encrypted_note: changeEncryptedHex,
              recipient_viewing_key: me.public_encryption_key || "",
            });
          } catch (postErr) {
            console.error("Failed to register change note:", postErr);
          }
        }

        // 3. Mark spent notes with signed authorization request
        const timestamp = Date.now().toString();
        const signature = me?.email ? (signAuthRequest(me.email, timestamp) || undefined) : undefined;
        const spendAuth = signature ? { timestamp, signature } : {};

        try {
          await spendNote({ commitment: input1.commitment, ...spendAuth });
        } catch (spendErr) {
          console.error("Failed to mark input1 as spent in DB:", spendErr);
        }

        if (input2) {
          try {
            await spendNote({ commitment: input2.commitment, ...spendAuth });
          } catch (spendErr) {
            console.error("Failed to mark input2 as spent in DB:", spendErr);
          }
        }

        // Save transaction history
        const payload = JSON.stringify({
          to: `@${recipient}`,
          amount: spendAmount,
          asset,
          type: "send",
          hash: relayerRes.hash,
          at: new Date().toISOString(),
        });
        await postTransaction({ user_id: me.id, encrypted_payload: btoa(payload) });

        if (linkCommitment) {
          try {
            await claimPaymentLink(linkCommitment, relayerRes.hash);
          } catch (claimErr) {
            console.error("Failed to mark payment link as claimed:", claimErr);
          }
        }

        setMessage(`Sent ${spendAmount} ${asset} to @${recipient}! Tx Hash: ${relayerRes.hash ? relayerRes.hash.slice(0, 8) + '...' : 'confirmed'}`);
        setReceipt({
          key: `send-${recipientCommitmentHex}`,
          direction: "out",
          amount: spendAmount,
          asset,
          party: recipient,
          date: Date.now(),
          reference: relayerRes.hash || recipientCommitmentHex,
          referenceLabel: relayerRes.hash ? "Transaction Hash" : "Note commitment",
          hash: relayerRes.hash,
        });
        void refreshAssetBalances(me).catch(() => {});
        setUsername("");
        setAmount("");
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Send failed — try again");
    } finally {
      setBusy(false);
    }
  }


  if (checking) return null;

  return (
    <div className="dashboard-frame">
      <DashboardSidebar
        open={mobileOpen}
        collapsed={collapsed}
        onToggle={toggleCollapsed}
        onClose={() => setMobileOpen(false)}
      />
      {mobileOpen && (
        <button
          className="sidebar-backdrop"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
        />
      )}
      <div className="dashboard-main">
        <AppTopbar />
        <input
          ref={scanInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleScanQR}
        />
        <PageTransition>
          <main className="dashboard-content">
            <section className="dash-card send-card">
              <h2 className="send-title">Send Private Payment</h2>
              <div className="send-tabs" role="tablist" aria-label="Recipient type">
                <button
                  className={mode === "starlit" ? "active" : ""}
                  onClick={() => setMode("starlit")}
                  role="tab"
                  aria-selected={mode === "starlit"}
                >
                  Starlit Users
                </button>
                <button
                  className={mode === "external" ? "active" : ""}
                  onClick={() => setMode("external")}
                  role="tab"
                  aria-selected={mode === "external"}
                >
                  External Wallets (Withdraw)
                </button>
              </div>
              <form className="send-form" onSubmit={handleSubmit} noValidate>
                <div className="send-grid">
                  {mode === "starlit" ? (
                    <label className="send-label">
                      Recipient Username <span className="req">*</span>
                      <div className={`send-input ${errors.username ? "has-error" : ""}`}>
                        <AtSign />
                        <Input
                          id="send-username"
                          value={username}
                          onChange={(event) => {
                            setUsername(event.target.value);
                            setErrors((prev) => ({ ...prev, username: undefined }));
                          }}
                          placeholder="Recipient Starlit username"
                          aria-invalid={Boolean(errors.username)}
                          aria-describedby={errors.username ? "send-username-error" : undefined}
                        />
                      </div>
                      {errors.username && (
                        <span className="send-error" id="send-username-error" role="alert">
                          <TriangleAlert />
                          {errors.username}
                        </span>
                      )}
                    </label>
                  ) : (
                    <label className="send-label">
                      Recipient Wallet Address <span className="req">*</span>
                      <div className={`send-input ${errors.username ? "has-error" : ""}`}>
                        <Wallet />
                        <Input
                          id="send-username"
                          value={username}
                          onChange={(event) => {
                            setUsername(event.target.value);
                            setErrors((prev) => ({ ...prev, username: undefined }));
                          }}
                          placeholder="Recipient wallet address"
                          aria-invalid={Boolean(errors.username)}
                          aria-describedby={errors.username ? "send-username-error" : undefined}
                        />
                      </div>
                      {errors.username && (
                        <span className="send-error" id="send-username-error" role="alert">
                          <TriangleAlert />
                          {errors.username}
                        </span>
                      )}
                    </label>
                  )}

                  <label className="send-label">
                    Asset <span className="req">*</span>
                    <div className="send-select" ref={assetRef}>
                      <button
                        type="button"
                        className="send-select-trigger"
                        onClick={() => setAssetOpen((value) => !value)}
                        aria-haspopup="listbox"
                        aria-expanded={assetOpen}
                      >
                        <span>
                          {asset} ·{" "}
                          {balancesRefreshing ? (
                            <Loader2
                              className="inline size-4 animate-spin"
                              aria-label="Updating balances"
                            />
                          ) : (
                            formatGrouped(assetBalances[asset as keyof typeof assetBalances] ?? 0)
                          )}
                        </span>
                        <ChevronDown className={assetOpen ? "rotate-180" : ""} />
                      </button>
                      {assetOpen && (
                        <ul className="send-select-menu" role="listbox">
                          {["USDC", "XLM"].map((option) => (
                            <li key={option}>
                              <button
                                type="button"
                                role="option"
                                aria-selected={asset === option}
                                className={asset === option ? "selected" : ""}
                                onClick={() => {
                                  setAsset(option);
                                  setAssetOpen(false);
                                }}
                              >
                                {option} ·{" "}
                                {formatGrouped(
                                  assetBalances[option as keyof typeof assetBalances] ?? 0,
                                )}
                                {asset === option && <Check className="size-4" />}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </label>

                  <label className="send-label">
                    Amount <span className="req">*</span>
                    <div className={`send-input ${errors.amount ? "has-error" : ""}`}>
                      <span className="send-prefix">$</span>
                      <Input
                        id="send-amount"
                        className="has-prefix"
                        type="number"
                        min="0"
                        step="any"
                        value={amount}
                        onChange={(event) => {
                          setAmount(event.target.value);
                          setErrors((prev) => ({ ...prev, amount: undefined }));
                        }}
                        placeholder="0.00"
                        aria-invalid={Boolean(errors.amount)}
                        aria-describedby={errors.amount ? "send-amount-error" : undefined}
                      />
                    </div>
                    {errors.amount && (
                      <span className="send-error" id="send-amount-error" role="alert">
                        <TriangleAlert />
                        {errors.amount}
                      </span>
                    )}
                  </label>

                  {mode === "external" && (
                    <label className="send-label">
                      Tag ID
                      <div className="send-input">
                        <Hash />
                        <Input
                          value={tagId}
                          onChange={(event) => setTagId(event.target.value)}
                          placeholder="Enter Tag ID"
                        />
                        <button
                          type="button"
                          className="send-scan"
                          onClick={() => {
                            setScanning(true);
                            setScanTarget("tagId");
                            scanInputRef.current?.click();
                          }}
                          aria-label="Scan QR code"
                        >
                          <QrCode />
                        </button>
                      </div>
                    </label>
                  )}
                </div>

                {message && (
                  <p className="text-center text-xs text-muted-foreground" role="status">
                    {message}
                  </p>
                )}

                <Button type="submit" size="lg" className="w-full" disabled={busy}>
                  {busy ? (
                    <>
                      <Loader2 className="animate-spin" />
                      Sending…
                    </>
                  ) : (
                    <>
                      <Send />
                      Send {amount || "0"} {asset}
                    </>
                  )}
                </Button>
              </form>
            </section>

            {confirmOpen && (
              <div
                className="send-modal"
                role="presentation"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget && confirmStage !== "passkey") closeConfirm();
                }}
              >
                <div
                  className="send-modal-card"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="send-confirm-title"
                >
                  <div className="modal-header">
                    <h3 className="modal-title" id="send-confirm-title">
                      Confirm Transaction
                    </h3>
                    <button
                      type="button"
                      className="modal-close"
                      onClick={closeConfirm}
                      aria-label="Close"
                    >
                      <X />
                    </button>
                  </div>
                  <div className="modal-body">
                    <div className="modal-row">
                      <span className="modal-label">Asset</span>
                      <span className="modal-value">{asset}</span>
                    </div>
                    <div className="modal-row">
                      <span className="modal-label">Amount</span>
                      <span className="modal-value">
                        {amount || "0"} {asset}
                      </span>
                    </div>
                    <div className="modal-row">
                      <span className="modal-label">Recipient</span>
                      <span className="modal-value">
                        {mode === "starlit" ? `@${username.replace(/^@/, "")}` : username}
                      </span>
                    </div>
                    {tagId && (
                      <div className="modal-row">
                        <span className="modal-label">Tag ID</span>
                        <span className="modal-value">{tagId}</span>
                      </div>
                    )}
                    {confirmStage === "slide" && (
                      <SlideToConfirm
                        label={isVaultMode() ? "Slide, then confirm with your passkey" : "Slide to Confirm Transaction"}
                        onComplete={() => void confirmAndSend()}
                      />
                    )}
                    {confirmStage === "passkey" && (
                      <p className="flex items-center justify-center gap-2 py-3 text-[14px] text-muted-foreground" role="status">
                        <Fingerprint className="size-5 text-primary" /> Confirm with your fingerprint, face or screen lock…
                      </p>
                    )}
                    {(confirmStage === "pin" || confirmStage === "pin-checking") && (
                      <form onSubmit={confirmWithPin} className="space-y-3 pt-2">
                        <Input
                          type="password"
                          inputMode="numeric"
                          autoComplete="off"
                          maxLength={6}
                          placeholder="Enter your 6-digit PIN"
                          value={confirmPin}
                          onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                          autoFocus
                          disabled={confirmStage === "pin-checking"}
                          style={{ textAlign: "center", letterSpacing: "6px" }}
                        />
                        <Button type="submit" className="w-full" disabled={confirmStage === "pin-checking"}>
                          {confirmStage === "pin-checking" ? "Checking…" : "Confirm with PIN"}
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          className="w-full"
                          disabled={confirmStage === "pin-checking"}
                          onClick={() => void confirmAndSend()}
                        >
                          <Fingerprint /> Try passkey again
                        </Button>
                      </form>
                    )}
                    {confirmError && (
                      <p className="pt-2 text-sm text-red-500" role="alert">
                        {confirmError}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </main>
        </PageTransition>
        {receipt && (
          <ReceiptModal item={receipt} userName={displayName} onClose={() => setReceipt(null)} />
        )}
      </div>
    </div>
  );
}

export default SendPage;
