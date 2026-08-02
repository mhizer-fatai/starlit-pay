import React, { useState } from "react";
import { Send, Download, Coins, Shield, Eye, EyeOff } from "lucide-react";

export default function Balances({
  shieldedBalances,
  walletAction,
  setDashboardAction,
  setWalletAction,
  prices = { USDC: 1.00, XLM: 0.12 },
  userProfile
}) {
  const [showBalance, setShowBalance] = useState(true);
  const totalBalance = (shieldedBalances?.USDC || 0) * prices.USDC + (shieldedBalances?.XLM || 0) * prices.XLM;

  return (
    <div style={{ flexGrow: 1, display: "flex", flexDirection: "column" }}>

      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        
        {/* Shielded Balance Card */}
        <div className="premium-card balance-card" style={{ 
          minHeight: "180px",
          padding: "24px 28px",
          borderRadius: "16px",
          position: "relative",
          overflow: "hidden"
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", width: "100%", position: "relative", zIndex: 10 }}>
            <span style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "1px", color: "var(--text-muted)", textTransform: "uppercase" }}>Private Balance</span>
          </div>
          
          <div style={{ margin: "20px 0", display: "flex", alignItems: "center", gap: "12px", position: "relative", zIndex: 10 }}>
            <h2 className="balance-amount" style={{ fontSize: "36px", fontWeight: "800", fontFamily: "var(--font-sans)", letterSpacing: "-1px" }}>
              {showBalance ? (
                `$${totalBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              ) : (
                "••••••"
              )}
              <span style={{ fontSize: "18px", marginLeft: "8px", color: "var(--primary-accent)", fontWeight: "700" }}>USDC</span>
            </h2>
            
            <button 
              onClick={() => setShowBalance(!showBalance)}
              aria-label="Toggle Balance Visibility" 
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--text-muted)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "4px",
                transition: "color 0.2s ease"
              }}
              className="hover-highlight-btn"
            >
              {showBalance ? <Eye size={18} /> : <EyeOff size={18} />}
            </button>
          </div>
          
          {/* Underlying Asset Wallet Cards (USDC & XLM) */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginTop: "24px", position: "relative", zIndex: 10 }}>
            {/* USDC Wallet Card */}
            <div className="wallet-card-tile" style={{
              borderRadius: "14px",
              padding: "16px 20px",
              display: "flex",
              flexDirection: "column",
              position: "relative"
            }}>
              <span style={{ fontSize: "11px", fontWeight: "700", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                USDC WALLET
              </span>
              <div className="wallet-amount" style={{ fontSize: "22px", fontWeight: "800", marginTop: "6px", fontFamily: "var(--font-mono)" }}>
                {showBalance ? `$${(shieldedBalances?.USDC || 0).toFixed(2)}` : "••••••"}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", marginTop: "4px" }}>
                <span style={{ fontSize: "11px", fontWeight: "600", color: "var(--primary-accent)", fontFamily: "var(--font-mono)" }}>
                  1 USDC = ${(prices?.USDC || 1.00).toFixed(2)}
                </span>
              </div>
            </div>

            {/* XLM Wallet Card */}
            <div className="wallet-card-tile" style={{
              borderRadius: "14px",
              padding: "16px 20px",
              display: "flex",
              flexDirection: "column",
              position: "relative"
            }}>
              <span style={{ fontSize: "11px", fontWeight: "700", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                XLM WALLET
              </span>
              <div className="wallet-amount" style={{ fontSize: "22px", fontWeight: "800", marginTop: "6px", fontFamily: "var(--font-mono)" }}>
                {showBalance ? `${(shieldedBalances?.XLM || 0).toFixed(2)}` : "••••••"}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", marginTop: "4px" }}>
                <span style={{ fontSize: "11px", fontWeight: "600", color: "var(--primary-accent)", fontFamily: "var(--font-mono)" }}>
                  1 XLM = ${(prices?.XLM || 0.1718).toFixed(4)}
                </span>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* Grid of quick action buttons styled like user screenshot */}
      <div className="action-grid" style={{ marginTop: "28px", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}>
        <button 
          onClick={() => { setDashboardAction("send"); setWalletAction(null); }} 
          className="action-tile active-primary"
          style={{
            background: "var(--primary-accent)",
            color: "#0b1326",
            border: "none",
            borderRadius: "16px",
            padding: "20px",
            height: "90px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            fontWeight: "700",
            fontSize: "14px",
            cursor: "pointer"
          }}
        >
          <Send size={22} color="#0b1326" />
          <span style={{ fontWeight: "700" }}>Send</span>
        </button>
        <button 
          onClick={() => { setDashboardAction("receive"); setWalletAction(null); }} 
          className="action-tile"
          style={{
            background: "var(--card-bg)",
            border: "1px solid var(--border-color)",
            color: "var(--primary-accent)",
            borderRadius: "16px",
            padding: "20px",
            height: "90px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            fontWeight: "700",
            fontSize: "14px",
            cursor: "pointer"
          }}
        >
          <Download size={22} color="var(--primary-accent)" />
          <span style={{ color: "var(--primary-accent)", fontWeight: "600" }}>Receive</span>
        </button>
        <button 
          onClick={() => { setWalletAction("out"); setDashboardAction(null); }} 
          className="action-tile"
          style={{
            background: "var(--card-bg)",
            border: "1px solid var(--border-color)",
            color: "var(--primary-accent)",
            borderRadius: "16px",
            padding: "20px",
            height: "90px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            fontWeight: "700",
            fontSize: "14px",
            cursor: "pointer"
          }}
        >
          <Coins size={22} color="var(--primary-accent)" />
          <span style={{ color: "var(--primary-accent)", fontWeight: "600" }}>Withdraw</span>
        </button>
      </div>
    </div>
  );
}
