import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUp,
  Download,
  Droplets,
  Eye,
  EyeOff,
  Receipt,
  Send,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { AppTopbar } from "@/components/AppTopbar";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { getUser, getViewingSecret, unlockWalletWithPin, isWalletUnlocked, signOut, type SessionUser } from "@/lib/auth";
import { fetchNotes, fetchStats, fetchTransactions, type BackendTransaction } from "@/lib/backend";
import { calculateShieldedBalances, decodeTransaction } from "@/lib/notes";
import { useSidebar } from "@/lib/sidebar";
import { Lock, Unlock, KeyRound, Fingerprint } from "lucide-react";
import {
  isPasskeySupported,
  authenticatePasskey,
  registerPasskey,
  hasBiometricEnrolled,
  saveBiometricVault,
  unlockBiometricVault,
  deriveKeysFromPasskeySeed,
} from "@/lib/passkey";

const actionButtonClass = "hover:bg-dashboard-blue hover:text-primary-foreground";

function DashboardPage() {
  const navigate = useNavigate();
  const [balanceHidden, setBalanceHidden] = useState(false);
  const [checking, setChecking] = useState(true);
  const { collapsed, toggleCollapsed, mobileOpen, setMobileOpen } = useSidebar();
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [showBiometricPrompt, setShowBiometricPrompt] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");
  const [pinLoading, setPinLoading] = useState(false);
  const [displayName, setDisplayName] = useState("Jane");
  const [companyName, setCompanyName] = useState("Starlit Pay");
  const [recentTxs, setRecentTxs] = useState<BackendTransaction[]>([]);
  const [tvl, setTvl] = useState<string | null>(null);
  const [balances, setBalances] = useState({ usdc: 0, xlm: 0, totalUsd: 0 });

  useEffect(() => {
    document.title = "Dashboard — Starlit Pay";
    let cancelled = false;
    void getUser().then(async (user) => {
      if (cancelled) return;
      if (!user) {
        navigate("/auth", { replace: true });
        return;
      }
      setCurrentUser(user);
      const name = user.display_name || user.username || user.email.split("@")[0] || user.email;
      setDisplayName(name.charAt(0).toUpperCase() + name.slice(1));
      setCompanyName(user.username ? `@${user.username}` : "Starlit Pay");
      setChecking(false);

      // Check if wallet is already unlocked
      let viewingSecret = getViewingSecret(user.email);
      if (!viewingSecret) {
        setIsUnlocked(false);
        // Step 1: If user has enrolled biometric on this device, prompt Face ID / Touch ID automatically!
        if (hasBiometricEnrolled(user.email) && isPasskeySupported()) {
          try {
            const authRes = await authenticatePasskey();
            const secrets = unlockBiometricVault(user.email, authRes.seedHex);
            if (secrets) {
              localStorage.setItem(`starlit_viewing_secret:${user.email.toLowerCase()}`, secrets.viewingSecret);
              localStorage.setItem(`starlit_secret:${user.email.toLowerCase()}`, secrets.stellarSecret);
              localStorage.setItem(`starlit_spending:${user.email.toLowerCase()}`, secrets.spendingKey);
              viewingSecret = secrets.viewingSecret;
              setIsUnlocked(true);
            } else {
              setShowPinModal(true);
            }
          } catch {
            // User cancelled or biometric failed: fallback to 6-digit PIN modal
            setShowPinModal(true);
          }
        } else {
          // Step 2: No biometric on this device yet: show 6-digit PIN unlock modal
          setShowPinModal(true);
        }
      } else {
        setIsUnlocked(true);
      }

      // Load cached balance if present
      try {
        const cached = localStorage.getItem(`starlit_balance_${user.id}`);
        if (cached) setBalances(JSON.parse(cached));
      } catch {}

      // Fetch latest notes to compute real shielded balance
      if (user.public_encryption_key) {
        void fetchNotes(user.public_encryption_key)
          .then((res) => {
            if (cancelled) return;
            const summary = calculateShieldedBalances(res.notes, viewingSecret);
            setBalances(summary);
            try {
              localStorage.setItem(`starlit_balance_${user.id}`, JSON.stringify(summary));
            } catch {}
          })
          .catch(() => {});
      }

      void fetchTransactions(user.id)
        .then((res) => {
          if (!cancelled) setRecentTxs(res.transactions.slice(0, 4));
        })
        .catch(() => {});
    });
    void fetchStats()
      .then((s) => {
        if (!cancelled) setTvl(s.tvlFormatted);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  async function handlePinSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!currentUser) return;
    if (pinInput.length !== 6) {
      setPinError("PIN must be exactly 6 digits.");
      return;
    }
    setPinLoading(true);
    setPinError("");
    try {
      const res = await unlockWalletWithPin(currentUser.email, pinInput, currentUser.identity_commitment || undefined);
      if (!res.success) {
        setPinError(res.error || "Incorrect PIN. Please try again.");
        return;
      }
      setIsUnlocked(true);
      setShowPinModal(false);
      setPinInput("");
      const viewingSecret = getViewingSecret(currentUser.email);
      if (currentUser.public_encryption_key) {
        const notesRes = await fetchNotes(currentUser.public_encryption_key);
        const summary = calculateShieldedBalances(notesRes.notes, viewingSecret);
        setBalances(summary);
        localStorage.setItem(`starlit_balance_${currentUser.id}`, JSON.stringify(summary));
      }

      // Step 3: Prompt user to enable Face ID / Touch ID / Windows Hello if not enrolled yet!
      if (!hasBiometricEnrolled(currentUser.email) && isPasskeySupported()) {
        setShowBiometricPrompt(true);
      }
    } catch (err) {
      setPinError(err instanceof Error ? err.message : "Unlock failed.");
    } finally {
      setPinLoading(false);
    }
  }

  async function handleEnrollBiometrics() {
    if (!currentUser) return;
    setPinLoading(true);
    setPinError("");
    try {
      const viewingSecret = getViewingSecret(currentUser.email);
      const stellarSecret = localStorage.getItem(`starlit_secret:${currentUser.email.toLowerCase()}`);
      const spendingKey = localStorage.getItem(`starlit_spending:${currentUser.email.toLowerCase()}`);
      if (!viewingSecret || !stellarSecret || !spendingKey) {
        throw new Error("Wallet secrets must be unlocked first.");
      }
      const regRes = await registerPasskey(currentUser.username || "user", currentUser.display_name || "User");
      saveBiometricVault(
        currentUser.email,
        regRes.seedHex,
        { viewingSecret, stellarSecret, spendingKey },
        regRes.credentialId
      );
      setShowBiometricPrompt(false);
    } catch (err) {
      setPinError(err instanceof Error ? err.message : "Biometric enrollment failed.");
    } finally {
      setPinLoading(false);
    }
  }

  async function handlePasskeyUnlock() {
    if (!currentUser) return;
    setPinLoading(true);
    setPinError("");
    try {
      const authRes = await authenticatePasskey();
      const secrets = unlockBiometricVault(currentUser.email, authRes.seedHex);
      let viewingSecret = "";
      if (secrets) {
        localStorage.setItem(`starlit_viewing_secret:${currentUser.email.toLowerCase()}`, secrets.viewingSecret);
        localStorage.setItem(`starlit_secret:${currentUser.email.toLowerCase()}`, secrets.stellarSecret);
        localStorage.setItem(`starlit_spending:${currentUser.email.toLowerCase()}`, secrets.spendingKey);
        viewingSecret = secrets.viewingSecret;
      } else {
        const keys = await deriveKeysFromPasskeySeed(authRes.seedHex);
        localStorage.setItem(`starlit_viewing_secret:${currentUser.email.toLowerCase()}`, keys.viewing.secretKey);
        localStorage.setItem(`starlit_secret:${currentUser.email.toLowerCase()}`, keys.stellar.secretKey);
        localStorage.setItem(`starlit_spending:${currentUser.email.toLowerCase()}`, keys.spendingKey);
        viewingSecret = keys.viewing.secretKey;
      }
      setIsUnlocked(true);
      setShowPinModal(false);
      if (currentUser.public_encryption_key) {
        const notesRes = await fetchNotes(currentUser.public_encryption_key);
        const summary = calculateShieldedBalances(notesRes.notes, viewingSecret);
        setBalances(summary);
        localStorage.setItem(`starlit_balance_${currentUser.id}`, JSON.stringify(summary));
      }
    } catch (err) {
      setPinError(err instanceof Error ? err.message : "Passkey biometric unlock failed.");
    } finally {
      setPinLoading(false);
    }
  }

  function handleDownloadStatement() {
    if (recentTxs.length === 0) {
      navigate("/transactions");
      return;
    }
    const header = "ID,Type,Amount,Asset,Party,Date\n";
    const rows = recentTxs
      .map((tx) => {
        const dec = decodeTransaction(tx);
        return `"${dec.id || ""}","${dec.type}","${dec.amount}","${dec.asset}","${dec.party}","${dec.createdAt || ""}"`;
      })
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `starlit-statement-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }


  async function handleSignOut() {
    await signOut();
    window.location.href = "/auth";
  }

  const chartRef = useRef<HTMLDivElement>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [hoverY, setHoverY] = useState<number | null>(null);
  const [hoverBalance, setHoverBalance] = useState<string | null>(null);

  const chartPoints = [
    { x: 0, y: 84, balance: "$1,142,300" },
    { x: 48, y: 55, balance: "$1,148,500" },
    { x: 82, y: 15, balance: "$1,155,200" },
    { x: 114, y: 89, balance: "$1,149,800" },
    { x: 160, y: 106, balance: "$1,147,400" },
    { x: 203, y: 104, balance: "$1,148,100" },
    { x: 250, y: 110, balance: "$1,146,900" },
    { x: 294, y: 98, balance: "$1,148,700" },
    { x: 335, y: 102, balance: "$1,148,200" },
    { x: 369, y: 94, balance: "$1,149,500" },
    { x: 402, y: 123, balance: "$1,145,600" },
    { x: 443, y: 112, balance: "$1,147,200" },
    { x: 481, y: 97, balance: "$1,149,100" },
    { x: 520, y: 73, balance: "$1,152,400" },
    { x: 564, y: 88, balance: "$1,150,200" },
    { x: 596, y: 106, balance: "$1,147,800" },
    { x: 620, y: 42, balance: "$1,156,908" },
  ];

  function onChartMove(event: React.MouseEvent<HTMLDivElement>) {
    const rect = chartRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const svgX = (x / rect.width) * 620;
    const nearest = chartPoints.reduce((prev, curr) =>
      Math.abs(curr.x - svgX) < Math.abs(prev.x - svgX) ? curr : prev,
    );
    setHoverX(nearest.x);
    setHoverY(nearest.y);
    setHoverBalance(nearest.balance);
  }

  function onChartLeave() {
    setHoverX(null);
    setHoverY(null);
    setHoverBalance(null);
  }

  if (checking) return null;

  return (
    <div className="dashboard-frame">
      <DashboardSidebar
        open={mobileOpen}
        collapsed={collapsed}
        onToggle={toggleCollapsed}
        onClose={() => setMobileOpen(false)}
        companyName={companyName}
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

        <motion.main
          className="dashboard-content"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] as [number, number, number, number] }}
        >
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] as [number, number, number, number], delay: 0.05 }}
          >
            <h1>Welcome, {displayName}</h1>

            <div className="action-row">
            <Button
              variant="secondary"
              className={actionButtonClass}
              onClick={() => navigate("/send")}
            >
              <Send />
              Send
            </Button>
            <Button
              variant="secondary"
              className={actionButtonClass}
              onClick={() => navigate("/receive")}
            >
              <ArrowDownLeft />
              Receive
            </Button>
            <Button variant="secondary" className={actionButtonClass} disabled>
              <ArrowLeftRight />
              Swap
              <span className="soon-pill">Soon</span>
            </Button>
            <Button
              variant="secondary"
              className={actionButtonClass}
              onClick={() => navigate("/send?mode=external")}
            >
              <ArrowUp />
              Withdraw
            </Button>
            <Button
              variant="secondary"
              className={actionButtonClass}
              onClick={() => navigate("/faucet")}
            >
              <Droplets />
              Faucet
            </Button>
            <Button
              variant="secondary"
              className={actionButtonClass}
              onClick={handleDownloadStatement}
            >
              <Download />
              Download Statement
            </Button>
          </div>
          </motion.div>

          <div className="balance-grid">
            <section className="dash-card balance-card">
              <div className="card-title-row">
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span>Private balance</span>
                  {!isUnlocked ? (
                    <button
                      type="button"
                      onClick={() => setShowPinModal(true)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                        padding: "2px 8px",
                        fontSize: "11px",
                        fontWeight: 600,
                        borderRadius: "9999px",
                        backgroundColor: "rgba(245, 158, 11, 0.15)",
                        color: "#f59e0b",
                        border: "none",
                        cursor: "pointer",
                      }}
                      title="Wallet locked — click to enter PIN"
                    >
                      <Lock style={{ width: "12px", height: "12px" }} />
                      Locked
                    </button>
                  ) : (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                        padding: "2px 8px",
                        fontSize: "11px",
                        fontWeight: 600,
                        borderRadius: "9999px",
                        backgroundColor: "rgba(16, 185, 129, 0.15)",
                        color: "#10b981",
                      }}
                    >
                      <Unlock style={{ width: "12px", height: "12px" }} />
                      Shielded
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className="balance-eye"
                  onClick={() => setBalanceHidden((value) => !value)}
                  aria-label={balanceHidden ? "Show balance" : "Hide balance"}
                >
                  {balanceHidden ? <EyeOff /> : <Eye />}
                </button>
              </div>
              <div className="balance">
                {balanceHidden ? (
                  "$ ••••••"
                ) : (
                  <>
                    ${balances.totalUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).split(".")[0]}
                    <sup>.{balances.totalUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).split(".")[1]}</sup>
                  </>
                )}
              </div>
              <div
                className="chart-wrap"
                ref={chartRef}
                onMouseMove={onChartMove}
                onMouseLeave={onChartLeave}
              >
                <svg
                  viewBox="0 0 620 210"
                  preserveAspectRatio="none"
                  role="img"
                  aria-label="Balance trend over the last 30 days"
                >
                  <defs>
                    <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor="var(--chart-line)" stopOpacity=".2" />
                      <stop offset="1" stopColor="var(--chart-line)" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path
                    className="chart-area"
                    d="M0 84 C18 40 33 77 48 55 S70 22 82 15 S92 107 114 89 S137 130 160 106 S181 123 203 104 S228 132 250 110 S275 121 294 98 S318 124 335 102 S350 142 369 94 S390 90 402 123 S425 105 443 112 S465 87 481 97 S505 112 520 73 S550 69 564 88 S596 106 620 42 L620 210 L0 210 Z"
                  />
                  <path
                    className="chart-line"
                    d="M0 84 C18 40 33 77 48 55 S70 22 82 15 S92 107 114 89 S137 130 160 106 S181 123 203 104 S228 132 250 110 S275 121 294 98 S318 124 335 102 S350 142 369 94 S390 90 402 123 S425 105 443 112 S465 87 481 97 S505 112 520 73 S550 69 564 88 S596 106 620 42"
                  />
                  {hoverX !== null && hoverY !== null && (
                    <line
                      x1={hoverX}
                      y1={hoverY}
                      x2={hoverX}
                      y2={210}
                      stroke="var(--color-muted-foreground)"
                      strokeDasharray="3 3"
                      opacity="0.4"
                    />
                  )}
                  {hoverX !== null && hoverY !== null && (
                    <circle
                      cx={hoverX}
                      cy={hoverY}
                      r="4"
                      fill="var(--color-primary)"
                      stroke="var(--color-primary-foreground)"
                      strokeWidth="2"
                    />
                  )}
                </svg>
                {hoverBalance && (
                  <div className="chart-tooltip" style={{ left: `${hoverX}px`, top: `${hoverY}px` }}>
                    {hoverBalance}
                  </div>
                )}
              </div>
              <div className="balance-filters">
                {[
                  "1m",
                  "5m",
                  "15m",
                  "30m",
                  "1H",
                  "4H",
                  "1D",
                  "7D",
                  "30D",
                  "90D",
                  "1Y",
                  "ALL",
                ].map((range, idx) => (
                  <button key={`${range}-${idx}`} type="button" className="range-btn">
                    {range}
                  </button>
                ))}
              </div>
            </section>

            <section className="dash-card balance-card holdings-card">
              <div className="card-title-row">
                <span>Holdings</span>
              </div>
              <div className="holdings-list">
                <div className="holding-row">
                  <span className="holding-label">USDC</span>
                  <strong className={balanceHidden ? "holding-masked" : ""}>
                    {balanceHidden ? "••••••" : balances.usdc.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </strong>
                </div>
                <div className="holding-divider" />
                <div className="holding-row">
                  <span className="holding-label">XLM</span>
                  <strong className={balanceHidden ? "holding-masked" : ""}>
                    {balanceHidden ? "••••••" : balances.xlm.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </strong>
                </div>
              </div>
            </section>
          </div>

          <section className="dash-card activity-card">
            <div className="card-title-row">
              <span>Recent Activity</span>
              <Button
                variant="ghost"
                className="view-more-btn"
                onClick={() => navigate("/transactions")}
              >
                View More
              </Button>
            </div>
            <ul className="activity-list">
              {recentTxs.map((tx, i) => {
                const dec = decodeTransaction(tx);
                const isPositive = dec.type === "receive" || dec.type === "faucet";
                return (
                  <li key={tx.id ?? i}>
                    <span className="activity-icon icon-blue">
                      {dec.type === "withdraw" ? <ArrowUp /> : <Send />}
                    </span>
                    <div className="activity-copy">
                      <b>{dec.type === "withdraw" ? "Withdrawal" : dec.type === "faucet" ? "Faucet funding" : "Shielded payment"}</b>
                      <small>{dec.party} · {dec.createdAt ? new Date(dec.createdAt).toLocaleDateString() : "Recorded"}</small>
                    </div>
                    <strong className={isPositive ? "amount-positive" : "amount-negative"}>
                      {dec.amount > 0 ? `${isPositive ? "+" : "-"}${dec.amount.toFixed(2)} ${dec.asset}` : "—"}
                    </strong>
                  </li>
                );
              })}
              {recentTxs.length === 0 && (
                <li>
                  <span className="activity-icon icon-blue">
                    <Receipt />
                  </span>
                  <div className="activity-copy">
                    <b>No activity yet</b>
                    <small>{tvl ? `Network TVL: ${tvl}` : "Your transactions will appear here"}</small>
                  </div>
                  <strong className="amount-negative">—</strong>
                </li>
              )}
            </ul>
          </section>
        </motion.main>
      </div>

      {showPinModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(0, 0, 0, 0.65)",
            backdropFilter: "blur(4px)",
            padding: "16px",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "380px",
              borderRadius: "16px",
              backgroundColor: "var(--card-bg, #18191b)",
              border: "1px solid var(--border-color, #27272a)",
              padding: "24px",
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
              <div
                style={{
                  width: "40px",
                  height: "40px",
                  borderRadius: "50%",
                  backgroundColor: "rgba(99, 102, 241, 0.15)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#6366f1",
                }}
              >
                <KeyRound style={{ width: "20px", height: "20px" }} />
              </div>
              <div>
                <h3 style={{ fontSize: "16px", fontWeight: 600, margin: 0 }}>Unlock Private Wallet</h3>
                <p style={{ fontSize: "12px", color: "var(--text-muted, #a1a1aa)", margin: 0 }}>
                  Enter your 6-digit security PIN or authenticate with biometrics
                </p>
              </div>
            </div>

            {isPasskeySupported() && hasBiometricEnrolled(currentUser?.email || "") && (
              <div style={{ marginBottom: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
                <Button
                  type="button"
                  variant="default"
                  onClick={handlePasskeyUnlock}
                  disabled={pinLoading}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "8px",
                    width: "100%",
                    padding: "10px 0",
                    fontWeight: 600,
                  }}
                >
                  <Fingerprint style={{ width: "18px", height: "18px" }} />
                  Unlock with Biometrics (Passkey)
                </Button>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", margin: "8px 0" }}>
                  <div style={{ flex: 1, height: "1px", backgroundColor: "var(--border-color, #27272a)" }} />
                  <span style={{ fontSize: "11px", color: "var(--text-muted, #71717a)" }}>or enter PIN</span>
                  <div style={{ flex: 1, height: "1px", backgroundColor: "var(--border-color, #27272a)" }} />
                </div>
              </div>
            )}

            <form onSubmit={handlePinSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div>
                <input
                  type="password"
                  maxLength={6}
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ""))}
                  placeholder="••••••"
                  style={{
                    width: "100%",
                    textAlign: "center",
                    fontSize: "24px",
                    letterSpacing: "0.4em",
                    padding: "12px 0",
                    borderRadius: "8px",
                    border: "1px solid var(--border-color, #27272a)",
                    backgroundColor: "var(--input-bg, #09090b)",
                    color: "inherit",
                    outline: "none",
                    fontFamily: "monospace",
                  }}
                  autoFocus
                />
                {pinError && (
                  <p style={{ fontSize: "12px", color: "#ef4444", margin: "6px 0 0 0" }}>{pinError}</p>
                )}
              </div>

              <div style={{ display: "flex", gap: "8px" }}>
                <Button
                  type="button"
                  variant="outline"
                  style={{ flex: 1 }}
                  onClick={() => {
                    setShowPinModal(false);
                    setPinError("");
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" style={{ flex: 1 }} disabled={pinLoading || pinInput.length !== 6}>
                  {pinLoading ? "Decrypting..." : "Unlock"}
                </Button>
              </div>

              <div style={{ textAlign: "center", marginTop: "4px" }}>
                <button
                  type="button"
                  onClick={handleSignOut}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--text-muted, #a1a1aa)",
                    fontSize: "12px",
                    cursor: "pointer",
                    textDecoration: "underline",
                    padding: "4px 8px"
                  }}
                >
                  Sign out or switch account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showBiometricPrompt && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 110,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(0, 0, 0, 0.7)",
            backdropFilter: "blur(4px)",
            padding: "16px",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "400px",
              borderRadius: "16px",
              backgroundColor: "var(--card-bg, #18191b)",
              border: "1px solid var(--border-color, #27272a)",
              padding: "24px",
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: "52px",
                height: "52px",
                borderRadius: "50%",
                backgroundColor: "rgba(99, 102, 241, 0.15)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#6366f1",
                marginBottom: "16px",
              }}
            >
              <Fingerprint style={{ width: "26px", height: "26px" }} />
            </div>
            <h3 style={{ fontSize: "18px", fontWeight: 600, margin: "0 0 8px 0" }}>Enable Biometric Unlock?</h3>
            <p style={{ fontSize: "13px", color: "var(--text-muted, #a1a1aa)", margin: "0 0 20px 0", lineHeight: 1.5 }}>
              Use Touch ID, Face ID, or Windows Hello on this device to unlock your private wallet and authorize transactions instantly without entering your 6-digit PIN.
            </p>
            {pinError && (
              <p style={{ fontSize: "12px", color: "#ef4444", margin: "0 0 16px 0" }}>{pinError}</p>
            )}
            <div style={{ display: "flex", gap: "10px" }}>
              <Button
                type="button"
                variant="outline"
                style={{ flex: 1 }}
                onClick={() => setShowBiometricPrompt(false)}
                disabled={pinLoading}
              >
                Skip for now
              </Button>
              <Button
                type="button"
                style={{ flex: 1 }}
                onClick={handleEnrollBiometrics}
                disabled={pinLoading}
              >
                {pinLoading ? "Enrolling..." : "Enable Biometrics"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DashboardPage;
