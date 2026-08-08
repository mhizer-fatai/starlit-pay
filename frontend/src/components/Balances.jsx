import React, { useState, useEffect, useRef } from "react";
import { Send, Download, Coins, Shield, Eye, EyeOff, ArrowDownUp, Zap, CheckCircle2, AlertCircle, Loader2, Clock } from "lucide-react";

export default function Balances({
  shieldedBalances,
  walletAction,
  setDashboardAction,
  setWalletAction,
  prices = { USDC: 1.00, XLM: 0.12 },
  userProfile,
  loadWalletData
}) {
  const [showBalance, setShowBalance] = useState(true);
  const [faucetState, setFaucetState] = useState("idle"); // "idle" | "receiving" | "success" | "error"
  const [faucetStatusText, setFaucetStatusText] = useState("");
  const [faucetErrorText, setFaucetErrorText] = useState("");
  
  // 4-Hour Cooldown remaining seconds state
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  const initialBalancesRef = useRef(null);
  const pollIntervalRef = useRef(null);

  const totalBalance = (shieldedBalances?.USDC || 0) * prices.USDC + (shieldedBalances?.XLM || 0) * prices.XLM;

  // Initialize and check 4-hour cooldown timer
  useEffect(() => {
    if (!userProfile?.id) return;

    const storageKey = `starlit_faucet_last_claim_${userProfile.id}`;
    const lastClaim = parseInt(localStorage.getItem(storageKey) || "0", 10);
    const COOLDOWN_SECONDS = 4 * 60 * 60; // 4 hours in seconds

    const nowSeconds = Math.floor(Date.now() / 1000);
    const elapsed = nowSeconds - lastClaim;

    if (lastClaim && elapsed < COOLDOWN_SECONDS) {
      setCooldownSeconds(COOLDOWN_SECONDS - elapsed);
    }

    // Also check backend status endpoint for IP / account cooldown sync
    const checkBackendStatus = async () => {
      try {
        if (!userProfile.public_encryption_key) return;
        const res = await fetch(`http://localhost:3001/api/faucet/status/${userProfile.public_encryption_key}`).catch(() => 
          fetch(`https://starlit-pay.onrender.com/api/faucet/status/${userProfile.public_encryption_key}`)
        );
        if (res && res.ok) {
          const data = await res.json();
          if (!data.canClaim && data.remainingMs > 0) {
            const sec = Math.ceil(data.remainingMs / 1000);
            setCooldownSeconds(sec);
          }
        }
      } catch (e) {}
    };

    checkBackendStatus();
  }, [userProfile?.id, userProfile?.public_encryption_key]);

  // Live 1-second countdown ticker
  useEffect(() => {
    if (cooldownSeconds <= 0) return;

    const timer = setInterval(() => {
      setCooldownSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [cooldownSeconds]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  // Monitor when balance actually updates to trigger the SUCCESS state
  useEffect(() => {
    if (faucetState === "receiving" && initialBalancesRef.current) {
      const currentUSDC = shieldedBalances?.USDC || 0;
      const currentXLM = shieldedBalances?.XLM || 0;
      const { usdc: initUSDC, xlm: initXLM } = initialBalancesRef.current;

      // If user balance has increased, funds have been successfully credited!
      if (currentUSDC > initUSDC || currentXLM > initXLM) {
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        setFaucetState("success");
        setFaucetStatusText("Funds Received! +100 XLM & +50 USDC successfully credited to your private balance.");
        
        // Start 4-Hour Cooldown (4 hours = 14,400 seconds)
        const fourHours = 4 * 60 * 60;
        setCooldownSeconds(fourHours);
        if (userProfile?.id) {
          localStorage.setItem(`starlit_faucet_last_claim_${userProfile.id}`, String(Math.floor(Date.now() / 1000)));
        }

        setTimeout(() => {
          setFaucetState("idle");
          setFaucetStatusText("");
        }, 8000);
      }
    }
  }, [shieldedBalances, faucetState, userProfile?.id]);

  // Format seconds to HH:MM:SS
  const formatCooldown = (totalSec) => {
    const hours = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    return `${hours.toString().padStart(2, "0")}h ${mins.toString().padStart(2, "0")}m ${secs.toString().padStart(2, "0")}s`;
  };

  const handleClaimFaucet = async () => {
    if (faucetState === "receiving" || cooldownSeconds > 0) return;

    // Record initial balance before requesting
    initialBalancesRef.current = {
      usdc: shieldedBalances?.USDC || 0,
      xlm: shieldedBalances?.XLM || 0
    };

    setFaucetState("receiving");
    setFaucetStatusText("Receiving funds... Auto-shielding 100 XLM & 50 USDC to your account on-chain.");
    setFaucetErrorText("");

    try {
      const payload = {
        depositMemo: userProfile?.deposit_memo,
        viewingKey: userProfile?.public_encryption_key,
        destinationAddress: userProfile?.stellar_address
      };

      let res;
      try {
        res = await fetch("http://localhost:3001/api/faucet/fund", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      } catch (e) {
        res = await fetch("https://starlit-pay.onrender.com/api/faucet/fund", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      }

      const data = await res.json().catch(() => ({}));

      if (res && res.ok && data.success) {
        // Broadcast succeeded! Start continuous background sync to credit user balance
        setFaucetStatusText("Receiving funds... Encrypting note and waiting for private balance credit.");
        
        let attempts = 0;
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        
        pollIntervalRef.current = setInterval(async () => {
          attempts++;
          if (loadWalletData) {
            await loadWalletData(true);
          }
          
          // Safety timeout after 45 seconds if gateway took longer
          if (attempts >= 22) {
            clearInterval(pollIntervalRef.current);
            setFaucetState("success");
            setFaucetStatusText("Funds Processed! +100 XLM & +50 USDC sent to your shielded account.");
            
            // Set 4-hour cooldown
            const fourHours = 4 * 60 * 60;
            setCooldownSeconds(fourHours);
            if (userProfile?.id) {
              localStorage.setItem(`starlit_faucet_last_claim_${userProfile.id}`, String(Math.floor(Date.now() / 1000)));
            }

            setTimeout(() => {
              setFaucetState("idle");
              setFaucetStatusText("");
            }, 8000);
          }
        }, 2000);

      } else {
        setFaucetState("error");
        
        if (data.cooldownActive || res?.status === 429) {
          const sec = data.remainingMs ? Math.ceil(data.remainingMs / 1000) : (4 * 3600);
          setCooldownSeconds(sec);
        }

        setFaucetErrorText(data.message || data.details || data.error || `Faucet request failed with status ${res?.status || "500"}`);
        setTimeout(() => {
          setFaucetState("idle");
          setFaucetErrorText("");
        }, 8000);
      }
    } catch (err) {
      console.error("Faucet error:", err);
      setFaucetState("error");
      setFaucetErrorText(err.message || "Failed to reach faucet network.");
      setTimeout(() => {
        setFaucetState("idle");
        setFaucetErrorText("");
      }, 8000);
    }
  };

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

        {/* 1-Click Testnet Faucet Banner with 4-Hour Anti-Spam Cooldown Timer */}
        <div style={{
          background: "linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(5, 150, 105, 0.05) 100%)",
          border: "1px solid rgba(16, 185, 129, 0.3)",
          borderRadius: "14px",
          padding: "16px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "16px"
        }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#10B981", fontWeight: "700", fontSize: "14px" }}>
              <Zap size={18} />
              <span>Testnet Faucet Available</span>
              {cooldownSeconds > 0 && (
                <span style={{
                  fontSize: "11px",
                  padding: "2px 8px",
                  borderRadius: "6px",
                  background: "rgba(234, 179, 8, 0.15)",
                  color: "#EAB308",
                  border: "1px solid rgba(234, 179, 8, 0.3)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px"
                }}>
                  <Clock size={11} />
                  <span>4h Anti-Spam Active</span>
                </span>
              )}
            </div>
            <div style={{ color: "var(--text-muted)", fontSize: "12px", marginTop: "2px" }}>
              {cooldownSeconds > 0 ? (
                <span>Next claim available in: <strong style={{ color: "#EAB308", fontFamily: "var(--font-mono)" }}>{formatCooldown(cooldownSeconds)}</strong></span>
              ) : (
                <span>Mint and auto-shield <strong style={{ color: "var(--text-primary)" }}>100 XLM & 50 USDC</strong> directly into your private balance.</span>
              )}
            </div>
          </div>

          <button
            onClick={handleClaimFaucet}
            disabled={faucetState === "receiving" || cooldownSeconds > 0}
            style={{
              padding: "10px 20px",
              borderRadius: "10px",
              background: cooldownSeconds > 0 
                ? "rgba(30, 41, 59, 0.8)" 
                : (faucetState === "receiving" ? "linear-gradient(135deg, #0d9488 0%, #0f766e 100%)" : "linear-gradient(135deg, #10B981 0%, #059669 100%)"),
              color: cooldownSeconds > 0 ? "var(--text-muted)" : "#FFFFFF",
              fontWeight: "700",
              fontSize: "13px",
              border: cooldownSeconds > 0 ? "1px solid var(--border-color)" : "none",
              cursor: (faucetState === "receiving" || cooldownSeconds > 0) ? "not-allowed" : "pointer",
              boxShadow: cooldownSeconds > 0 ? "none" : "0 4px 12px rgba(16, 185, 129, 0.3)",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              transition: "all 0.2s ease"
            }}
          >
            {faucetState === "receiving" ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                <span>Receiving...</span>
              </>
            ) : cooldownSeconds > 0 ? (
              <>
                <Clock size={15} color="#EAB308" />
                <span style={{ fontFamily: "var(--font-mono)" }}>{formatCooldown(cooldownSeconds)}</span>
              </>
            ) : (
              <>
                <Zap size={15} />
                <span>⚡ Claim +100 XLM & +50 USDC</span>
              </>
            )}
          </button>
        </div>

        {/* Receiving In-Progress Alert */}
        {faucetState === "receiving" && (
          <div style={{
            padding: "12px 18px",
            background: "rgba(59, 130, 246, 0.15)",
            border: "1px solid rgba(59, 130, 246, 0.4)",
            borderRadius: "12px",
            color: "#60A5FA",
            fontSize: "13px",
            fontWeight: "600",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            animation: "fadeIn 0.3s ease"
          }}>
            <Loader2 size={18} className="animate-spin" style={{ flexShrink: 0, color: "#60A5FA" }} />
            <span>{faucetStatusText}</span>
          </div>
        )}

        {/* Confirmed Balance Credited Success Alert */}
        {faucetState === "success" && (
          <div style={{
            padding: "12px 18px",
            background: "rgba(16, 185, 129, 0.15)",
            border: "1px solid rgba(16, 185, 129, 0.4)",
            borderRadius: "12px",
            color: "#10B981",
            fontSize: "13px",
            fontWeight: "600",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            animation: "fadeIn 0.3s ease"
          }}>
            <CheckCircle2 size={18} style={{ flexShrink: 0 }} />
            <span>{faucetStatusText}</span>
          </div>
        )}

        {/* Error Alert */}
        {faucetState === "error" && (
          <div style={{
            padding: "12px 18px",
            background: "rgba(239, 68, 68, 0.15)",
            border: "1px solid rgba(239, 68, 68, 0.4)",
            borderRadius: "12px",
            color: "#EF4444",
            fontSize: "13px",
            fontWeight: "600",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            animation: "fadeIn 0.3s ease"
          }}>
            <AlertCircle size={18} style={{ flexShrink: 0 }} />
            <span>{faucetErrorText}</span>
          </div>
        )}

      </div>

      {/* Grid of quick action buttons (Send, Receive, Swap, Withdraw) */}
      <div className="action-grid" style={{ marginTop: "28px", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px" }}>
        <button 
          onClick={() => { setDashboardAction("send"); setWalletAction(null); }} 
          className="action-tile active-primary"
          style={{
            background: "var(--primary-accent)",
            color: "#0b1326",
            border: "none",
            borderRadius: "16px",
            padding: "16px",
            height: "85px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
            fontWeight: "700",
            fontSize: "13px",
            cursor: "pointer"
          }}
        >
          <Send size={20} color="#0b1326" />
          <span style={{ fontWeight: "700" }}>Send</span>
        </button>
        <button 
          onClick={() => { setDashboardAction("receive"); setWalletAction(null); }} 
          className="action-tile"
          style={{
            background: "var(--card-bg)",
            border: "1px solid var(--border-color)",
            borderRadius: "16px",
            padding: "16px",
            height: "85px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
            color: "var(--text-primary)",
            fontWeight: "600",
            fontSize: "13px",
            cursor: "pointer"
          }}
        >
          <Download size={20} color="var(--primary-accent)" />
          <span style={{ color: "var(--primary-accent)", fontWeight: "700" }}>Receive</span>
        </button>
        <div style={{ position: "relative" }}>
          <button 
            onClick={() => { setDashboardAction("swap"); setWalletAction(null); }} 
            className="action-tile"
            style={{
              background: "var(--card-bg)",
              border: "1px solid var(--border-color)",
              borderRadius: "16px",
              padding: "16px",
              height: "85px",
              width: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              color: "var(--text-primary)",
              fontWeight: "600",
              fontSize: "13px",
              cursor: "pointer",
              position: "relative"
            }}
          >
            <span style={{
              position: "absolute",
              top: "-8px",
              right: "-4px",
              background: "linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)",
              color: "#FFFFFF",
              fontSize: "9px",
              fontWeight: "800",
              padding: "2px 7px",
              borderRadius: "10px",
              letterSpacing: "0.5px",
              textTransform: "uppercase",
              boxShadow: "0 2px 8px rgba(109, 40, 217, 0.4)",
              zIndex: 2
            }}>
              Soon
            </span>
            <ArrowDownUp size={20} color="var(--primary-accent)" />
            <span style={{ color: "var(--primary-accent)", fontWeight: "700" }}>Swap</span>
          </button>
        </div>
        <button 
          onClick={() => { setDashboardAction("withdraw"); setWalletAction(null); }} 
          className="action-tile"
          style={{
            background: "var(--card-bg)",
            border: "1px solid var(--border-color)",
            borderRadius: "16px",
            padding: "16px",
            height: "85px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
            color: "var(--text-primary)",
            fontWeight: "600",
            fontSize: "13px",
            cursor: "pointer"
          }}
        >
          <Coins size={20} color="var(--primary-accent)" />
          <span style={{ color: "var(--primary-accent)", fontWeight: "700" }}>Withdraw</span>
        </button>
      </div>
    </div>
  );
}
