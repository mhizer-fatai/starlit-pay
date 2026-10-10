import { jsPDF } from "jspdf";

import { drawWatermark, loadBrandLogo, makeWatermarkTile } from "@/lib/receiptPdf";
import { assetToUsd, formatGrouped, type ActivityItem } from "@/lib/wallet";

export type StatementFormat = "pdf" | "xls";

const SOCIALS = ["starlitpay.xyz", "support@starlitpay.xyz"];

function usd(value: number): string {
  return `$${formatGrouped(value)}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Excel-compatible statement (HTML table saved as .xls). */
export function buildStatementXls(items: ActivityItem[], period: string): string {
  const chrono = [...items].reverse();
  const running: Record<string, number> = {};
  const cell = (asset: string, amount: number) =>
    `${formatGrouped(amount)} ${asset.toUpperCase()} (${usd(assetToUsd(asset, amount))})`;
  const rows = chrono
    .map((item) => {
      const asset = item.asset.toUpperCase();
      const before = running[asset] ?? 0;
      const after = before + (item.direction === "in" ? 1 : -1) * item.amount;
      running[asset] = after;
      const date = item.date ? new Date(item.date).toLocaleDateString("en-GB") : "";
      const type = item.direction === "in" ? "Money In" : "Money Out";
      return `<tr><td>${escapeHtml(date)}</td><td>${escapeHtml(type)}</td><td style="text-align:right">${escapeHtml(cell(asset, before))}</td><td style="text-align:right">${escapeHtml(cell(asset, after))}</td><td>${escapeHtml(item.reference || "")}</td></tr>`;
    })
    .join("");
  const body = rows || `<tr><td colspan="5">No transactions in this period.</td></tr>`;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><h2>Starlit Pay — Account Statement</h2><p>Period: ${escapeHtml(period)}</p><table border="1" cellpadding="4" cellspacing="0"><thead><tr><th>Transaction Date</th><th>Transaction Type</th><th style="text-align:right">Balance Before</th><th style="text-align:right">Balance After</th><th>Transaction Reference</th></tr></thead><tbody>${body}</tbody></table></body></html>`;
}

/** Multi-row statement PDF with automatic page breaks. */
export async function buildStatementPdf(
  items: ActivityItem[],
  period: string,
  email: string,
): Promise<ArrayBuffer> {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 48;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const width = pageW - margin * 2;
  const right = margin + width;
  let y = 64;

  const logo = await loadBrandLogo();
  if (logo) {
    const tile = makeWatermarkTile(logo);
    if (tile) drawWatermark(doc, tile);
  }

  // Top row: brand left, social handles right.
  const brandY = y;
  if (logo) {
    const logoH = 26;
    const logoW = (logo.naturalWidth / logo.naturalHeight) * logoH;
    doc.addImage(logo, "PNG", margin, brandY - 19, logoW, logoH);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.setTextColor("#0f172a");
    doc.text("Starlit Pay", margin + logoW + 4, brandY);
  } else {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.setTextColor("#0f172a");
    doc.text("Starlit Pay", margin, brandY);
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor("#64748b");
  SOCIALS.forEach((line, i) => {
    doc.text(line, right, brandY - 12 + i * 12, { align: "right" });
  });
  y = brandY + 22;

  const thinLine = () => {
    doc.setDrawColor("#cbd5e1");
    doc.setLineWidth(0.75);
    doc.line(margin, y, right, y);
    doc.setLineWidth(1);
    y += 8;
  };
  thinLine();

  y += 28;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor("#0f172a");
  doc.text("Account Statement", margin, y);
  y += 20;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor("#475569");
  doc.text(`Period: ${period}`, margin, y);
  if (email) {
    y += 17;
    doc.text(`Account: ${email}`, margin, y);
  }
  y += 8;
  thinLine();
  y += 14;

  // Table geometry.
  const dateX = margin;
  const typeX = margin + 75;
  const beforeRight = margin + 282;
  const afterRight = margin + 414;
  const refX = margin + 419;
  const refW = width - (refX - margin);

  const columnHeads = () => {
    y += 20;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor("#94CFF6");
    doc.text("Transaction Date", dateX, y);
    doc.text("Transaction Type", typeX, y);
    doc.text("Balance Before", beforeRight, y, { align: "right" });
    doc.text("Balance After", afterRight, y, { align: "right" });
    doc.text("Transaction Reference", refX, y);
    y += 6;
    doc.setDrawColor("#e2e8f0");
    doc.line(margin, y, right, y);
  };

  const needPage = (extra: number) => {
    if (y + extra > pageH - 60) {
      doc.addPage();
      y = 48;
      columnHeads();
    }
  };

  columnHeads();

  // Running balance per asset (token amount with USD equivalent in brackets),
  // oldest transaction first.
  const chrono = [...items].reverse();
  const running: Record<string, number> = {};
  const balanceOf = (asset: string) => running[asset.toUpperCase()] ?? 0;
  const balanceText = (asset: string, amount: number) =>
    `${formatGrouped(amount)} ${asset.toUpperCase()} (${usd(assetToUsd(asset, amount))})`;
  const pad = (n: number) => String(n).padStart(2, "0");
  const shortDate = (timestamp: number) => {
    if (!timestamp) return "—";
    const d = new Date(timestamp);
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  };

  if (chrono.length === 0) {
    y += 24;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor("#64748b");
    doc.text("No transactions in this period.", margin, y);
  }

  for (const item of chrono) {
    const asset = item.asset.toUpperCase();
    const before = balanceOf(asset);
    const after = before + (item.direction === "in" ? 1 : -1) * item.amount;
    running[asset] = after;
    const refLines = doc.splitTextToSize(item.reference || "—", refW);
    needPage(refLines.length * 10 + 24);
    y += 20;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor("#0f172a");
    doc.text(shortDate(item.date), dateX, y);
    doc.setTextColor(item.direction === "in" ? "#047857" : "#b45309");
    doc.text(item.direction === "in" ? "Money In" : "Money Out", typeX, y);
    doc.setTextColor("#0f172a");
    doc.text(balanceText(asset, before), beforeRight, y, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.text(balanceText(asset, after), afterRight, y, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor("#475569");
    doc.text(refLines, refX, y);
    y += (refLines.length - 1) * 10;
  }

  needPage(60);
  y += 18;
  doc.setDrawColor("#e2e8f0");
  doc.line(margin, y, right, y);
  y += 22;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor("#0f172a");
  const closingEntries = Object.entries(running);
  const closing =
    closingEntries.length === 0
      ? "Closing balance: $0.00"
      : `Closing balance: ${closingEntries.map(([asset, amount]) => balanceText(asset, amount)).join("  •  ")}`;
  doc.text(`${closing}  •  Transactions: ${chrono.length}`, margin, y);

  y += 28;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor("#94a3b8");
  const note = doc.splitTextToSize(
    "Balances are shown in USD equivalent; amounts may span multiple assets.",
    width,
  );
  doc.text(note, margin, y);

  const buffer = doc.output("arraybuffer") as ArrayBuffer;
  return buffer.slice(0);
}

export function bytesToBase64(bytes: ArrayBuffer | Uint8Array): string {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes as ArrayBuffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < data.length; i += chunk) {
    binary += String.fromCharCode(...data.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
