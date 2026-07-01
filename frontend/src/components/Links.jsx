import React from "react";
import { RefreshCw } from "lucide-react";

export default function Links({
  depositAmount,
  setDepositAmount,
  selectedAsset,
  setSelectedAsset,
  loading,
  generatedLink,
  setGeneratedLink,
  handleCreatePaymentLink,
  showFeedback
}) {
  return (
    <div className="glass-panel tab-pane" style={{ padding: "40px", maxWidth: "640px" }}>
      
      <div>
        <p style={{ color: "var(--text-muted)", fontSize: "14px", marginBottom: "24px", lineHeight: "1.6" }}>
          Generate a payment request link. When someone opens this link, they can sign a transaction to pay you directly to your Starlit address. No funds are deducted from your balance to create this link.
        </p>

        <form onSubmit={handleCreatePaymentLink} style={{ display: "flex", flexDirection: "column", gap: "20px", marginBottom: "32px" }}>
          <div>
            <label style={{ display: "block", fontSize: "13px", color: "var(--text-muted)", marginBottom: "8px" }}>Select Asset</label>
            <select value={selectedAsset} onChange={(e) => setSelectedAsset(e.target.value)}>
              <option value="USDC">USDC</option>
              <option value="XLM">XLM</option>
            </select>
          </div>

          <div>
            <label style={{ display: "block", fontSize: "13px", color: "var(--text-muted)", marginBottom: "8px" }}>Amount Requested</label>
            <input 
              type="number" 
              step="0.01" 
              placeholder="0.00" 
              value={depositAmount} 
              onChange={(e) => setDepositAmount(e.target.value)} 
              required 
            />
          </div>

          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? "Generating Link..." : "Generate Request Link"}
          </button>
        </form>
      </div>

      {/* Renders the output generated link and copy actions */}
      {generatedLink && (
        <div className="glass-card" style={{ display: "flex", flexDirection: "column", gap: "16px", border: "1px solid var(--primary-accent)", background: "rgba(139, 92, 246, 0.05)", padding: "24px" }}>
          <h4 style={{ fontSize: "15px", fontWeight: "600", color: "white" }}>Your Link is Ready:</h4>
          <div style={{ display: "flex", gap: "8px" }}>
            <input 
              type="text" 
              value={generatedLink} 
              readOnly 
              style={{ fontSize: "13px", background: "rgba(0,0,0,0.5)", fontFamily: "var(--font-mono)", padding: "12px" }} 
            />
            <button 
              onClick={() => {
                navigator.clipboard.writeText(generatedLink);
                showFeedback("success", "Link copied!");
              }} 
              className="btn-primary" 
              style={{ padding: "0 24px", fontSize: "14px", whiteSpace: "nowrap" }}
            >
              Copy
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--text-muted)", fontSize: "13px" }}>
            <RefreshCw size={12} className="animate-spin" style={{ color: "var(--primary-accent)" }} />
            <span>Expires in 30 minutes (one-time pay).</span>
          </div>
        </div>
      )}
    </div>
  );
}

