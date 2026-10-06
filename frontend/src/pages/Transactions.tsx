import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Send,
  ArrowUp,
  Check,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { AppTopbar } from "@/components/AppTopbar";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { PageTransition } from "@/components/PageTransition";
import { useSidebar } from "@/lib/sidebar";
import { getUser } from "@/lib/auth";
import { fetchTransactions, type BackendTransaction } from "@/lib/backend";
import { decodeTransaction } from "@/lib/notes";


const PAGE_SIZE = 20;

function TransactionsPage() {
  const navigate = useNavigate();
  const { collapsed, toggleCollapsed, mobileOpen, setMobileOpen } = useSidebar();
  const [page, setPage] = useState(1);
  const [exportOpen, setExportOpen] = useState(false);
  const [timeframe, setTimeframe] = useState<"last-month" | "last-3-months" | "custom">(
    "last-month",
  );
  const [fileType, setFileType] = useState<"xls" | "pdf">("xls");
  const [checking, setChecking] = useState(true);
  const [activities, setActivities] = useState<BackendTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [companyName] = useState("Starlit Pay");
  const totalPages = Math.max(1, Math.ceil(activities.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const pageItems = activities.slice(start, start + PAGE_SIZE);

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
      void fetchTransactions(user.id)
        .then((res) => {
          if (!cancelled) setActivities(res.transactions);
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

  useEffect(() => {
    if (!exportOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setExportOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [exportOpen]);

  function getLabelForTimeframe(tf: typeof timeframe) {
    if (tf === "last-month") return "Last month";
    if (tf === "last-3-months") return "Last 3 months";
    return "Custom";
  }

  function buildExportContent() {
    if (fileType === "xls") {
      const rows = activities
        .map((a) => {
          const dec = decodeTransaction(a);
          const amtStr =
            dec.amount > 0
              ? `${dec.type === "receive" || dec.type === "faucet" ? "+" : "-"}${dec.amount.toFixed(2)} ${dec.asset}`
              : "—";
          return `<tr><td>${dec.type.toUpperCase()}: ${dec.party}</td><td>${dec.createdAt ? new Date(dec.createdAt).toLocaleString() : ""}</td><td style="text-align:right">${amtStr}</td></tr>`;
        })
        .join("");
      return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><table border="1" cellpadding="4" cellspacing="0"><thead><tr><th>Transaction</th><th>Date</th><th style="text-align:right">Amount</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
    }

    const lines = [
      "Type,Party,Amount,Asset,Date",
      ...activities.map((a) => {
        const dec = decodeTransaction(a);
        return `"${dec.type}","${dec.party}","${dec.amount}","${dec.asset}","${dec.createdAt ? new Date(dec.createdAt).toLocaleString() : ""}"`;
      }),
    ];
    return lines.join("\n");
  }

  function getMimeType() {
    return fileType === "xls" ? "application/vnd.ms-excel" : "text/plain";
  }

  function getExtension() {
    return fileType === "xls" ? "xls" : "pdf";
  }

  function handleDownload() {
    const content = buildExportContent();
    const blob = new Blob([content], { type: getMimeType() });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `starlit-pay-transactions.${getExtension()}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setExportOpen(false);
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
            <section className="dash-card activity-card transactions-card">
              <div className="card-title-row transactions-title-row">
                <span>Transactions</span>
                <Button variant="ghost" className="export-btn" onClick={() => setExportOpen(true)}>
                  <Download />
                  Export
                </Button>
              </div>
              <table className="transactions-table">
                <thead>
                  <tr>
                    <th>Transaction</th>
                    <th>Date</th>
                    <th style={{ textAlign: "right" }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((tx, i) => {
                    const dec = decodeTransaction(tx);
                    const isPositive = dec.type === "receive" || dec.type === "faucet";
                    return (
                      <tr key={tx.id ?? i}>
                        <td>
                          <div className="tx-row">
                            <span className="activity-icon icon-blue">
                              {dec.type === "withdraw" ? <ArrowUp /> : <Send />}
                            </span>
                            <div className="activity-copy">
                              <b>{dec.type === "withdraw" ? "Withdrawal" : dec.type === "faucet" ? "Faucet claim" : "Shielded payment"}</b>
                              <small>{dec.party} {dec.id ? `· #${dec.id.slice(0, 8)}` : ""}</small>
                            </div>
                          </div>
                        </td>
                        <td className="transactions-date">
                          {dec.createdAt ? new Date(dec.createdAt).toLocaleString() : tx.created_at ? new Date(tx.created_at).toLocaleString() : "—"}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <strong className={isPositive ? "amount-positive" : "amount-negative"}>
                            {dec.amount > 0 ? `${isPositive ? "+" : "-"}${dec.amount.toFixed(2)} ${dec.asset}` : "—"}
                          </strong>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {loading && <p className="text-sm text-muted-foreground" style={{ padding: 12 }}>Loading transactions…</p>}
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

            {exportOpen && (
              <div
                className="send-modal"
                role="presentation"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) setExportOpen(false);
                }}
              >
                <div
                  className="send-modal-card"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="export-modal-title"
                >
                  <div className="modal-header">
                    <h3 className="modal-title" id="export-modal-title">
                      Export Transactions
                    </h3>
                    <button
                      type="button"
                      className="modal-close"
                      onClick={() => setExportOpen(false)}
                      aria-label="Close"
                    >
                      <X />
                    </button>
                  </div>
                  <div className="modal-body">
                    <div>
                      <p className="modal-label" style={{ marginBottom: 8 }}>
                        Timeframe
                      </p>
                      <div className="export-options-row">
                        {(["last-month", "last-3-months", "custom"] as const).map((tf) => (
                          <button
                            key={tf}
                            type="button"
                            className={`export-option-btn ${timeframe === tf ? "export-option-btn-active" : ""}`}
                            onClick={() => setTimeframe(tf)}
                          >
                            {timeframe === tf && <Check size={14} />}
                            {getLabelForTimeframe(tf)}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="modal-label" style={{ marginBottom: 8 }}>
                        File type
                      </p>
                      <div className="export-options-row">
                        {(["xls", "pdf"] as const).map((ft) => (
                          <button
                            key={ft}
                            type="button"
                            className={`export-option-btn ${fileType === ft ? "export-option-btn-active" : ""}`}
                            onClick={() => setFileType(ft)}
                          >
                            {fileType === ft && <Check size={14} />}
                            {ft.toUpperCase()} (.{ft})
                          </button>
                        ))}
                      </div>
                    </div>
                    <Button type="button" className="w-full mt-2" onClick={handleDownload}>
                      <Download />
                      Download
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </main>
        </PageTransition>
      </div>
    </div>
  );
}

export default TransactionsPage;
