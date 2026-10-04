import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Copy } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

import { AppTopbar } from "@/components/AppTopbar";
import { Button } from "@/components/ui/button";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { PageTransition } from "@/components/PageTransition";
import { getUser, type SessionUser } from "@/lib/auth";
import { useSidebar } from "@/lib/sidebar";

// Gateway address funds land at; the memo routes to the user (see backend gateway.js).
const GATEWAY_ADDRESS = "GCDQQE7CPLIGMAH4QEB2SSIEAS5MZMFSQAYSEJYSF7P5ZLA6HOU4BWWY";

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
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (checking) return null;

  const username = user?.username ?? "";
  const memo = user?.deposit_memo ?? "—";
  const companyName = username ? `@${username}` : "Starlit Pay";

  return (
    <div className="dashboard-frame">
      <DashboardSidebar
        companyName={companyName}
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

              <p className="receive-label">Starlit Deposit Address (gateway)</p>
              <div className="receive-row">
                <code>{GATEWAY_ADDRESS}</code>
                <CopyButton value={GATEWAY_ADDRESS} label="Copy Address" />
              </div>

              <p className="receive-label">Your Deposit Memo (MEMO ID)</p>
              <div className="receive-row">
                <code>{memo}</code>
                {user?.deposit_memo && <CopyButton value={user.deposit_memo} label="Copy Memo" />}
              </div>

              <p className="receive-disclaimer">
                <b>IMPORTANT:</b> You must include this 6-digit Memo ID when sending deposits.
                Deposits sent without a Memo are lost and cannot be retrieved.
              </p>
            </section>
            <section className="dash-card qr-card">
              <div className="qr-wrap">
                <QRCodeSVG value={`starlit:${GATEWAY_ADDRESS}?memo=${memo}`} size={150} />
              </div>
            </section>
          </div>
        </main>
        </PageTransition>
      </div>
    </div>
  );
}

export default ReceivePage;
