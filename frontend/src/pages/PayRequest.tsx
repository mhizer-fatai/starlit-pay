import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { fetchPaymentLink } from "@/lib/backend";

function PayRequestPage() {
  const { commitment } = useParams();
  const [state, setState] = useState<{ loading: boolean; error?: string; amount?: string; asset?: string; creator?: string; status?: string }>({
    loading: true,
  });

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
          status: res.link.status,
        }),
      )
      .catch(() => setState({ loading: false, error: "This payment link does not exist or expired." }));
  }, [commitment]);

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
                <Button className="mt-5 w-full" onClick={() => (window.location.href = "/auth")}>
                  Log in to pay
                </Button>
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

export default PayRequestPage;
