import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  AtSign,
  Check,
  ChevronDown,
  Hash,
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
import { Input } from "@/components/ui/input";
import { getUser } from "@/lib/auth";
import { lookupUser, postNote, postTransaction } from "@/lib/backend";
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
  const [checking, setChecking] = useState(true);
  const { collapsed, toggleCollapsed, mobileOpen, setMobileOpen } = useSidebar();
  const [displayName, setDisplayName] = useState("Jane");
  const [username, setUsername] = useState("");
  const [asset, setAsset] = useState("USDC");
  const [amount, setAmount] = useState("");
  const [tagId, setTagId] = useState("");
  const [mode, setMode] = useState<"starlit" | "external">("starlit");
  const [assetOpen, setAssetOpen] = useState(false);
  const assetRef = useRef<HTMLDivElement>(null);

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
  const [scanning, setScanning] = useState(false);
  const [scanTarget, setScanTarget] = useState<"username" | "tagId">("username");
  const [confirmOpen, setConfirmOpen] = useState(false);
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
    });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const nextErrors: { username?: string; amount?: string } = {};
    const trimmedUsername = username.trim();
    if (!trimmedUsername) {
      nextErrors.username =
        mode === "starlit"
          ? "Recipient username is required"
          : "Recipient wallet address is required";
    } else if (mode === "starlit" && !/^[A-Za-z0-9._-]+$/.test(trimmedUsername.replace(/^@/, ""))) {
      nextErrors.username = "Use only letters, numbers, dots, dashes or underscores";
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

  function confirmAndSend() {
    setConfirmOpen(false);
    void submitPayment();
  }

  useEffect(() => {
    if (!confirmOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setConfirmOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirmOpen]);

  async function submitPayment() {
    setBusy(true);
    setMessage("");
    try {
      const me = await getUser();
      if (!me) throw new Error("Sign in first.");
      const recipient = username.trim().replace(/^@/, "");
      // Resolve recipient (read): Stellar address or username lookup.
      let recipientKey = recipient;
      if (!/^G[A-Z0-9]{55}$/.test(recipient)) {
        const found = await lookupUser(recipient);
        recipientKey = found.user.public_encryption_key || found.user.username;
      }
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0) throw new Error("Enter an amount greater than 0");
      const commitment = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
      const payload = JSON.stringify({ to: recipientKey, amount: amt, asset, at: new Date().toISOString() });
      // Writes: encrypted note + transaction record (backend stores opaque blobs).
      await postNote({
        commitment,
        encrypted_note: btoa(payload),
        recipient_viewing_key: recipientKey,
      });
      await postTransaction({ user_id: me.id, encrypted_payload: btoa(payload) });
      setMessage(`Sent ${amt} ${asset} to @${recipient} — recorded.`);
      setUsername("");
      setAmount("");
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
                  disabled
                  role="tab"
                  aria-selected={mode === "external"}
                  aria-label="External wallets — coming soon"
                >
                  External Wallets
                  <span className="soon-badge">Soon</span>
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
                        <button
                          type="button"
                          className="send-scan"
                          onClick={() => {
                            setScanning(true);
                            setScanTarget("username");
                            scanInputRef.current?.click();
                          }}
                          aria-label="Scan QR code"
                        >
                          <QrCode />
                        </button>
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
                        <span>{asset}</span>
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
                                {option}
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
                </div>

                {message && (
                  <p className="text-center text-xs text-muted-foreground" role="status">
                    {message}
                  </p>
                )}

                <Button type="submit" size="lg" className="w-full" disabled={busy}>
                  <Send />
                  Send {amount || "0"} {asset}
                </Button>
              </form>
            </section>

            {confirmOpen && (
              <div
                className="send-modal"
                role="presentation"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) setConfirmOpen(false);
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
                      onClick={() => setConfirmOpen(false)}
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
                    <SlideToConfirm
                      label="Slide to Confirm Transaction"
                      onComplete={confirmAndSend}
                    />
                  </div>
                </div>
              </div>
            )}
          </main>
        </PageTransition>
      </div>
    </div>
  );
}

export default SendPage;
