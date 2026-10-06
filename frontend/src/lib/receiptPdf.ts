import { jsPDF } from "jspdf";

import type { ActivityItem } from "@/lib/wallet";
import { receiptFilename } from "@/lib/wallet";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

/** Loads the brand logo, or null when unavailable (callers fall back to text). */
export async function loadBrandLogo(): Promise<HTMLImageElement | null> {
  try {
    return await loadImage("/logo.png");
  } catch {
    return null;
  }
}

/**
 * Builds one watermark tile: the logo + "Starlit Pay" pre-rotated on a
 * transparent canvas, stamped at intervals across the page below.
 */
export function makeWatermarkTile(logo: HTMLImageElement): string {
  const tile = 360;
  const canvas = document.createElement("canvas");
  canvas.width = tile;
  canvas.height = tile;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.translate(tile / 2, tile / 2);
  ctx.rotate((-30 * Math.PI) / 180);
  const logoH = 46;
  const logoW = (logo.naturalWidth / logo.naturalHeight) * logoH;
  ctx.font = "700 32px system-ui, sans-serif";
  const textW = ctx.measureText("Starlit Pay").width;
  const gap = 14;
  const totalW = logoW + gap + textW;
  ctx.fillStyle = "#0f172a";
  ctx.textBaseline = "middle";
  ctx.drawImage(logo, -totalW / 2, -logoH / 2, logoW, logoH);
  ctx.fillText("Starlit Pay", -totalW / 2 + logoW + gap, 2);
  return canvas.toDataURL("image/png");
}

/** Stamps a watermark tile across the full page at reduced opacity. */
export function drawWatermark(doc: jsPDF, tile: string) {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  doc.saveGraphicsState();
  doc.setGState(doc.GState({ opacity: 0.07 }));
  const tileSize = 170;
  const stepX = 205;
  const stepY = 195;
  for (let x = -70; x < pageW + 70; x += stepX) {
    for (let y = -50; y < pageH + 50; y += stepY) {
      doc.addImage(tile, "PNG", x, y, tileSize, tileSize);
    }
  }
  doc.restoreGraphicsState();
}

/** Downloads a single transaction receipt as a PDF file. */
export async function downloadReceiptPdf(item: ActivityItem, userName = "user") {
  const incoming = item.direction === "in";
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 48;
  const width = doc.internal.pageSize.getWidth() - margin * 2;
  let y = 64;

  let logo: HTMLImageElement | null = null;
  try {
    logo = await loadBrandLogo();
    // Patterned background first so all content sits above it.
    if (logo) {
      const tile = makeWatermarkTile(logo);
      if (tile) drawWatermark(doc, tile);
    }
  } catch {
    logo = null;
  }

  // Brand line: logo + "Starlit Pay" (text fallback if the image is missing).
  if (logo) {
    const logoH = 28;
    const logoW = (logo.naturalWidth / logo.naturalHeight) * logoH;
    doc.addImage(logo, "PNG", margin, y - 20, logoW, logoH);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor("#0f172a");
    doc.text("Starlit Pay", margin + logoW + 4, y);
  } else {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor("#0f172a");
    doc.text("Starlit Pay", margin, y);
  }
  y += 18;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(13);
  doc.setTextColor("#64748b");
  doc.text("Transaction Receipt", margin, y);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(30);
  doc.setTextColor(incoming ? "#047857" : "#1e293b");
  doc.text(`${incoming ? "+" : "-"}${item.amount} ${item.asset}`, margin, (y += 64));

  doc.setFontSize(12);
  doc.setTextColor("#64748b");
  doc.text(incoming ? "Incoming funds" : "Outgoing funds", margin, (y += 22));

  doc.setDrawColor("#e2e8f0");
  doc.line(margin, (y += 14), margin + width, y);
  y += 8;

  const row = (label: string, value: string) => {
    y += 24;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor("#64748b");
    doc.text(label, margin, y);
    doc.setTextColor("#0f172a");
    const lines = doc.splitTextToSize(value || "—", width - 170);
    doc.text(lines, margin + 170, y);
    y += (lines.length - 1) * 14;
  };

  doc.setTextColor("#0f172a");
  row("Date & Time", item.date ? new Date(item.date).toLocaleString() : "—");
  row(incoming ? "Sender" : "Recipient", item.party || "—");
  row(item.referenceLabel || "Reference", item.reference || "—");

  y += 32;
  doc.setFontSize(10);
  doc.setTextColor("#94a3b8");
  const note = doc.splitTextToSize(
    "Private shielded payment — details are encrypted and not published to the public ledger.",
    width,
  );
  doc.text(note, margin, y);

  const slug = (item.reference || item.key || "receipt").replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 24);
  doc.save(receiptFilename(userName));
}
