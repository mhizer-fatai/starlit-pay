import React from "react";

export default function Receive({
  userProfile,
  showFeedback
}) {
  return (
    <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
      <div>
        <h3 style={{ fontSize: "18px", fontWeight: "700", marginBottom: "16px", color: "var(--text-primary)" }}>Receive Private Payments</h3>
        
        <div className="glass-card" style={{ display: "flex", flexDirection: "column", gap: "20px", marginBottom: "24px", border: "1px solid var(--border-color)", padding: "24px" }}>
          
          {/* Displays the personal Starlit username for internal app transactions */}
          <div>
            <span style={{ fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: "600" }}>Starlit Username</span>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "8px" }}>
              <span style={{ fontSize: "20px", fontWeight: "700", color: "var(--text-primary)" }}>@{userProfile?.username}</span>
              <button 
                onClick={() => {
                  navigator.clipboard.writeText(`@${userProfile?.username}`);
                  showFeedback("success", "Username copied!");
                }} 
                className="btn-secondary" 
                style={{ padding: "8px 14px", fontSize: "12px", height: "auto" }}
              >
                Copy Username
              </button>
            </div>
          </div>

          <hr style={{ border: "none", borderTop: "1px solid var(--border-color)", margin: "0" }} />

          {/* Displays the shared Starlit deposit gateway public address */}
          <div>
            <span style={{ fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: "600" }}>Starlit Deposit Address</span>
            <p style={{ fontSize: "11px", color: "var(--secondary-accent)", wordBreak: "break-all", fontFamily: "var(--font-mono)", marginTop: "8px", marginBottom: "10px" }}>
              GCDQQE7CPLIGMAH4QEB2SSIEAS5MZMFSQAYSEJYSF7P5ZLA6HOU4BWWY
            </p>
            <button 
              onClick={() => {
                navigator.clipboard.writeText("GCDQQE7CPLIGMAH4QEB2SSIEAS5MZMFSQAYSEJYSF7P5ZLA6HOU4BWWY");
                showFeedback("success", "Gateway address copied!");
              }} 
              className="btn-secondary" 
              style={{ width: "100%", padding: "10px 14px", fontSize: "12px", height: "auto" }}
            >
              Copy Address
            </button>
          </div>

          <hr style={{ border: "none", borderTop: "1px solid var(--border-color)", margin: "0" }} />

          {/* Displays the user's specific 6-digit memo ID necessary to route deposits */}
          <div>
            <span style={{ fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: "600" }}>Your Deposit Memo (MEMO ID)</span>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "8px" }}>
              <span style={{ fontSize: "22px", fontWeight: "700", color: "var(--primary-accent)", fontFamily: "var(--font-mono)" }}>
                {userProfile?.deposit_memo || "------"}
              </span>
              <button 
                onClick={() => {
                  navigator.clipboard.writeText(userProfile?.deposit_memo?.toString() || "");
                  showFeedback("success", "Memo ID copied!");
                }} 
                className="btn-secondary" 
                style={{ padding: "8px 14px", fontSize: "12px", height: "auto" }}
              >
                Copy Memo
              </button>
            </div>
            {/* Warning block stressing the import of the Memo ID during a deposit */}
            <div className="glass-card" style={{ marginTop: "14px", padding: "12px", background: "rgba(244, 63, 94, 0.05)", border: "1px solid rgba(244, 63, 94, 0.25)", borderRadius: "10px" }}>
              <p style={{ fontSize: "11px", color: "var(--error-color)", lineHeight: "1.4" }}>
                ⚠️ <strong>IMPORTANT:</strong> You must include this 6-digit Memo ID when sending deposits. Deposits sent without a Memo are lost and cannot be retrieved.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
