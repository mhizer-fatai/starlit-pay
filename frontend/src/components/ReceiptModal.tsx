import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDownLeft, Check, Copy, Download, ExternalLink, Send, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { downloadReceiptPdf } from "@/lib/receiptPdf";
import type { ActivityItem } from "@/lib/wallet";

function shortRef(ref: string): string {
  if (!ref) return "—";
  if (ref.length <= 24) return ref;
  return `${ref.slice(0, 16)}…${ref.slice(-12)}`;
}

function CopyIconButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="modal-close"
      style={{ width: 28, height: 28, flexShrink: 0 }}
      title={`Copy ${label}`}
      aria-label={`Copy ${label}`}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

const fieldBoxStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  background: "oklch(0.96 0.006 250)",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  padding: "10px 8px 10px 12px",
} as const;

const fieldValueStyle = {
  flex: 1,
  minWidth: 0,
  fontFamily: "monospace",
  fontSize: 12,
  wordBreak: "break-all",
  lineHeight: 1.5,
} as const;

/** Full transaction receipt, mirroring the previous frontend's details modal. */
export function ReceiptModal({
  item,
  userName = "user",
  onClose,
}: {
  item: ActivityItem;
  userName?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const incoming = item.direction === "in";
  const partyKind = incoming ? "sender" : "recipient";
  const partyLabelText = incoming ? "Sender" : "Recipient";

  const targetHash =
    item.hash ||
    (/^[0-9a-fA-F]{64}$/.test(item.reference) ? item.reference : null);

  const stellarExpertUrl = targetHash
    ? `https://stellar.expert/explorer/testnet/tx/${targetHash}`
    : item.ledger
    ? `https://stellar.expert/explorer/testnet/ledger/${item.ledger}`
    : null;

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
        style={{
          maxHeight: "calc(100vh - 40px)",
          overflowY: "auto",
        }}
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
            <span className="modal-value">{incoming ? "Incoming funds" : "Outgoing funds"}</span>
          </div>
          <div className="modal-row">
            <span className="modal-label">Date &amp; Time</span>
            <span className="modal-value">
              {item.date ? new Date(item.date).toLocaleString() : "—"}
            </span>
          </div>
          <div>
            <div className="modal-row" style={{ marginBottom: 8 }}>
              <span className="modal-label">{partyLabelText}</span>
            </div>
            {item.party ? (
              <div style={fieldBoxStyle}>
                <span style={fieldValueStyle}>{item.party}</span>
                <CopyIconButton value={item.party} label={partyKind} />
              </div>
            ) : (
              <div style={fieldBoxStyle}>
                <span style={{ ...fieldValueStyle, fontFamily: "inherit" }}>—</span>
              </div>
            )}
          </div>
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
            <div>
              <div className="modal-row" style={{ marginBottom: 8 }}>
                <span className="modal-label">Reference</span>
              </div>
              <div style={fieldBoxStyle}>
                <span style={fieldValueStyle}>{item.reference}</span>
                <CopyIconButton value={item.reference} label="reference" />
              </div>
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

          {stellarExpertUrl && (
            <Button asChild variant="outline" className="w-full text-xs">
              <a href={stellarExpertUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                View on Stellar Expert
              </a>
            </Button>
          )}

          <div className="flex gap-2">
            <Button type="button" className="flex-1" onClick={onClose}>
              Close Receipt
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="h-9 w-9 shrink-0"
              aria-label="Download receipt as PDF"
              title="Download receipt as PDF"
              onClick={() => {
                void downloadReceiptPdf(item, userName);
              }}
            >
              <Download />
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
