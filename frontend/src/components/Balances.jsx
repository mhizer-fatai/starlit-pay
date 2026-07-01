import React from "react";
import { Send, Download, Coins } from "lucide-react";

export default function Balances({
  shieldedBalances,
  walletAction,
  setDashboardAction,
  setWalletAction,
  prices = { USDC: 1.00, XLM: 0.12 },
  userProfile
}) {
  const totalBalance = (shieldedBalances?.USDC || 0) * prices.USDC + (shieldedBalances?.XLM || 0) * prices.XLM;

  return (
    <div style={{ flexGrow: 1, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "20px", marginTop: "8px" }}>
        
        {/* Render private single total balance card */}
        <div className="premium-card" style={{ 
          minHeight: "180px",
          background: "linear-gradient(135deg, #4c1d95 0%, #1e1b4b 100%)",
          backgroundImage: "radial-gradient(circle at 20% 30%, rgba(139, 92, 246, 0.4), transparent 70%), radial-gradient(circle at 80% 70%, rgba(59, 130, 246, 0.35), transparent 70%), linear-gradient(135deg, #4c1d95 0%, #1e1b4b 100%)",
          padding: "24px 28px",
          borderRadius: "24px",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          position: "relative",
          overflow: "hidden"
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", width: "100%" }}>
            <span style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "1px", color: "rgba(255, 255, 255, 0.5)", textTransform: "uppercase" }}>Your Balance</span>
            <span className="pill-badge" style={{ background: "rgba(255, 255, 255, 0.1)", color: "#ffffff", fontSize: "9px", padding: "4px 8px", borderRadius: "8px", border: "1px solid rgba(255, 255, 255, 0.15)" }}>
              SHIELDED
            </span>
          </div>
          <div style={{ margin: "20px 0" }}>
            <h2 style={{ fontSize: "36px", fontWeight: "800", fontFamily: "var(--font-sans)", color: "#ffffff", letterSpacing: "-1px" }}>
              ${totalBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </h2>
          </div>
          
          {/* Bottom Drawer showing breakdown */}
          <div style={{ 
            display: "flex", 
            justifyContent: "space-between", 
            alignItems: "center", 
            background: "rgba(0, 0, 0, 0.3)", 
            margin: "0 -28px -28px", 
            padding: "14px 28px",
            borderTop: "1px solid rgba(255, 255, 255, 0.05)"
          }}>
            <div style={{ display: "flex", gap: "20px" }}>
              <div>
                <span style={{ fontSize: "9px", color: "rgba(255, 255, 255, 0.4)", textTransform: "uppercase", display: "block" }}>USDC</span>
                <span style={{ fontSize: "13px", fontWeight: "700", fontFamily: "var(--font-mono)", color: "#ffffff" }}>
                  ${(shieldedBalances?.USDC || 0).toFixed(2)}
                </span>
              </div>
              <div style={{ borderLeft: "1px solid rgba(255, 255, 255, 0.15)", paddingLeft: "20px" }}>
                <span style={{ fontSize: "9px", color: "rgba(255, 255, 255, 0.4)", textTransform: "uppercase", display: "block" }}>XLM</span>
                <span style={{ fontSize: "13px", fontWeight: "700", fontFamily: "var(--font-mono)", color: "#ffffff" }}>
                  {(shieldedBalances?.XLM || 0).toFixed(2)}
                </span>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <span style={{ fontSize: "9px", color: "rgba(255, 255, 255, 0.4)", textTransform: "uppercase", display: "block" }}>Account</span>
              <span style={{ fontSize: "11px", fontWeight: "600", color: "rgba(255, 255, 255, 0.8)", fontFamily: "var(--font-mono)" }}>
                @{userProfile?.username}
              </span>
            </div>
          </div>
        </div>

      </div>

      {/* Grid of quick action buttons for sending, receiving, and withdrawing */}
      <div className="action-grid" style={{ marginTop: "40px" }}>
        <button 
          onClick={() => { setDashboardAction("send"); setWalletAction(null); }} 
          className="action-tile"
        >
          <Send size={20} />
          <span>Send</span>
        </button>
        <button 
          onClick={() => { setDashboardAction("receive"); setWalletAction(null); }} 
          className="action-tile"
        >
          <Download size={20} />
          <span>Receive</span>
        </button>
        <button 
          onClick={() => { setWalletAction("out"); setDashboardAction(null); }} 
          className="action-tile"
        >
          <Coins size={20} />
          <span>Withdrawal</span>
        </button>
      </div>
    </div>
  );
}
