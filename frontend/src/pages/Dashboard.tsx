import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUp,
  Droplets,
  Eye,
  EyeOff,
  Receipt,
  RefreshCw,
  Send,
  ShieldCheck,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { AppTopbar } from "@/components/AppTopbar";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { getUser, signOut } from "@/lib/auth";
import { fetchStats, type BackendTransaction } from "@/lib/backend";
import { ReceiptModal } from "@/components/ReceiptModal";
import { ActivitySkeletonRow, Skeleton } from "@/components/Skeleton";
import { StatementModal } from "@/components/StatementModal";
import { SmartWalletCard } from "@/components/SmartWalletCard";
import { TransferModal, type TransferDirection } from "@/components/TransferModal";
import { AssetRow, WalletCardHeader, WalletTotal } from "@/components/WalletCard";
import { usePrices } from "@/lib/prices";
import { useSidebar } from "@/lib/sidebar";
import {
  activityTitle,
  buildActivityFeed,
  loadPrivateBalances,
  loadUserTransactions,
  type ActivityItem,
  type BalanceNote,
} from "@/lib/wallet";

const actionButtonClass = "hover:bg-dashboard-blue hover:text-primary-foreground";

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
  const [transferDirection, setTransferDirection] = useState<TransferDirection | null>(null);
  const [publicBalances, setPublicBalances] = useState<Record<"XLM" | "USDC", number> | null>(null);
  const [walletRefreshKey, setWalletRefreshKey] = useState(0);
  const openTransfer = (direction: TransferDirection) => setTransferDirection(direction);
  // Live prices via the backend (Stellar DEX first). XLM is null when no real
  // price is available; the total is then unknown rather than guessed.
  const prices = usePrices();
  const usdcUsd = usdcBalance * prices.USDC;
  const xlmUsd = prices.XLM === null ? null : xlmBalance * prices.XLM;
  const totalUsd = xlmUsd === null && xlmBalance > 0 ? null : usdcUsd + (xlmUsd ?? 0);

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
    navigate("/", { replace: true });
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

  // Unified date-ordered feed: incoming shielded notes + outgoing records.
  // Viewer identity filters out own change notes (see buildActivityFeed).
  const [viewerUsername, setViewerUsername] = useState("");
  const activityFeed = useMemo(
    () => buildActivityFeed(balanceNotes, allTxs, viewerUsername),
    [balanceNotes, allTxs, viewerUsername],
  );
  const recentActivity = activityFeed.slice(0, 4);

  const pricesLoading = prices.status === "loading";

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
            <Button
              variant="secondary"
              className={actionButtonClass}
              onClick={() => navigate("/send?mode=external")}
            >
              <ArrowUp />
              Withdraw
            </Button>
            <Button
              variant="secondary"
              className={actionButtonClass}
              onClick={() => navigate("/faucet")}
            >
              <Droplets />
              Faucet
            </Button>
          </div>
          </motion.div>

          <div className="wallet-grid">
            <section className="dash-card wallet-card" aria-label="Private balance">
              <WalletCardHeader
                icon={<ShieldCheck />}
                tone="private"
                title="Private balance"
                badge="Shielded"
                actions={
                  <>
                    <button
                      type="button"
                      className="balance-eye"
                      onClick={handleSync}
                      disabled={syncing || balancesLoading}
                      aria-label={syncing ? "Refreshing balance" : "Refresh balance"}
                    >
                      <RefreshCw className={syncing ? "animate-spin" : ""} />
                    </button>
                    <button
                      type="button"
                      className="balance-eye"
                      onClick={() => setBalanceHidden((value) => !value)}
                      aria-label={balanceHidden ? "Show balances" : "Hide balances"}
                    >
                      {balanceHidden ? <EyeOff /> : <Eye />}
                    </button>
                  </>
                }
              />
              <WalletTotal usd={totalUsd} hidden={balanceHidden} loading={balancesLoading || pricesLoading} />
              <div className="wallet-assets">
                <AssetRow asset="USDC" amount={usdcBalance} price={prices.USDC} hidden={balanceHidden} loading={balancesLoading} />
                <AssetRow asset="XLM" amount={xlmBalance} price={prices.XLM} hidden={balanceHidden} loading={balancesLoading} />
              </div>
              <p className="wallet-caption">Only you can see this balance. Payments from it stay private.</p>
              <div className="wallet-actions">
                <Button type="button" onClick={() => openTransfer("to-public")} disabled={!publicBalances}>
                  <ArrowLeftRight /> Transfer
                </Button>
              </div>
              {!publicBalances && !balancesLoading && (
                <small className="wallet-caption">Create your public wallet to transfer between balances.</small>
              )}
            </section>

            <SmartWalletCard
              hidden={balanceHidden}
              prices={prices}
              refreshKey={walletRefreshKey}
              onTransfer={() => openTransfer("to-private")}
              onBalances={setPublicBalances}
            />
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
        {transferDirection && publicBalances && (
          <TransferModal
            initialDirection={transferDirection}
            privateBalances={{ XLM: xlmBalance, USDC: usdcBalance }}
            publicBalances={publicBalances}
            onClose={() => setTransferDirection(null)}
            onDone={() => {
              void handleSync();
              setWalletRefreshKey((k) => k + 1);
            }}
          />
        )}
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
