import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Copy, Wallet } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

import { AppTopbar } from "@/components/AppTopbar";
import { Button } from "@/components/ui/button";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { PageTransition } from "@/components/PageTransition";
import { getUser, type SessionUser } from "@/lib/auth";
import { fetchGatewayAddress, notifyGatewayDeposit } from "@/lib/backend";
import { useSidebar } from "@/lib/sidebar";
import {
  DEPOSIT_GATEWAY_ADDRESS,
  generateSep0007Uri,
  buildPublicPaymentTxXdr,
  submitSignedXdr,
  CLASSIC_TOKENS,
} from "@/lib/stellar";
import { connectWithWalletKit, signWithWalletKit } from "@/lib/walletKit";

const GATEWAY_FALLBACK = DEPOSIT_GATEWAY_ADDRESS || "GCDQQE7CPLIGMAH4QEB2SSIEAS5MZMFSQAYSEJYSF7P5ZLA6HOU4BWWY";

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="copy-icon-btn"
      aria-label={`Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? <Check /> : <Copy />}
    </Button>
  );
}

function ReceivePage() {
  const navigate = useNavigate();
  const { collapsed, toggleCollapsed, mobileOpen, setMobileOpen } = useSidebar();
  const [checking, setChecking] = useState(true);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<"USDC" | "XLM">("USDC");
  const [depositAmount, setDepositAmount] = useState("");
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletMessage, setWalletMessage] = useState("");
  const [gatewayAddress, setGatewayAddress] = useState(GATEWAY_FALLBACK);
  const [qrMode, setQrMode] = useState<"freighter" | "sep0007">("freighter");

  useEffect(() => {
    document.title = "Receive — Starlit Pay";
    let cancelled = false;
    void getUser().then((current) => {
      if (cancelled) return;
      if (!current) {
        navigate("/auth", { replace: true });
        return;
      }
      setUser(current);
      setChecking(false);
    });
    void fetchGatewayAddress()
      .then((res) => {
        if (!cancelled && res.address) setGatewayAddress(res.address);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (checking) return null;

  const username = user?.username ?? "";
  const memo = user?.deposit_memo ?? "—";
  const memoValue = user?.deposit_memo != null ? String(user.deposit_memo) : "";

  const sep0007Uri = generateSep0007Uri({
    destination: gatewayAddress,
    memo: user?.deposit_memo || undefined,
    asset: selectedAsset,
    amount: depositAmount ? parseFloat(depositAmount) : undefined,
  });

  async function handleBrowserWalletDeposit() {
    if (!user?.deposit_memo) {
      setWalletMessage("User deposit memo is missing.");
      return;
    }
    const amt = parseFloat(depositAmount);
    if (!amt || isNaN(amt) || amt <= 0) {
      setWalletMessage("Please enter an amount greater than 0 to deposit.");
      return;
    }

    setWalletLoading(true);
    setWalletMessage("Opening Stellar wallet selector...");

    try {
      const conn = await connectWithWalletKit();
      setWalletMessage(`Connected to ${conn.walletName}. Preparing transaction...`);

      const xdr = await buildPublicPaymentTxXdr(
        conn.address,
        gatewayAddress,
        amt,
        selectedAsset,
        CLASSIC_TOKENS[selectedAsset],
        user.deposit_memo
      );

      setWalletMessage(`Please sign the transaction in ${conn.walletName}...`);
      const signedXdr = await signWithWalletKit(xdr, conn.address);
      if (!signedXdr) throw new Error("Transaction signing rejected.");

      setWalletMessage("Submitting deposit to Stellar network...");
      const hash = await submitSignedXdr(signedXdr);

      setWalletMessage(`Deposit submitted! Shielding funds into private balance for tx ${hash.slice(0, 8)}...`);
      try {
        await notifyGatewayDeposit(hash);
        setWalletMessage(`Deposit of ${amt} ${selectedAsset} confirmed and shielded into your private balance!`);
      } catch {
        setWalletMessage(`Deposit of ${amt} ${selectedAsset} submitted! Tx: ${hash.slice(0, 8)}... (Auto-shielding in ~15s)`);
      }
      setDepositAmount("");
    } catch (err: unknown) {
      setWalletMessage(err instanceof Error ? err.message : "Deposit failed.");
    } finally {
      setWalletLoading(false);
    }
  }

  return (
    <div className="dashboard-frame">
      <DashboardSidebar
        open={mobileOpen}
        collapsed={collapsed}
        onToggle={toggleCollapsed}
        onClose={() => setMobileOpen(false)}
      />
      <div className="dashboard-main">
        <AppTopbar />
        <PageTransition>
          <main className="dashboard-content">
            <div className="receive-grid">
              <section className="dash-card receive-card">
                <h2 className="receive-title">Receive Private Payments</h2>

                <p className="receive-label">Starlit Username</p>
                <div className="receive-row">
                  <code>{username ? `@${username}` : "—"}</code>
                  {username && <CopyButton value={`@${username}`} label="Copy Username" />}
                </div>

                <p className="receive-label">Starlit Deposit Address (Gateway)</p>
                <div className="receive-row">
                  <code>{gatewayAddress}</code>
                  <CopyButton value={gatewayAddress} label="Copy Address" />
                </div>

                <p className="receive-label">Your Deposit Memo (MEMO ID)</p>
                <div className="receive-row">
                  <code>{memo}</code>
                  {memoValue && <CopyButton value={memoValue} label="Copy Memo" />}
                </div>

                <div className="mt-4 pt-4 border-t border-border/40 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <label className="text-xs text-muted-foreground block mb-1">Asset</label>
                      <select
                        value={selectedAsset}
                        onChange={(e) => setSelectedAsset(e.target.value as "USDC" | "XLM")}
                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
                      >
                        <option value="USDC">USDC</option>
                        <option value="XLM">XLM</option>
                      </select>
                    </div>
                    <div className="flex-1">
                      <label className="text-xs text-muted-foreground block mb-1">Amount (optional)</label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={depositAmount}
                        onChange={(e) => setDepositAmount(e.target.value)}
                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                  </div>

                  <Button
                    type="button"
                    onClick={handleBrowserWalletDeposit}
                    disabled={walletLoading}
                    className="w-full"
                  >
                    <Wallet className="mr-2 h-4 w-4" />
                    {walletLoading ? "Processing Deposit..." : `Deposit ${depositAmount || ""} ${selectedAsset} with Wallet`}
                  </Button>

                  {walletMessage && (
                    <p className="text-xs text-center text-muted-foreground break-all">
                      {walletMessage}
                    </p>
                  )}
                </div>

                <p className="receive-disclaimer mt-4">
                  <b>IMPORTANT:</b> You must include this 6-digit Memo ID when sending deposits.
                  Deposits sent without a Memo cannot be routed to your account.
                </p>
              </section>

              <div className="qr-stack">
                <section className="dash-card qr-card flex flex-col items-center justify-start gap-4">
                  <div className="w-full flex justify-center">
                    <div className="inline-flex rounded-lg bg-muted p-1 text-xs">
                      <button
                        type="button"
                        className={`px-3 py-1 rounded-md font-medium transition-all ${
                          qrMode === "freighter"
                            ? "bg-background text-foreground shadow-sm font-semibold"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                        onClick={() => setQrMode("freighter")}
                      >
                        Freighter / Address
                      </button>
                      <button
                        type="button"
                        className={`px-3 py-1 rounded-md font-medium transition-all ${
                          qrMode === "sep0007"
                            ? "bg-background text-foreground shadow-sm font-semibold"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                        onClick={() => setQrMode("sep0007")}
                      >
                        LOBSTR / Solar
                      </button>
                    </div>
                  </div>

                  <div className="text-center">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      {qrMode === "freighter" ? "Deposit Address QR" : "SEP-0007 Payment URI"}
                    </span>
                    <p className="text-xs text-muted-foreground mt-1">
                      {qrMode === "freighter"
                        ? "Scan with Freighter, mobile wallets, or exchanges"
                        : "Auto-fills address and memo in SEP-0007 wallets"}
                    </p>
                  </div>

                  <div className="qr-wrap bg-white p-4 rounded-2xl shadow-sm">
                    <QRCodeSVG
                      value={qrMode === "freighter" ? gatewayAddress : sep0007Uri}
                      size={180}
                    />
                  </div>

                  {qrMode === "freighter" && (
                    <div className="w-full bg-muted/40 border border-border/60 rounded-xl p-3 text-center space-y-1.5">
                      <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                        Required Memo ID
                      </div>
                      <div className="flex items-center justify-center gap-2">
                        <code className="text-base font-bold font-mono text-foreground tracking-wide">
                          {memo}
                        </code>
                        {memoValue && <CopyButton value={memoValue} label="Copy Memo" />}
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-tight">
                        Enter this Memo ID in Freighter when sending.
                      </p>
                    </div>
                  )}
                </section>
              </div>
            </div>
          </main>
        </PageTransition>
      </div>
    </div>
  );
}

export default ReceivePage;

