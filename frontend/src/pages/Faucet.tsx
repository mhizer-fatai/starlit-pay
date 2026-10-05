import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { Check, ChevronDown, Droplets } from "lucide-react";

import { Button } from "@/components/ui/button";
import { AppTopbar } from "@/components/AppTopbar";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { PageTransition } from "@/components/PageTransition";
import { Input } from "@/components/ui/input";
import { getUser, type SessionUser } from "@/lib/auth";
import { faucetFund, faucetStatus } from "@/lib/backend";
import { loadPrivateBalances } from "@/lib/wallet";
import { useSidebar } from "@/lib/sidebar";

const COOLDOWN_SECONDS = 4 * 60 * 60;

function formatCooldown(totalSec: number): string {
  const s = Math.max(0, Math.ceil(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function FaucetPage() {
  const navigate = useNavigate();
  const { collapsed, toggleCollapsed, mobileOpen, setMobileOpen } = useSidebar();
  const [checking, setChecking] = useState(true);
  const [companyName, setCompanyName] = useState("Starlit Pay");
  const [me, setMe] = useState<SessionUser | null>(null);
  const [asset, setAsset] = useState("USDC");
  const [assetOpen, setAssetOpen] = useState(false);
  const [captchaSolved, setCaptchaSolved] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const turnstileRef = useRef<TurnstileInstance | undefined>(undefined);
  const [claiming, setClaiming] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
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
      // Seed the 4h cooldown from this browser (backup) then sync with backend.
      try {
        const lastClaim = parseInt(localStorage.getItem(`starlit_faucet_last_claim_${user.id}`) || "0", 10);
        const elapsed = Math.floor(Date.now() / 1000) - lastClaim;
        if (lastClaim && elapsed < COOLDOWN_SECONDS && !cancelled) {
          setCooldownSeconds(COOLDOWN_SECONDS - elapsed);
        }
      } catch {
        /* ignore */
      }
      if (user.public_encryption_key) {
        void faucetStatus(user.public_encryption_key)
          .then((s) => {
            if (cancelled || s.canClaim) return;
            setCooldownSeconds((prev) => Math.max(prev, Math.ceil(s.remainingMs / 1000)));
          })
          .catch(() => {});
      }
    });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  // Live 1-second cooldown countdown.
  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setCooldownSeconds((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownSeconds]);

  function startCooldown() {
    setCooldownSeconds(COOLDOWN_SECONDS);
    if (me?.id) {
      try {
        localStorage.setItem(`starlit_faucet_last_claim_${me.id}`, String(Math.floor(Date.now() / 1000)));
      } catch {
        /* ignore */
      }
    }
  }

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
    if (!captchaToken) {
      setError("Please complete the captcha challenge first.");
      return;
    }
    if (claiming || cooldownSeconds > 0) return;
    const claimLabel = asset === "XLM" ? "100 XLM" : "50 USDC";
    setClaiming(true);
    try {
      // Snapshot balances so we can detect the credit landing (old behavior).
      const snapshot = await loadPrivateBalances(me).catch(() => null);
      const initUsdc = snapshot?.usdc ?? 0;
      const initXlm = snapshot?.xlm ?? 0;

      setStatus(`Sending funds… Auto-shielding ${claimLabel} to your account.`);
      await faucetFund({
        viewingKey: me.public_encryption_key,
        depositMemo: me.deposit_memo || undefined,
        captchaToken,
        asset,
      });

      // Poll for the private-balance credit (gateway shields async, ~2s cadence).
      setStatus("Encrypting note and waiting for private balance credit…");
      let credited = false;
      for (let attempt = 0; attempt < 22 && !credited; attempt++) {
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
        try {
          const balances = await loadPrivateBalances(me);
          if (balances && (balances.usdc > initUsdc || balances.xlm > initXlm)) {
            credited = true;
          }
        } catch {
          /* keep polling */
        }
      }
      setStatus(
        credited
          ? `Funds received! +${claimLabel} credited to your private balance.`
          : `Funds processed! +${claimLabel} sent — balances update after sync.`,
      );
      startCooldown();
    } catch (e) {
      // Cooldown rejections (429): re-sync the countdown from the backend.
      if (me?.public_encryption_key) {
        void faucetStatus(me.public_encryption_key)
          .then((s) => {
            if (!s.canClaim) setCooldownSeconds(Math.ceil(s.remainingMs / 1000));
          })
          .catch(() => {});
      }
      setError(e instanceof Error ? e.message : "Claim failed — try again later.");
    } finally {
      // Turnstile tokens are single-use: always reset so the next claim solves fresh.
      turnstileRef.current?.reset();
      setCaptchaToken("");
      setCaptchaSolved(false);
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
                    <Turnstile
                      ref={turnstileRef}
                      siteKey={import.meta.env.VITE_TURNSTILE_SITE_KEY as string}
                      options={{ size: "flexible" }}
                      onSuccess={(token) => {
                        setCaptchaToken(token);
                        setCaptchaSolved(true);
                      }}
                      onExpire={() => {
                        setCaptchaToken("");
                        setCaptchaSolved(false);
                      }}
                      onError={() => {
                        setCaptchaToken("");
                        setCaptchaSolved(false);
                        setError("Captcha failed to load — please refresh and try again.");
                      }}
                    />
                  </div>
                </div>

                <Button
                  type="button"
                  className="faucet-claim-btn"
                  disabled={!captchaSolved || claiming || cooldownSeconds > 0}
                  onClick={handleClaim}
                >
                  {claiming
                    ? "Processing..."
                    : cooldownSeconds > 0
                      ? `Claim (${formatCooldown(cooldownSeconds)})`
                      : "Claim"}
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
