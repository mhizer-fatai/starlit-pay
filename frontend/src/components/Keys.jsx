import React from "react";
import { Download, Eye, EyeOff } from "lucide-react";

export default function Keys({
  walletKeys,
  userProfile,
  transactions,
  showViewingKey,
  setShowViewingKey,
  showFeedback
}) {
  return (
    <div className="glass-panel tab-pane" style={{ padding: "40px", maxWidth: "680px" }}>
      {/* Information text detailing page purpose */}
      <p style={{ color: "var(--text-muted)", fontSize: "15px", marginBottom: "28px" }}>
        View your security keys or download private statements of your transaction history for auditing.
      </p>

      <div className="glass-card" style={{ display: "flex", flexDirection: "column", gap: "24px", marginBottom: "32px", padding: "28px" }}>
        {/* Displays the public viewing routing key used to encrypt notes */}
        <div>
          <h4 style={{ fontSize: "14px", fontWeight: "600", marginBottom: "6px", color: "var(--text-primary)" }}>Public Viewing Routing Key</h4>
          <code style={{ fontSize: "12px", wordBreak: "break-all", color: "var(--secondary-accent)", fontFamily: "var(--font-mono)" }}>
            {walletKeys?.viewing.publicKey}
          </code>
        </div>

        {/* Displays the user's personal funding Stellar address */}
        <div>
          <h4 style={{ fontSize: "14px", fontWeight: "600", marginBottom: "6px", color: "var(--text-primary)" }}>Stellar Public Funding Address</h4>
          <code style={{ fontSize: "12px", wordBreak: "break-all", color: "var(--primary-accent)", fontFamily: "var(--font-mono)" }}>
            {walletKeys?.stellar.publicKey}
          </code>
        </div>

        {/* Displays the secret viewing routing key which is toggleable for privacy */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
            <h4 style={{ fontSize: "14px", fontWeight: "600", color: "var(--text-primary)" }}>Private Statement Access Key (Viewing Secret Key)</h4>
            <button 
              onClick={() => setShowViewingKey(!showViewingKey)} 
              style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", fontSize: "13px" }}
            >
              {showViewingKey ? <EyeOff size={14} /> : <Eye size={14} />}
              {showViewingKey ? "Show" : "Hide"}
            </button>
          </div>
          <code style={{ fontSize: "12px", wordBreak: "break-all", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            {showViewingKey ? walletKeys?.viewing.secretKey : "••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••"}
          </code>
        </div>
      </div>

      {/* Button to download the full transaction statement history in JSON format */}
      <button 
        onClick={() => {
          const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({
            username: userProfile?.username,
            email: userProfile?.email,
            viewingPublicKey: walletKeys?.viewing.publicKey,
            viewingSecretKey: walletKeys?.viewing.secretKey,
            transactions: transactions
          }, null, 2));
          const downloadAnchor = document.createElement("a");
          downloadAnchor.setAttribute("href", dataStr);
          downloadAnchor.setAttribute("download", `starlit_statement_${userProfile?.username}.json`);
          document.body.appendChild(downloadAnchor);
          downloadAnchor.click();
          downloadAnchor.remove();
          showFeedback("success", "Statement downloaded successfully!");
        }} 
        className="btn-primary" 
        style={{ width: "100%", padding: "18px" }}
      >
        <Download size={18} />
        Download Statement History (JSON)
      </button>
    </div>
  );
}
