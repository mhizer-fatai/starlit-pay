import React, { useState } from "react";
import { Coins, Download, Send } from "lucide-react";

export default function Activity({ transactions, theme }) {
  const [selectedTx, setSelectedTx] = useState(null);

  return (
    <section className="grid-panel">
      {/* Section header title */}
      <h3 style={{ fontSize: "18px", fontWeight: "700", marginBottom: "16px", color: "var(--text-primary)" }}>Recent Activity</h3>
      
      <div className="scrollable-content">
        {/* Render empty state icon and text if no transactions exist */}
        {transactions.length === 0 ? (
          <div style={{ textAlign: "center", padding: "64px 0", color: "var(--text-muted)" }}>
            <Coins size={40} style={{ opacity: 0.15, marginBottom: "16px" }} />
            <p style={{ fontSize: "15px" }}>No payments yet</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {/* Map and display transaction rows with descriptive icons, directions, and badges */}
            {transactions.map((tx, idx) => {
              const isIncoming = tx.type === "Incoming" || tx.type === "Received" || tx.type === "Deposit" || tx.type === "Deposited";
              
              // Determine sliced display label
              let displayLabel = "";
              if (tx.type === "Deposit") {
                displayLabel = tx.party && tx.party.startsWith("G")
                  ? `Deposit from ${tx.party.slice(0, 6)}...${tx.party.slice(-4)}`
                  : "Deposit";
              } else if (tx.type === "Withdrawal") {
                displayLabel = tx.party && tx.party.startsWith("G")
                  ? `Withdraw to ${tx.party.slice(0, 6)}...${tx.party.slice(-4)}`
                  : "Withdrawal";
              } else if (tx.type === "Incoming" || tx.type === "Received" || tx.type === "Deposited") {
                displayLabel = tx.party && tx.party.startsWith("G")
                  ? `Received from ${tx.party.slice(0, 6)}...${tx.party.slice(-4)}`
                  : `Received from @${tx.party}`;
              } else {
                displayLabel = tx.party && tx.party.startsWith("G")
                  ? `Sent to ${tx.party.slice(0, 6)}...${tx.party.slice(-4)}`
                  : `Sent to @${tx.party}`;
              }

              return (
                <div 
                  key={idx} 
                  className="glass-card" 
                  style={{ 
                    display: "flex", 
                    justifyContent: "space-between", 
                    alignItems: "center", 
                    padding: "14px 16px",
                    cursor: "pointer",
                    transition: "transform 0.2s ease, background 0.2s ease",
                    background: "rgba(255, 255, 255, 0.02)",
                    border: "1px solid var(--border-color)"
                  }}
                  onClick={() => setSelectedTx(tx)}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = "translateY(-2px)";
                    e.currentTarget.style.background = "rgba(255, 255, 255, 0.05)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.background = "rgba(255, 255, 255, 0.02)";
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    {/* Icon circle colored green for incoming and white for outgoing */}
                    <div style={{ 
                      padding: "8px", 
                      background: isIncoming ? "rgba(16, 185, 129, 0.1)" : "rgba(255, 255, 255, 0.04)",
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center"
                    }}>
                      {isIncoming ? (
                        <Download size={15} style={{ color: "#10b981" }} />
                      ) : (
                        <Send size={15} style={{ color: "var(--text-primary)" }} />
                      )}
                    </div>
                    <div>
                      {/* Header text detailing payment action and counterparty */}
                      <h4 style={{ fontSize: "14px", fontWeight: "600", color: "var(--text-primary)" }}>
                        {displayLabel}
                      </h4>
                      {/* Unique transaction hash */}
                      <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                        {tx.hash ? `Hash: ${tx.hash.slice(0, 16)}...` : ""}
                      </span>
                    </div>
                  </div>
                  {/* Visual amount difference colored according to direction */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                    <span className={`pill-badge ${isIncoming ? "badge-incoming" : "badge-outgoing"}`} style={{ fontSize: "13px", fontWeight: "700" }}>
                      {isIncoming ? "+" : "-"}{tx.amount} <span style={{ fontSize: "10px", opacity: 0.8 }}>{tx.asset}</span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Transaction Details Modal */}
      {selectedTx && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(0,0,0,0.85)",
          backdropFilter: "blur(8px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000,
        }} onClick={() => setSelectedTx(null)}>
          <div className="glass-card" style={{
            width: "90%",
            maxWidth: "440px",
            background: theme === "light" ? "var(--card-bg)" : "rgba(25, 20, 45, 0.95)",
            border: "1px solid var(--border-color)",
            borderRadius: "20px",
            padding: "28px",
            display: "flex",
            flexDirection: "column",
            gap: "20px",
            position: "relative",
          }} onClick={(e) => e.stopPropagation()}>
            
            {/* Close button */}
            <button 
              onClick={() => setSelectedTx(null)}
              style={{
                position: "absolute",
                top: "16px",
                right: "16px",
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: "18px"
              }}
            >
              ✕
            </button>

            <div style={{ textAlign: "center" }}>
              <span style={{ fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: "600", letterSpacing: "1px" }}>
                Transaction Receipt
              </span>
              <h2 style={{ fontSize: "32px", fontWeight: "800", color: "var(--text-primary)", marginTop: "12px", marginBottom: "4px" }}>
                {(selectedTx.type === "Withdrawal" || selectedTx.type === "Sent") ? "-" : "+"}{selectedTx.amount} <span style={{ fontSize: "18px", fontWeight: "500", color: "var(--text-muted)" }}>{selectedTx.asset}</span>
              </h2>
              <span className={`pill-badge ${ (selectedTx.type === "Withdrawal" || selectedTx.type === "Sent") ? "badge-outgoing" : "badge-incoming"}`} style={{ fontSize: "11px", display: "inline-block" }}>
                {(selectedTx.type === "Incoming" || selectedTx.type === "Received" || selectedTx.type === "Deposited") ? "Deposited" : selectedTx.type}
              </span>
            </div>

            <hr style={{ border: "none", borderTop: "1px solid var(--border-color)", margin: "8px 0" }} />

            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
                <span style={{ color: "var(--text-muted)" }}>Date & Time</span>
                <span style={{ color: "var(--text-primary)", fontWeight: "500" }}>
                  {new Date(selectedTx.timestamp).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                </span>
              </div>

              {selectedTx.party && (
                <div style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "13px" }}>
                  <span style={{ color: "var(--text-muted)" }}>
                    {(selectedTx.type === "Withdrawal" || selectedTx.type === "Sent") ? "Recipient" : "Sender"}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", justifyItems: "center", justifyContent: "space-between", background: "var(--input-bg)", padding: "10px 12px", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
                    <span style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono)", fontSize: "11px", wordBreak: "break-all", marginRight: "10px", lineHeight: "1.4" }}>
                      {selectedTx.party.startsWith("G") ? selectedTx.party : `@${selectedTx.party}`}
                    </span>
                    <button 
                      onClick={() => {
                        navigator.clipboard.writeText(selectedTx.party);
                      }}
                      className="btn-secondary"
                      style={{ padding: "4px 8px", fontSize: "10px", height: "auto", whiteSpace: "nowrap" }}
                    >
                      Copy
                    </button>
                  </div>
                </div>
              )}

              {selectedTx.hash && (
                <div style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "13px" }}>
                  <span style={{ color: "var(--text-muted)" }}>Transaction Hash</span>
                  <div style={{ display: "flex", alignItems: "center", justifyItems: "center", justifyContent: "space-between", background: "var(--input-bg)", padding: "10px 12px", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
                    <span style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono)", fontSize: "11px", wordBreak: "break-all", marginRight: "10px" }}>
                      {selectedTx.hash}
                    </span>
                    <button 
                      onClick={() => {
                        navigator.clipboard.writeText(selectedTx.hash);
                      }}
                      className="btn-secondary"
                      style={{ padding: "4px 8px", fontSize: "10px", height: "auto", whiteSpace: "nowrap" }}
                    >
                      Copy
                    </button>
                  </div>
                  <a 
                    href={`https://stellar.expert/explorer/testnet/tx/${selectedTx.hash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: "11px", color: "var(--primary-accent)", textDecoration: "none", alignSelf: "flex-end", marginTop: "4px" }}
                  >
                    View on Stellar.expert ↗
                  </a>
                </div>
              )}
            </div>

            <button 
              onClick={() => setSelectedTx(null)}
              className="btn-primary"
              style={{ width: "100%", marginTop: "8px" }}
            >
              Close Receipt
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
