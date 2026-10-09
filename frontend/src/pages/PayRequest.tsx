import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Wallet, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { fetchPaymentLink, getStoredUser, notifyGatewayDeposit, type BackendUser } from "@/lib/backend";
import {
  DEPOSIT_GATEWAY_ADDRESS,
  buildPublicPaymentTxXdr,
  submitSignedXdr,
  CLASSIC_TOKENS,
} from "@/lib/stellar";
import { connectWithWalletKit, signWithWalletKit } from "@/lib/walletKit";

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
  }>({
    loading: true,
  });
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletMessage, setWalletMessage] = useState("");

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
        }),
      )
      .catch(() => setState({ loading: false, error: "This payment link does not exist or expired." }));
  }, [commitment]);

  async function handlePayWithStellarWallet() {
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

      setWalletMessage(`Payment confirmed and shielded! Tx: ${hash.slice(0, 8)}...`);
      setState((prev) => ({ ...prev, status: "completed" }));
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
                  {state.status === "pending" ? `Requested by ${state.creator}` : `Status: ${state.status}`}
                </p>

                <div className="mt-5 space-y-3">
                  {currentUser ? (
                    <Button
                      className="w-full"
                      onClick={() =>
                        navigate(
                          `/send?to=${encodeURIComponent(state.creator?.replace(/^@/, "") || "")}&amount=${encodeURIComponent(state.amount || "")}`,
                        )
                      }
                    >
                      <ShieldCheck className="mr-2 h-4 w-4" />
                      Pay Privately with Starlit
                    </Button>
                  ) : (
                    <Button className="w-full" onClick={() => navigate("/auth")}>
                      Log in to pay with Starlit
                    </Button>
                  )}

                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={handlePayWithStellarWallet}
                    disabled={walletLoading || state.status === "completed"}
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
