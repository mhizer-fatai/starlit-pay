import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDownLeft, Check, Copy, Download, ExternalLink, Send, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { downloadReceiptPdf } from "@/lib/receiptPdf";
import type { ActivityItem } from "@/lib/wallet";


function CopyIconButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="p-1.5 rounded-md hover:bg-background/80 text-muted-foreground hover:text-foreground transition-colors shrink-0"
      title={`Copy ${label}`}
      aria-label={`Copy ${label}`}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
    </button>
  );
}

const fieldBoxStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  background: "var(--color-muted)",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  padding: "8px 12px",
} as const;

const fieldValueStyle = {
  flex: 1,
  minWidth: 0,
  fontFamily: "monospace",
  fontSize: 12,
  wordBreak: "break-all",
  lineHeight: 1.5,
  color: "var(--color-foreground)",
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

  const isActualTxHash = Boolean(
    item.hash ||
    (item.referenceLabel === "Transaction Hash" && /^[0-9a-fA-F]{64}$/.test(item.reference))
  );

  const targetHash = item.hash || (isActualTxHash ? item.reference : null);

  const stellarExpertUrl = targetHash
    ? `https://stellar.expert/explorer/testnet/tx/${targetHash}`
    : item.ledger
    ? `https://stellar.expert/explorer/testnet/ledger/${item.ledger}`
    : `https://stellar.expert/explorer/testnet/contract/CAHSOWD7JVCRO4U73MGXRET7DRJDM3K2CFS5EGYARWDEGACHWSR6ZEZM`;

  const stellarExpertLabel = targetHash
    ? "View on Stellar Expert"
    : item.ledger
    ? `View Ledger #${item.ledger} on Stellar Expert`
    : "View on Stellar Expert";

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
          <button
            type="button"
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          <div style={{ textAlign: "center", padding: "4px 0 10px" }}>
            <span
              style={{
                display: "inline-grid",
                placeItems: "center",
                width: 48,
                height: 48,
                borderRadius: "50%",
                background: incoming ? "oklch(0.63 0.16 155 / 0.18)" : "oklch(0.63 0.18 265 / 0.18)",
                color: incoming ? "var(--color-dashboard-green)" : "var(--color-dashboard-blue)",
                margin: "0 auto",
              }}
            >
              {incoming ? <ArrowDownLeft size={24} /> : <Send size={24} />}
            </span>
            <div
              style={{
                fontSize: 26,
                fontWeight: 700,
                marginTop: 10,
                letterSpacing: "-0.02em",
                color: incoming ? "var(--color-dashboard-green)" : "var(--color-foreground)",
              }}
            >
              {incoming ? "+" : "−"}
              {item.amount} {item.asset}
            </div>
            <div style={{ marginTop: 6 }}>
              <span
                style={{
                  display: "inline-block",
                  fontSize: 12,
                  fontWeight: 600,
                  padding: "3px 12px",
                  borderRadius: 999,
                  background: incoming ? "oklch(0.63 0.16 155 / 0.18)" : "oklch(0.63 0.18 265 / 0.18)",
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
            <div className="modal-row" style={{ marginBottom: 6 }}>
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

          {item.reference && (
            <div>
              <div className="modal-row" style={{ marginBottom: 6 }}>
                <span className="modal-label">{item.referenceLabel || "Reference"}</span>
              </div>
              <div style={fieldBoxStyle}>
                <span style={fieldValueStyle}>{item.reference}</span>
                <CopyIconButton value={item.reference} label={item.referenceLabel || "reference"} />
              </div>
            </div>
          )}

          <div
            style={{
              textAlign: "center",
              fontSize: 11,
              color: "var(--color-muted-foreground)",
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px dashed var(--color-border)",
              background: "oklch(from var(--color-muted) l c h / 0.25)",
              lineHeight: 1.4,
            }}
          >
            Private shielded payment — details are encrypted and not published to the public
            ledger.
          </div>

          {stellarExpertUrl && (
            <Button asChild variant="outline" className="w-full text-xs">
              <a href={stellarExpertUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                {stellarExpertLabel}
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
              <Download size={16} />
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
