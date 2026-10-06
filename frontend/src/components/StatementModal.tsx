import { useState } from "react";
import { createPortal } from "react-dom";
import { Check, Download, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { emailStatement } from "@/lib/backend";
import {
  buildStatementPdf,
  buildStatementXls,
  bytesToBase64,
  downloadBlob,
  type StatementFormat,
} from "@/lib/statement";
import {
  filterFeedByRange,
  statementFilename,
  statementPeriodLabel,
  type ActivityItem,
  type StatementRange,
} from "@/lib/wallet";

const FORMATS: { value: StatementFormat; label: string }[] = [
  { value: "pdf", label: "PDF (.pdf)" },
  { value: "xls", label: "Excel (.xls)" },
];

const RANGES: { value: StatementRange; label: string }[] = [
  { value: "last-month", label: "Last month" },
  { value: "last-2-months", label: "Last 2 months" },
  { value: "custom", label: "Custom" },
];

function defaultFrom(): string {
  const d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function defaultTo(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Hides most of an address: timothy@gmail.com → ti*****@g***.c** */
function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  if (!local || !domain) return "your email";
  const [host = "", ...rest] = domain.split(".");
  const tld = rest.join(".");
  return `${local.slice(0, 2)}*****@${host.slice(0, 1)}***${tld ? `.${tld.slice(0, 1)}**` : ""}`;
}

export function StatementModal({
  feed,
  email,
  userName,
  onClose,
}: {
  feed: ActivityItem[];
  email: string;
  userName: string;
  onClose: () => void;
}) {
  const [format, setFormat] = useState<StatementFormat>("pdf");
  const [range, setRange] = useState<StatementRange>("last-month");
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [sendCopy, setSendCopy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function handleDownload() {
    setBusy(true);
    setStatus("");
    setError("");
    try {
      const items = filterFeedByRange(feed, range, from, to);
      const period = statementPeriodLabel(range, from, to);
      const owner = userName || email.split("@")[0] || "user";
      let filename: string;
      let mime: string;
      let bytes: ArrayBuffer | Uint8Array;

      if (format === "pdf") {
        const buffer = await buildStatementPdf(items, period, email);
        filename = statementFilename(owner, "pdf");
        mime = "application/pdf";
        bytes = buffer;
        downloadBlob(new Blob([buffer as BlobPart], { type: mime }), filename);
      } else {
        const html = buildStatementXls(items, period);
        filename = statementFilename(owner, "xls");
        mime = "application/vnd.ms-excel";
        bytes = new TextEncoder().encode(html);
        downloadBlob(new Blob([bytes as BlobPart], { type: `${mime};charset=utf-8` }), filename);
      }

      if (sendCopy) {
        if (!email) {
          setError("No email address on your account to send to.");
          return;
        }
        setStatus(`Sending a copy to ${maskEmail(email)}…`);
        await emailStatement({
          filename,
          mime,
          contentBase64: bytesToBase64(bytes),
          subject: `Your Starlit Pay statement (${period})`,
        });
        setStatus(`Downloaded and emailed to ${maskEmail(email)}.`);
      } else {
        setStatus(`Downloaded ${items.length} transaction${items.length === 1 ? "" : "s"}.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Statement failed — try again.");
    } finally {
      setBusy(false);
    }
  }

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
        aria-labelledby="statement-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h3 className="modal-title" id="statement-modal-title">
            Download Statement
          </h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>
        <div className="modal-body">
          <div>
            <p className="modal-label" style={{ marginBottom: 8 }}>
              File format
            </p>
            <div className="export-options-row">
              {FORMATS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`export-option-btn ${format === option.value ? "export-option-btn-active" : ""}`}
                  onClick={() => setFormat(option.value)}
                >
                  {format === option.value && <Check size={14} />}
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="modal-label" style={{ marginBottom: 8 }}>
              Time frame
            </p>
            <div className="export-options-row">
              {RANGES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`export-option-btn ${range === option.value ? "export-option-btn-active" : ""}`}
                  onClick={() => setRange(option.value)}
                >
                  {range === option.value && <Check size={14} />}
                  {option.label}
                </button>
              ))}
            </div>
            {range === "custom" && (
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <label style={{ flex: 1 }}>
                  <span className="modal-label">From</span>
                  <Input
                    type="date"
                    value={from}
                    max={to}
                    onChange={(event) => setFrom(event.target.value)}
                    style={{ marginTop: 4 }}
                  />
                </label>
                <label style={{ flex: 1 }}>
                  <span className="modal-label">To</span>
                  <Input
                    type="date"
                    value={to}
                    min={from}
                    onChange={(event) => setTo(event.target.value)}
                    style={{ marginTop: 4 }}
                  />
                </label>
              </div>
            )}
          </div>

          <div className="modal-row">
            <span className="modal-label">
              Send a copy to my email{email ? ` (${maskEmail(email)})` : ""}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={sendCopy}
              aria-label="Send a copy to my email inbox"
              onClick={() => setSendCopy((value) => !value)}
              className={`settings-toggle ${sendCopy ? "settings-toggle-on" : "settings-toggle-off"}`}
            >
              <span className="settings-toggle-thumb" />
            </button>
          </div>

          {status && (
            <p className="text-sm text-muted-foreground" role="status">
              {status}
            </p>
          )}
          {error && (
            <p className="text-sm text-red-500" role="alert">
              {error}
            </p>
          )}

          <Button type="button" className="w-full" disabled={busy} onClick={handleDownload}>
            <Download />
            {busy ? "Preparing…" : "Download"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
