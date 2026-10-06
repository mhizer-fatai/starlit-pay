import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronDown, Droplets } from "lucide-react";

import { Button } from "@/components/ui/button";
import { AppTopbar } from "@/components/AppTopbar";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { PageTransition } from "@/components/PageTransition";
import { Input } from "@/components/ui/input";
import { getUser, type SessionUser } from "@/lib/auth";
import { faucetFund, faucetStatus, postTransaction } from "@/lib/backend";
import { useSidebar } from "@/lib/sidebar";

function FaucetPage() {
  const navigate = useNavigate();
  const { collapsed, toggleCollapsed, mobileOpen, setMobileOpen } = useSidebar();
  const [checking, setChecking] = useState(true);
  const [companyName, setCompanyName] = useState("Starlit Pay");
  const [me, setMe] = useState<SessionUser | null>(null);
  const [asset, setAsset] = useState("USDC");
  const [assetOpen, setAssetOpen] = useState(false);
  const [captchaSolved, setCaptchaSolved] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState("");
  const assetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = "Faucet — Starlit Pay";
    let cancelled = false;
    void getUser().then((user) => {
      if (cancelled) return;
      if (!user) {
        navigate("/auth", { replace: true });
        return;
      }
      setMe(user);
      setCompanyName(user.username ? `@${user.username}` : "Starlit Pay");
      setChecking(false);
      if (user.public_encryption_key) {
        void faucetStatus(user.public_encryption_key)
          .then((s) => {
            if (!cancelled && !s.canClaim)
              setStatus(`Next claim available in ${Math.ceil(s.remainingMs / 60000)} min.`);
          })
          .catch(() => {});
      }
    });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  useEffect(() => {
    function onDocClick(event: MouseEvent) {
      if (assetRef.current && !assetRef.current.contains(event.target as Node)) {
        setAssetOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  async function handleClaim() {
    setError("");
    setStatus("");
    if (!me?.public_encryption_key) {
      setError("No viewing key on your account — sign up again.");
      return;
    }
    setClaiming(true);
    try {
      const res = await faucetFund({
        viewingKey: me.public_encryption_key,
        depositMemo: me.deposit_memo || undefined,
      });

      // Record transaction log for dashboard feed
      try {
        const payload = JSON.stringify({
          to: me.username || "me",
          amount: 50,
          asset: "USDC",
          type: "faucet",
          at: new Date().toISOString(),
        });
        await postTransaction({ user_id: me.id, encrypted_payload: btoa(payload) });
      } catch {}

      setStatus(res.hash ? `Funded! Tx ${res.hash}` : "Faucet claim submitted! 100 XLM & 50 USDC will arrive shortly.");
      setCaptchaSolved(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Claim failed — try again later.");
    } finally {
      setClaiming(false);
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
        <PageTransition>
          <main className="dashboard-content">
          <div className="faucet-stage">
            <section className="dash-card faucet-card">
              <div className="faucet-icon">
                <Droplets />
              </div>
              <h2 className="faucet-title">Testnet Faucet</h2>
              <p className="faucet-desc">
                Request test tokens to try out Starlit Pay on the testnet.
              </p>

              <div className="faucet-form">
                <label className="send-label">
                  Select Asset
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

                <div className="captcha-wrap">
                  <label className="send-label">Captcha Challenge</label>
                  <div className="captcha-box">
                    <div className="captcha-placeholder">
                      {captchaSolved ? (
                        <span className="captcha-success">
                          <Check /> Verified
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="captcha-fake"
                          onClick={() => setCaptchaSolved(true)}
                        >
                          Click to verify you are human
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <Button
                  type="button"
                  className="faucet-claim-btn"
                  disabled={!captchaSolved || claiming}
                  onClick={handleClaim}
                >
                  {claiming ? "Processing..." : "Claim"}
                </Button>
                {status && (
                  <p className="text-center text-xs text-muted-foreground" role="status">
                    {status}
                  </p>
                )}
                {error && (
                  <p className="text-center text-xs text-red-500" role="alert">
                    {error}
                  </p>
                )}
              </div>
            </section>
          </div>
        </main>
        </PageTransition>
      </div>
    </div>
  );
}

export default FaucetPage;
