import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Copy, Wallet } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

import { AppTopbar } from "@/components/AppTopbar";
import { Button } from "@/components/ui/button";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { PageTransition } from "@/components/PageTransition";
import { getUser, type SessionUser } from "@/lib/auth";
import { fetchGatewayAddress } from "@/lib/backend";
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

      setWalletMessage(`Deposit of ${amt} ${selectedAsset} submitted! Tx: ${hash.slice(0, 8)}... (Auto-shielding in ~5s)`);
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
                <section className="dash-card qr-card flex flex-col items-center justify-center gap-4">
                  <div className="text-center">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      SEP-0007 Stellar QR Code
                    </span>
                    <p className="text-xs text-muted-foreground mt-1">
                      Scan with LOBSTR, Solar, or any Stellar wallet
                    </p>
                  </div>
                  <div className="qr-wrap bg-white p-4 rounded-2xl shadow-sm">
                    <QRCodeSVG value={sep0007Uri} size={150} />
                  </div>
                  <div className="w-full max-w-xs flex gap-2">
                    <input
                      type="text"
                      readOnly
                      value={sep0007Uri}
                      className="w-full bg-background border border-border rounded-lg px-2 py-1 text-[11px] font-mono text-muted-foreground truncate"
                    />
                    <CopyButton value={sep0007Uri} label="Copy SEP-0007 URI" />
                  </div>
                </section>

                <section className="dash-card qr-card">
                  <span className="qr-label">Deposit Address QR</span>
                  <div className="qr-wrap">
                    <QRCodeSVG value={gatewayAddress} size={130} />
                  </div>
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

