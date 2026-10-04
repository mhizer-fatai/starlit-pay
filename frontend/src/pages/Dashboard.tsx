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
import { getUser, signOut } from "@/lib/auth";
import { fetchStats, fetchTransactions, type BackendTransaction } from "@/lib/backend";
import { useSidebar } from "@/lib/sidebar";

const actionButtonClass = "hover:bg-dashboard-blue hover:text-primary-foreground";

function DashboardPage() {
  const navigate = useNavigate();
  const [balanceHidden, setBalanceHidden] = useState(false);
  const [checking, setChecking] = useState(true);
  const { collapsed, toggleCollapsed, mobileOpen, setMobileOpen } = useSidebar();
  const [displayName, setDisplayName] = useState("Jane");
  const [companyName, setCompanyName] = useState("Starlit Pay");
  const [recentTxs, setRecentTxs] = useState<BackendTransaction[]>([]);
  const [tvl, setTvl] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Dashboard — Starlit Pay";
    let cancelled = false;
    void getUser().then((user) => {
      if (cancelled) return;
      if (!user) {
        navigate("/auth", { replace: true });
        return;
      }
      const name = user.display_name || user.username || user.email.split("@")[0] || user.email;
      setDisplayName(name.charAt(0).toUpperCase() + name.slice(1));
      setCompanyName(user.username ? `@${user.username}` : "Starlit Pay");
      setChecking(false);
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

  async function handleSignOut() {
    await signOut();
    navigate("/auth", { replace: true });
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
            <Button variant="secondary" className={actionButtonClass}>
              <ArrowUp />
              Withdraw
            </Button>
            <Button variant="secondary" className={actionButtonClass}>
              <Droplets />
              Faucet
            </Button>
            <Button variant="secondary" className={actionButtonClass}>
              <Download />
              Download Statement
            </Button>
          </div>
          </motion.div>

          <div className="balance-grid">
            <section className="dash-card balance-card">
              <div className="card-title-row">
                <span>Private balance</span>
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
                    $1,156,908<sup>27</sup>
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
                  "1M",
                  "5M",
                  "10M",
                  "30M",
                  "1H",
                  "2H",
                  "4H",
                  "1D",
                  "7D",
                  "30D",
                  "1M",
                  "3M",
                  "1Y",
                ].map((range) => (
                  <button key={range} type="button" className="range-btn">
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
                    {balanceHidden ? "••••••" : "842,500.00"}
                  </strong>
                </div>
                <div className="holding-divider" />
                <div className="holding-row">
                  <span className="holding-label">XLM</span>
                  <strong className={balanceHidden ? "holding-masked" : ""}>
                    {balanceHidden ? "••••••" : "314,408.27"}
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
              {recentTxs.map((tx, i) => (
                <li key={tx.id ?? i}>
                  <span className="activity-icon icon-blue">
                    <Send />
                  </span>
                  <div className="activity-copy">
                    <b>Shielded transaction</b>
                    <small>{tx.created_at ? new Date(tx.created_at).toLocaleString() : "Recorded"}</small>
                  </div>
                  <strong className="amount-negative">—</strong>
                </li>
              ))}
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
    </div>
  );
}

export default DashboardPage;
