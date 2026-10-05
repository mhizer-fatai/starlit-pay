import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDownLeft, Send, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { activityTitle, partyLabel, type ActivityItem } from "@/lib/wallet";

function shortRef(ref: string): string {
  if (!ref) return "—";
  if (ref.length <= 24) return ref;
  return `${ref.slice(0, 16)}…${ref.slice(-12)}`;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="export-option-btn"
      style={{ padding: "4px 10px", fontSize: "12px" }}
      disabled={!value}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/** Full transaction receipt, mirroring the previous frontend's details modal. */
export function ReceiptModal({ item, onClose }: { item: ActivityItem; onClose: () => void }) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const incoming = item.direction === "in";
  const party = partyLabel(item.party);

  return createPortal(
    <div
      className="send-modal"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="send-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="receipt-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h3 className="modal-title" id="receipt-title">
            Transaction Receipt
          </h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>
        <div className="modal-body">
          <div style={{ textAlign: "center", padding: "4px 0 8px" }}>
            <span
              className="activity-icon"
              style={{
                display: "inline-grid",
                placeItems: "center",
                width: 44,
                height: 44,
                borderRadius: "50%",
                background: incoming ? "oklch(0.95 0.05 155)" : "oklch(0.93 0.05 265)",
                color: incoming ? "var(--color-dashboard-green)" : "var(--color-dashboard-blue)",
              }}
            >
              {incoming ? <ArrowDownLeft /> : <Send />}
            </span>
            <div
              style={{ fontSize: 28, fontWeight: 700, marginTop: 12 }}
              className={incoming ? "amount-positive" : "amount-negative"}
            >
              {incoming ? "+" : "−"}
              {item.amount} {item.asset}
            </div>
            <div style={{ marginTop: 8 }}>
              <span
                style={{
                  display: "inline-block",
                  fontSize: 12,
                  fontWeight: 600,
                  padding: "4px 12px",
                  borderRadius: 999,
                  background: incoming ? "oklch(0.95 0.05 155)" : "oklch(0.93 0.05 265)",
                  color: incoming ? "var(--color-dashboard-green)" : "var(--color-dashboard-blue)",
                }}
              >
                {incoming ? "Received" : "Sent"}
              </span>
            </div>
          </div>

          <div className="modal-row">
            <span className="modal-label">Type</span>
            <span className="modal-value">{activityTitle(item)}</span>
          </div>
          <div className="modal-row">
            <span className="modal-label">Date &amp; Time</span>
            <span className="modal-value">
              {item.date ? new Date(item.date).toLocaleString() : "—"}
            </span>
          </div>
          <div className="modal-row">
            <span className="modal-label">{incoming ? "Sender" : "Recipient"}</span>
            <span
              className="modal-value"
              style={{ fontFamily: "monospace", fontSize: 12, wordBreak: "break-all" }}
            >
              {party || "—"}
            </span>
          </div>
          {item.party && (
            <div className="modal-row">
              <span className="modal-label">Full {incoming ? "sender" : "recipient"} value</span>
              <CopyButton value={item.party} />
            </div>
          )}
          <div className="modal-row">
            <span className="modal-label">{item.referenceLabel}</span>
            <span
              className="modal-value"
              style={{ fontFamily: "monospace", fontSize: 12, wordBreak: "break-all" }}
            >
              {shortRef(item.reference)}
            </span>
          </div>
          {item.reference && (
            <div className="modal-row">
              <span className="modal-label">Copy reference</span>
              <CopyButton value={item.reference} />
            </div>
          )}

          <div
            style={{
              textAlign: "center",
              fontSize: 12,
              color: "var(--color-muted-foreground)",
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px dashed var(--color-border)",
            }}
          >
            Private shielded payment — details are encrypted and not published to the public
            ledger.
          </div>

          <Button type="button" className="w-full" onClick={onClose}>
            Close Receipt
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
