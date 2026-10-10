import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowDownLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  Send,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { AppTopbar } from "@/components/AppTopbar";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { PageTransition } from "@/components/PageTransition";
import { ReceiptModal } from "@/components/ReceiptModal";
import { Skeleton } from "@/components/Skeleton";
import { StatementModal } from "@/components/StatementModal";
import { useSidebar } from "@/lib/sidebar";
import { getUser } from "@/lib/auth";
import {
  activityTitle,
  buildActivityFeed,
  loadPrivateBalances,
  loadUserTransactions,
  type ActivityItem,
} from "@/lib/wallet";

const PAGE_SIZE = 20;

function TransactionsPage() {
  const navigate = useNavigate();
  const { collapsed, toggleCollapsed, mobileOpen, setMobileOpen } = useSidebar();
  const [page, setPage] = useState(1);
  const [statementOpen, setStatementOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [checking, setChecking] = useState(true);
  const [feed, setFeed] = useState<ActivityItem[]>([]);
  const [selected, setSelected] = useState<ActivityItem | null>(null);
  const [userName, setUserName] = useState("");
  const [loading, setLoading] = useState(false);
  const totalPages = Math.max(1, Math.ceil(feed.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const pageItems = feed.slice(start, start + PAGE_SIZE);

  useEffect(() => {
    document.title = "Transactions — Starlit Pay";
    let cancelled = false;
    void getUser().then((user) => {
      if (cancelled) return;
      if (!user) {
        navigate("/auth", { replace: true });
        return;
      }
      setChecking(false);
      setLoading(true);
      setEmail(user.email);
      const name = user.display_name || user.username || user.email.split("@")[0] || user.email;
      setUserName(name);
      // Merge outgoing records with incoming shielded notes (same feed as
      // the dashboard's Recent Activity).
      void Promise.all([loadUserTransactions(user.id), loadPrivateBalances(user)])
        .then(([txs, balances]) => {
          if (cancelled) return;
          setFeed(buildActivityFeed(balances?.notes ?? [], txs, user.username));
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (checking) return null;

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
        <PageTransition>
          <main className="dashboard-content">
            <section className="dash-card activity-card transactions-card">
              <div className="card-title-row transactions-title-row">
                <span>Transactions</span>
                <Button variant="ghost" className="export-btn" disabled aria-label="Export — coming soon">
                  <Download />
                  Export
                  <span className="soon-pill">Soon</span>
                </Button>
              </div>
              <div className="table-scroll">
              <table className="transactions-table">
                <thead>
                  <tr>
                    <th>Transaction</th>
                    <th>Date</th>
                    <th style={{ textAlign: "right" }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <>
                      {[0, 1, 2, 3, 4].map((i) => (
                        <tr key={i} aria-hidden="true">
                          <td>
                            <div className="tx-row">
                              <Skeleton className="size-[38px] shrink-0 rounded-full" />
                              <div style={{ display: "grid", gap: 6, flex: 1 }}>
                                <Skeleton className="h-3.5 w-2/5" />
                                <Skeleton className="h-3 w-1/4" />
                              </div>
                            </div>
                          </td>
                          <td>
                            <Skeleton className="h-3 w-28" />
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <Skeleton className="ml-auto h-4 w-20" />
                          </td>
                        </tr>
                      ))}
                    </>
                  ) : (
                    pageItems.map((tx, i) => {
                      const incoming = tx.direction === "in";
                      return (
                        <tr
                          key={tx.key}
                          role="button"
                          tabIndex={0}
                          style={{ cursor: "pointer" }}
                          onClick={() => setSelected(tx)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setSelected(tx);
                            }
                          }}
                          aria-label={`View ${activityTitle(tx)} receipt`}
                        >
                          <td>
                            <div className="tx-row">
                              <span
                                className={`activity-icon ${incoming ? "icon-green" : "icon-blue"}`}
                              >
                                {incoming ? <ArrowDownLeft /> : <Send />}
                              </span>
                              <div className="activity-copy">
                                <b>{activityTitle(tx)}</b>
                                <small>#{i + 1 + start}</small>
                              </div>
                            </div>
                          </td>
                          <td className="transactions-date">
                            {tx.date ? new Date(tx.date).toLocaleString() : "—"}
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <strong className={incoming ? "amount-positive" : "amount-negative"}>
                              {incoming ? `+${tx.amount} ${tx.asset}` : `−${tx.amount} ${tx.asset}`}
                            </strong>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
              </div>
              {!loading && pageItems.length === 0 && (
                <p className="text-sm text-muted-foreground" style={{ padding: 12 }}>No transactions yet.</p>
              )}
              <div className="transactions-footer">
                <Button
                  variant="ghost"
                  size="icon"
                  className="page-nav-btn"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p: number) => Math.max(1, p - 1))}
                  aria-label="Previous page"
                >
                  <ChevronLeft />
                </Button>
                <span className="page-indicator">
                  Page {safePage}/{totalPages}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="page-nav-btn"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p: number) => Math.min(totalPages, p + 1))}
                  aria-label="Next page"
                >
                  <ChevronRight />
                </Button>
              </div>
            </section>

          </main>
        </PageTransition>
        {selected && (
          <ReceiptModal item={selected} userName={userName} onClose={() => setSelected(null)} />
        )}
        {statementOpen && (
          <StatementModal
            feed={feed}
            email={email}
            userName={userName}
            onClose={() => setStatementOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

export default TransactionsPage;
