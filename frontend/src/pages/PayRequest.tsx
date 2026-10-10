import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Wallet, ShieldCheck, Clock, CheckCircle2, AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  claimPaymentLink,
  fetchPaymentLink,
  getStoredUser,
  notifyGatewayDeposit,
  type BackendUser,
} from "@/lib/backend";
import {
  DEPOSIT_GATEWAY_ADDRESS,
  buildPublicPaymentTxXdr,
  submitSignedXdr,
  CLASSIC_TOKENS,
} from "@/lib/stellar";
import { connectWithWalletKit, signWithWalletKit } from "@/lib/walletKit";

function formatTimer(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function PayRequestPage() {
  const { commitment } = useParams();
  const navigate = useNavigate();
  const currentUser = getStoredUser<BackendUser>();
  const [state, setState] = useState<{
    loading: boolean;
    error?: string;
    amount?: string;
    asset?: string;
    creator?: string;
    creatorUser?: BackendUser;
    status?: string;
    createdAt?: string;
  }>({
    loading: true,
  });
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletMessage, setWalletMessage] = useState("");
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  useEffect(() => {
    document.title = "Pay request — Starlit Pay";
    if (!commitment) {
      setState({ loading: false, error: "This payment link is malformed — ask for a new one." });
      return;
    }
    void fetchPaymentLink(commitment)
      .then((res) =>
        setState({
          loading: false,
          amount: String(res.link.amount),
          asset: res.link.asset || "USDC",
          creator: res.link.creator?.username ? `@${res.link.creator.username}` : "a Starlit user",
          creatorUser: res.link.creator,
          status: res.link.status,
          createdAt: res.link.created_at,
        }),
      )
      .catch((err) =>
        setState({
          loading: false,
          error: err instanceof Error ? err.message : "This payment link does not exist or expired.",
        }),
      );
  }, [commitment]);

  useEffect(() => {
    if (!state.createdAt) return;

    function getRemainingSeconds() {
      const createdMs = new Date(state.createdAt!).getTime();
      if (isNaN(createdMs)) return 0;
      const expiresMs = createdMs + 30 * 60 * 1000;
      return Math.max(0, Math.floor((expiresMs - Date.now()) / 1000));
    }

    const initial = getRemainingSeconds();
    setTimeLeft(initial);
    if (initial <= 0) return;

    const timer = setInterval(() => {
      const rem = getRemainingSeconds();
      setTimeLeft(rem);
      if (rem <= 0) {
        clearInterval(timer);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [state.createdAt]);

  const isClaimed = state.status === "claimed";
  const isExpired = state.status === "expired" || (timeLeft !== null && timeLeft <= 0);
  const isActionable = !isClaimed && !isExpired && state.status === "pending";

  async function handlePayWithStellarWallet() {
    if (!isActionable) {
      setWalletMessage("This payment link is no longer available.");
      return;
    }
    if (!state.creatorUser?.deposit_memo) {
      setWalletMessage("Recipient deposit memo is missing.");
      return;
    }
    const amt = parseFloat(state.amount || "0");
    if (!amt || amt <= 0) {
      setWalletMessage("Invalid payment amount.");
      return;
    }

    setWalletLoading(true);
    setWalletMessage("Opening Stellar wallet selector...");

    try {
      const conn = await connectWithWalletKit();
      setWalletMessage(`Connected to ${conn.walletName}. Preparing transaction...`);

      const assetCode = state.asset || "USDC";
      const xdr = await buildPublicPaymentTxXdr(
        conn.address,
        DEPOSIT_GATEWAY_ADDRESS,
        amt,
        assetCode,
        CLASSIC_TOKENS[assetCode],
        state.creatorUser.deposit_memo
      );

      setWalletMessage(`Please sign the transaction in ${conn.walletName}...`);
      const signedXdr = await signWithWalletKit(xdr, conn.address);
      if (!signedXdr) throw new Error("Transaction signing rejected.");

      setWalletMessage("Submitting transaction to Stellar Network...");
      const hash = await submitSignedXdr(signedXdr);

      setWalletMessage(`Payment submitted! Shielding funds for recipient...`);
      try {
        await notifyGatewayDeposit(hash);
      } catch {
        // Gateway daemon will still verify in background
      }

      if (commitment) {
        try {
          await claimPaymentLink(commitment, hash);
        } catch {
          // Link claim failure does not negate the transaction
        }
      }

      setWalletMessage(`Payment confirmed and shielded! Tx: ${hash.slice(0, 8)}...`);
      setState((prev) => ({ ...prev, status: "claimed" }));
    } catch (err: unknown) {
      setWalletMessage(err instanceof Error ? err.message : "Payment failed.");
    } finally {
      setWalletLoading(false);
    }
  }

  return (
    <main className="auth-stage">
      <div className="auth-shell">
        <section className="auth-panel">
          <div className="auth-form-wrap" style={{ textAlign: "center" }}>
            <span className="text-xs font-bold tracking-widest text-primary">STARLIT PAY</span>
            <p className="mt-1 text-xs text-muted-foreground">Payment Request · Stellar Testnet</p>
            {state.loading && <p className="mt-4 text-sm text-muted-foreground">Loading payment…</p>}
            {state.error && (
              <>
                <p className="mt-4 text-sm text-red-500">{state.error}</p>
                <Link to="/" className="mt-4 inline-block text-sm text-muted-foreground">
                  ← Go home
                </Link>
              </>
            )}
            {!state.loading && !state.error && (
              <>
                <p className="mt-2 text-[40px] font-bold">
                  {state.amount} <span className="text-sm font-normal text-muted-foreground">{state.asset}</span>
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Requested by {state.creator}
                </p>

                {isClaimed && (
                  <div className="mt-3 flex items-center justify-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Payment completed (One-time link claimed)</span>
                  </div>
                )}

                {isExpired && !isClaimed && (
                  <div className="mt-3 flex items-center justify-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-400">
                    <AlertCircle className="h-3.5 w-3.5" />
                    <span>Payment link expired (30-minute limit exceeded)</span>
                  </div>
                )}

                {isActionable && timeLeft !== null && (
                  <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-mono font-medium text-primary">
                    <Clock className="h-3.5 w-3.5 animate-pulse" />
                    <span>Expires in {formatTimer(timeLeft)}</span>
                  </div>
                )}

                <div className="mt-5 space-y-3">
                  {currentUser ? (
                    <Button
                      className="w-full"
                      disabled={!isActionable}
                      onClick={() =>
                        navigate(
                          `/send?to=${encodeURIComponent(state.creator?.replace(/^@/, "") || "")}&amount=${encodeURIComponent(state.amount || "")}&link=${encodeURIComponent(commitment || "")}`,
                        )
                      }
                    >
                      <ShieldCheck className="mr-2 h-4 w-4" />
                      Pay Privately with Starlit
                    </Button>
                  ) : (
                    <Button
                      className="w-full"
                      disabled={!isActionable}
                      onClick={() => navigate("/auth")}
                    >
                      Log in to pay with Starlit
                    </Button>
                  )}

                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={handlePayWithStellarWallet}
                    disabled={!isActionable || walletLoading}
                  >
                    <Wallet className="mr-2 h-4 w-4" />
                    {walletLoading ? "Processing..." : "Pay with Stellar Wallet (Freighter / LOBSTR)"}
                  </Button>

                  {walletMessage && (
                    <p className="text-xs text-center text-muted-foreground break-all">
                      {walletMessage}
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

export default PayRequestPage;
