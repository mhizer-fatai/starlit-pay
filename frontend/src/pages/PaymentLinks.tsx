import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Plus,
  QrCode,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { AppTopbar } from "@/components/AppTopbar";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { PageTransition } from "@/components/PageTransition";
import { Input } from "@/components/ui/input";
import { QRCodeSVG } from "qrcode.react";
import { getUser, type SessionUser } from "@/lib/auth";
import { createPaymentLink, fetchPaymentLink } from "@/lib/backend";
import { useSidebar } from "@/lib/sidebar";

const PAGE_SIZE = 20;

interface LinkRow {
  id: string;
  commitment: string;
  amount: string;
  asset: string;
  title: string;
  status: string;
  createdAt: string;
  url: string;
}

function cacheKey(userId: string) {
  return `starlit_links:${userId}`;
}
function readCache(userId: string): LinkRow[] {
  try {
    return JSON.parse(localStorage.getItem(cacheKey(userId)) ?? "[]") as LinkRow[];
  } catch {
    return [];
  }
}
function writeCache(userId: string, rows: LinkRow[]) {
  try {
    localStorage.setItem(cacheKey(userId), JSON.stringify(rows));
  } catch {
    /* ignore */
  }
}

function PaymentLinksPage() {
  const navigate = useNavigate();
  const { collapsed, toggleCollapsed, mobileOpen, setMobileOpen } = useSidebar();
  const [checking, setChecking] = useState(true);
  const [companyName, setCompanyName] = useState("Starlit Pay");
  const [me, setMe] = useState<SessionUser | null>(null);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [modalLink, setModalLink] = useState<LinkRow | null>(null);
  const [copied, setCopied] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [formAmount, setFormAmount] = useState("");
  const [formAsset, setFormAsset] = useState<"USDC" | "XLM">("USDC");
  const [formDesc, setFormDesc] = useState("");
  const [busy, setBusy] = useState(false);


  useEffect(() => {
    document.title = "Payment Links — Starlit Pay";
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
      const cached = readCache(user.id);
      setLinks(cached);
      if (cached.length > 0) {
        setLoading(true);
        void Promise.all(
          cached.map((row) =>
            fetchPaymentLink(row.commitment)
              .then((res) => ({ ...row, status: res.link.status ?? row.status }))
              .catch(() => row),
          ),
        )
          .then((rows) => {
            if (!cancelled) {
              setLinks(rows);
              writeCache(user.id, rows);
            }
          })
          .finally(() => {
            if (!cancelled) setLoading(false);
          });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!me) return setError("Sign in first.");
    const amt = Number(formAmount);
    if (!Number.isFinite(amt) || amt <= 0) return setError("Enter a valid amount.");
    setBusy(true);
    try {
      const commitment = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
      await createPaymentLink({
        creator_id: me.id,
        amount: formAmount,
        commitment,
        asset: formAsset,
        description: formDesc || undefined,
      });
      const row: LinkRow = {
        id: commitment,
        commitment,
        amount: formAmount,
        asset: formAsset,
        title: formDesc || `Payment request ${commitment.slice(0, 6)}`,
        status: "pending",
        createdAt: new Date().toLocaleDateString(),
        url: `${window.location.origin}/pay/${commitment}`,
      };

      const rows = [row, ...links];
      setLinks(rows);
      writeCache(me.id, rows);
      setFormAmount("");
      setFormDesc("");
      setCreateOpen(false);
      setModalLink(row);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create link.");
    } finally {
      setBusy(false);
    }
  }

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(links.length / PAGE_SIZE)),
    [links.length],
  );
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const pageItems = links.slice(start, start + PAGE_SIZE);

  const allSelected =
    pageItems.length > 0 && pageItems.every((item) => selectedIds.has(item.id));
  const someSelected = pageItems.some((item) => selectedIds.has(item.id));

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        pageItems.forEach((item) => next.delete(item.id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        pageItems.forEach((item) => next.add(item.id));
        return next;
      });
    }
  }

  function bulkDelete() {
    if (!me) return;
    setLinks((prev) => {
      const rows = prev.filter((link) => !selectedIds.has(link.id));
      writeCache(me.id, rows);
      return rows;
    });
    setSelectedIds(new Set());
  }

  function deleteLink(id: string) {
    if (!me) return;
    setLinks((prev) => {
      const rows = prev.filter((link) => link.id !== id);
      writeCache(me.id, rows);
      return rows;
    });
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore copy errors
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
          <section className="dash-card payment-links-card">
            <div className="card-title-row payment-links-title-row">
              <span>Payment Links</span>
              <Button variant="ghost" className="export-btn" onClick={() => setCreateOpen(true)}>
                <Plus />
                Create Link
              </Button>
            </div>

            {error && (
              <p className="text-sm text-red-500" role="alert">
                {error}
              </p>
            )}
            {loading && <p className="text-sm text-muted-foreground">Refreshing link status…</p>}

            {someSelected && (
              <div className="bulk-actions-bar">
                <span>{selectedIds.size} selected</span>
                <div className="bulk-actions">
                  <Button variant="ghost" size="sm" onClick={bulkDelete}>
                    <Trash2 />
                    Delete
                  </Button>
                </div>
              </div>
            )}

            <table className="payment-links-table">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>
                    <input
                      type="checkbox"
                      className="link-checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label="Select all"
                    />
                  </th>
                  <th>Link</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th style={{ width: 110, textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((link) => (
                  <tr key={link.id}>
                    <td>
                      <input
                        type="checkbox"
                        className="link-checkbox"
                        checked={selectedIds.has(link.id)}
                        onChange={() => toggleSelect(link.id)}
                        aria-label={`Select ${link.title}`}
                      />
                    </td>
                    <td>
                      <div className="link-info">
                        <b>{link.title}</b>
                        <small>
                          {link.asset} · ${link.amount}
                        </small>
                      </div>
                    </td>
                    <td>
                      <span className={`link-status ${link.status === "pending" ? "active" : "disabled"}`}>
                        {link.status === "pending" ? "Active" : link.status}
                      </span>
                    </td>
                    <td className="link-date">{link.createdAt}</td>
                    <td>
                      <div className="link-actions">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="link-action-btn"
                          aria-label="QR"
                          onClick={(event) => {
                            event.stopPropagation();
                            setModalLink(link);
                          }}
                        >
                          <QrCode />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="link-action-btn"
                          aria-label="Copy"
                          onClick={(event) => {
                            event.stopPropagation();
                            void copyLink(link.url);
                          }}
                        >
                          <Copy />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="link-action-btn"
                          aria-label="Delete"
                          onClick={(event) => {
                            event.stopPropagation();
                            deleteLink(link.id);
                          }}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

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
              <span className="page-indicator">Page {safePage}/{totalPages}</span>
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
      </div>

      {createOpen && (
        <div className="payment-links-modal" onClick={() => setCreateOpen(false)}>
          <div className="payment-links-modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Create payment link</h3>
              <button
                type="button"
                className="modal-close"
                onClick={() => setCreateOpen(false)}
                aria-label="Close"
              >
                <X />
              </button>
            </div>
            <form className="modal-body" onSubmit={handleCreate}>
              <div className="flex gap-2">
                <div className="w-1/3">
                  <label className="text-sm font-semibold block mb-1">Asset</label>
                  <select
                    value={formAsset}
                    onChange={(e) => setFormAsset(e.target.value as "USDC" | "XLM")}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="USDC">USDC</option>
                    <option value="XLM">XLM</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-sm font-semibold block mb-1">Amount</label>
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={formAmount}
                    onChange={(e) => setFormAmount(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
              </div>
              <label className="text-sm font-semibold">
                Description (optional)
                <Input
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  placeholder="What is this for?"
                />
              </label>
              <Button type="submit" disabled={busy}>
                {busy ? "Creating…" : "Create link"}
              </Button>
            </form>

          </div>
        </div>
      )}

      {modalLink && (
        <div className="payment-links-modal" onClick={() => setModalLink(null)}>
          <div className="payment-links-modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">{modalLink.title}</h3>
              <button
                type="button"
                className="modal-close"
                onClick={() => setModalLink(null)}
                aria-label="Close"
              >
                <X />
              </button>
            </div>
            <div className="modal-body">
              <div className="modal-row">
                <span className="modal-label">Asset</span>
                <span className="modal-value">{modalLink.asset}</span>
              </div>
              <div className="modal-row">
                <span className="modal-label">Amount</span>
                <span className="modal-value">${modalLink.amount}</span>
              </div>
              <div className="modal-row">
                <span className="modal-label">Status</span>
                <span className={`link-status ${modalLink.status === "pending" ? "active" : "disabled"}`}>
                  {modalLink.status}
                </span>
              </div>
              <div className="modal-row">
                <span className="modal-label">Created</span>
                <span className="modal-value">{modalLink.createdAt}</span>
              </div>
              <div className="modal-qr">
                <QRCodeSVG value={modalLink.url} size={140} />
              </div>
              <div className="modal-copy">
                <Input readOnly value={modalLink.url} />
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={() => copyLink(modalLink.url)}
                  aria-label="Copy link"
                >
                  {copied ? <Check /> : <Copy />}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PaymentLinksPage;
