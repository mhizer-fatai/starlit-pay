import { useEffect, useMemo, useRef, useState } from "react";
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
  RefreshCw,
  Send,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { AppTopbar } from "@/components/AppTopbar";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { getUser, signOut } from "@/lib/auth";
import { fetchStats, type BackendTransaction } from "@/lib/backend";
import { ReceiptModal } from "@/components/ReceiptModal";
import { ActivitySkeletonRow, Skeleton } from "@/components/Skeleton";
import { StatementModal } from "@/components/StatementModal";
import { usePrices } from "@/lib/prices";
import { useSidebar } from "@/lib/sidebar";
import {
  activityTitle,
  assetToUsd,
  buildActivityFeed,
  decodeTransactionPayload,
  formatGrouped,
  loadPrivateBalances,
  loadUserTransactions,
  splitDollarsCents,
  type ActivityItem,
  type BalanceNote,
} from "@/lib/wallet";

const actionButtonClass = "hover:bg-dashboard-blue hover:text-primary-foreground";

interface ChartPoint {
  x: number;
  y: number;
  balance: string;
}

function DashboardPage() {
  const navigate = useNavigate();
  const [balanceHidden, setBalanceHidden] = useState(false);
  const [checking, setChecking] = useState(true);
  const { collapsed, toggleCollapsed, mobileOpen, setMobileOpen } = useSidebar();
  const [displayName, setDisplayName] = useState("Jane");
  const [allTxs, setAllTxs] = useState<BackendTransaction[]>([]);
  const [balanceNotes, setBalanceNotes] = useState<BalanceNote[]>([]);
  const [selected, setSelected] = useState<ActivityItem | null>(null);
  const [statementOpen, setStatementOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [usdcBalance, setUsdcBalance] = useState(0);
  const [xlmBalance, setXlmBalance] = useState(0);
  const [tvl, setTvl] = useState<string | null>(null);
  const [balancesLoading, setBalancesLoading] = useState(true);
  const [activityLoading, setActivityLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  // Live prices via the backend CoinGecko proxy (static fallback until loaded).
  const prices = usePrices();
  const totalUsd = usdcBalance * prices.USDC + xlmBalance * prices.XLM;

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
      setEmail(user.email);
      setViewerUsername(user.username);
      setChecking(false);
      // Real transaction history (read).
      void loadUserTransactions(user.id)
        .then((txs) => {
          if (cancelled) return;
          setAllTxs(txs);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setActivityLoading(false);
        });
      // Real private balance from decrypted unspent shielded notes (read).
      void loadPrivateBalances(user)
        .then((balances) => {
          if (cancelled || !balances) return;
          setUsdcBalance(balances.usdc);
          setXlmBalance(balances.xlm);
          setBalanceNotes(balances.notes);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setBalancesLoading(false);
        });
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

  // Refreshes balances + activity without reloading the page. Stale values
  // stay visible behind skeletons-free UI while the sync icon spins.
  async function handleSync() {
    if (syncing) return;
    setSyncing(true);
    try {
      const user = await getUser();
      if (!user) {
        navigate("/auth", { replace: true });
        return;
      }
      const [txs, balances] = await Promise.all([
        loadUserTransactions(user.id).catch(() => []),
        loadPrivateBalances(user).catch(() => null),
      ]);
      setAllTxs(txs);
      if (balances) {
        setUsdcBalance(balances.usdc);
        setXlmBalance(balances.xlm);
        setBalanceNotes(balances.notes);
      }
    } finally {
      setSyncing(false);
    }
  }

  const chartRef = useRef<HTMLDivElement>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [hoverY, setHoverY] = useState<number | null>(null);
  const [hoverBalance, setHoverBalance] = useState<string | null>(null);

  // Balance trend derived from real on-database events: shielded-note receipts
  // (+) and recorded sends (−), ordered by time as a cumulative USD series
  // converted at live prices. Anchored so the line ends at today's balance —
  // spent input notes are invisible to history, so raw accumulation undershoots.
  const chartPoints: ChartPoint[] = useMemo(() => {
    const events: { t: number; usd: number }[] = [];
    for (const note of balanceNotes) {
      events.push({ t: note.createdAt, usd: assetToUsd(note.asset, note.amount, prices) });
    }
    for (const tx of allTxs) {
      const decoded = tx.encrypted_payload ? decodeTransactionPayload(tx.encrypted_payload) : null;
      if (decoded?.amount) {
        events.push({
          t: tx.created_at ? new Date(tx.created_at).getTime() : Date.now(),
          usd: -assetToUsd(decoded.asset ?? "USDC", decoded.amount, prices),
        });
      }
    }
    events.sort((a, b) => a.t - b.t);
    let running = 0;
    const cumulative = [0];
    for (const event of events) {
      running += event.usd;
      cumulative.push(running);
    }
    // Downsample long histories so the path stays light.
    let values = cumulative;
    if (values.length > 40) {
      const sampled: number[] = [];
      for (let i = 0; i < 40; i++) {
        sampled.push(values[Math.round((i * (values.length - 1)) / 39)]!);
      }
      values = sampled;
    }
    if (values.length < 2) values = [0, 0];
    const shift = totalUsd - values[values.length - 1]!;
    values = values.map((value) => value + shift);
    const lo = Math.min(0, ...values);
    const hi = Math.max(0.01, ...values);
    return values.map((value, i) => ({
      x: values.length === 1 ? 620 : (i / (values.length - 1)) * 620,
      y: 200 - ((value - lo) / (hi - lo)) * 190,
      balance: `$${formatGrouped(value)}`,
    }));
  }, [balanceNotes, allTxs, prices, totalUsd]);

  const chartLinePath = useMemo(
    () => chartPoints.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" "),
    [chartPoints],
  );
  const chartAreaPath = useMemo(
    () => `${chartLinePath} L620 210 L0 210 Z`,
    [chartLinePath],
  );

  // Unified date-ordered feed: incoming shielded notes + outgoing records.
  // Viewer identity filters out own change notes (see buildActivityFeed).
  const [viewerUsername, setViewerUsername] = useState("");
  const activityFeed = useMemo(
    () => buildActivityFeed(balanceNotes, allTxs, viewerUsername),
    [balanceNotes, allTxs, viewerUsername],
  );
  const recentActivity = activityFeed.slice(0, 4);

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

  const { dollars, cents } = splitDollarsCents(totalUsd);
  const chartLoading = balancesLoading || activityLoading;

  return (
    <div className="dashboard-frame">
      <DashboardSidebar
        open={mobileOpen}
        collapsed={collapsed}
        onToggle={toggleCollapsed}
        onClose={() => setMobileOpen(false)}
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
            <h1>
              {checking ? (
                <Skeleton className="inline-block h-8 w-56 align-middle" label="Loading greeting" />
              ) : (
                <>Welcome, {displayName}</>
              )}
            </h1>

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
            <Button
              variant="secondary"
              className={actionButtonClass}
              disabled
              aria-label="Download Statement — coming soon"
            >
              <Download />
              Download Statement
              <span className="soon-pill">Soon</span>
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
                ) : balancesLoading ? (
                  <Skeleton className="h-9 w-52" label="Loading balance" />
                ) : (
                  <span>
                    ${dollars}<sup>{cents}</sup>
                  </span>
                )}
                {!balancesLoading && (
                  <button
                    type="button"
                    className="balance-sync"
                    onClick={handleSync}
                    disabled={syncing}
                    aria-label={syncing ? "Refreshing balance" : "Refresh balance"}
                    title="Refresh balance"
                  >
                    <RefreshCw className={syncing ? "animate-spin" : ""} />
                  </button>
                )}
              </div>
              {chartLoading ? (
                <Skeleton
                  className="h-[210px] w-full"
                  label="Loading chart"
                  style={{ marginTop: 8 }}
                />
              ) : (
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
                    d={chartAreaPath}
                  />
                  <path
                    className="chart-line"
                    d={chartLinePath}
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
              )}
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
                ].map((range, i) => (
                  <button key={`${range}-${i}`} type="button" className="range-btn">
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
                  {balancesLoading ? (
                    <Skeleton className="h-5 w-24" label="Loading USDC balance" />
                  ) : (
                    <strong className={balanceHidden ? "holding-masked" : ""}>
                      {balanceHidden ? "••••••" : formatGrouped(usdcBalance)}
                    </strong>
                  )}
                </div>
                <div className="holding-divider" />
                <div className="holding-row">
                  <span className="holding-label">XLM</span>
                  {balancesLoading ? (
                    <Skeleton className="h-5 w-24" label="Loading XLM balance" />
                  ) : (
                    <strong className={balanceHidden ? "holding-masked" : ""}>
                      {balanceHidden ? "••••••" : formatGrouped(xlmBalance)}
                    </strong>
                  )}
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
              {activityLoading ? (
                <>
                  <ActivitySkeletonRow />
                  <ActivitySkeletonRow />
                  <ActivitySkeletonRow />
                  <ActivitySkeletonRow />
                </>
              ) : (
                <>
                  {recentActivity.map((item) => {
                    const incoming = item.direction === "in";
                    return (
                      <li
                        key={item.key}
                        role="button"
                        tabIndex={0}
                        style={{ cursor: "pointer" }}
                        onClick={() => setSelected(item)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelected(item);
                          }
                        }}
                        aria-label={`View ${activityTitle(item)} receipt`}
                      >
                        <span className={`activity-icon ${incoming ? "icon-green" : "icon-blue"}`}>
                          {incoming ? <ArrowDownLeft /> : <Send />}
                        </span>
                        <div className="activity-copy">
                          <b>{activityTitle(item)}</b>
                          <small>
                            {item.date ? new Date(item.date).toLocaleString() : "Recorded"}
                          </small>
                        </div>
                        <strong className={incoming ? "amount-positive" : "amount-negative"}>
                          {incoming ? `+${item.amount} ${item.asset}` : `−${item.amount} ${item.asset}`}
                        </strong>
                      </li>
                    );
                  })}
              {recentActivity.length === 0 && (
                <li>
                  <span className="activity-icon icon-blue">
                    <Receipt />
                  </span>
                  <div className="activity-copy">
                    <b>Nothing to see here yet</b>
                    <small>{tvl ? `Network TVL: ${tvl}` : "Your transactions will appear here"}</small>
                  </div>
                  <strong className="amount-negative">—</strong>
                </li>
              )}
                </>
              )}
            </ul>
          </section>
        </motion.main>
        {selected && (
          <ReceiptModal item={selected} userName={displayName} onClose={() => setSelected(null)} />
        )}
        {statementOpen && (
          <StatementModal
            feed={activityFeed}
            email={email}
            userName={displayName}
            onClose={() => setStatementOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

export default DashboardPage;
