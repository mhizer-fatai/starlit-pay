import React, { useState, useEffect } from "react";
import { ArrowDownUp, X, RefreshCw, CheckCircle, Shield, AlertCircle } from "lucide-react";

export default function Swap({ shieldedBalances, prices, onClose, onExecuteSwap, theme }) {
  const [fromAsset, setFromAsset] = useState("XLM");
  const [toAsset, setToAsset] = useState("USDC");
  const [fromAmount, setFromAmount] = useState("");
  const [toAmount, setToAmount] = useState("");
  const [slippage, setSlippage] = useState("0.5");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const xlmPrice = prices?.XLM || 0.1739;

  // Calculate conversion rate
  const rate = fromAsset === "XLM" ? xlmPrice : (1 / xlmPrice);

  // Update output whenever input or direction changes
  useEffect(() => {
    if (!fromAmount || isNaN(fromAmount) || parseFloat(fromAmount) <= 0) {
      setToAmount("");
      return;
    }
    const val = parseFloat(fromAmount);
    const calculated = val * rate;
    setToAmount(calculated.toFixed(4));
  }, [fromAmount, fromAsset, toAsset, rate]);

  const handleFlipAssets = () => {
    setFromAsset(toAsset);
    setToAsset(fromAsset);
    setFromAmount("");
    setToAmount("");
    setError("");
  };

  const handleMaxAmount = () => {
    const maxBal = shieldedBalances?.[fromAsset] || 0;
    setFromAmount(maxBal.toString());
  };

  const handleConfirmSwap = async () => {
    setError("");
    if (!fromAmount || isNaN(fromAmount) || parseFloat(fromAmount) <= 0) {
      setError("Please enter a valid swap amount");
      return;
    }

    const available = shieldedBalances?.[fromAsset] || 0;
    if (parseFloat(fromAmount) > available) {
      setError(`Insufficient ${fromAsset} balance (${available} available)`);
      return;
    }

    setLoading(true);
    try {
      await onExecuteSwap({
        fromAsset,
        toAsset,
        fromAmount: parseFloat(fromAmount),
        toAmount: parseFloat(toAmount),
        rate,
        slippage: parseFloat(slippage)
      });
      onClose();
    } catch (err) {
      console.error("Swap error:", err);
      setError(err.message || "Swap failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0, 0, 0, 0.75)",
      backdropFilter: "blur(8px)",
      WebkitBackdropFilter: "blur(8px)",
      zIndex: 3000,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "16px"
    }}>
      <div 
        className="glass-panel" 
        onClick={(e) => e.stopPropagation()} 
        style={{
          width: "100%",
          maxWidth: "440px",
          background: "var(--card-bg)",
          borderRadius: "24px",
          border: "1px solid var(--border-color)",
          padding: "24px",
          boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
          display: "flex",
          flexDirection: "column",
          gap: "20px"
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{
              width: "36px",
              height: "36px",
              borderRadius: "10px",
              background: "rgba(16, 185, 129, 0.12)",
              border: "1px solid rgba(16, 185, 129, 0.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--primary-accent)"
            }}>
              <ArrowDownUp size={20} />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <h3 style={{ fontSize: "18px", fontWeight: "700", color: "var(--text-primary)", margin: 0 }}>
                  Private Asset Swap
                </h3>
                <span style={{
                  background: "linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)",
                  color: "#FFFFFF",
                  fontSize: "9px",
                  fontWeight: "800",
                  padding: "2px 7px",
                  borderRadius: "10px",
                  letterSpacing: "0.5px",
                  textTransform: "uppercase",
                  boxShadow: "0 2px 8px rgba(109, 40, 217, 0.4)"
                }}>
                  Coming Soon
                </span>
              </div>
              <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Instant XLM ↔ USDC Exchange</span>
            </div>
          </div>
          <button 
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              padding: "4px",
              borderRadius: "8px"
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Error Alert */}
        {error && (
          <div style={{
            background: "rgba(239, 68, 68, 0.12)",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            color: "var(--error-color)",
            padding: "10px 14px",
            borderRadius: "12px",
            fontSize: "13px",
            display: "flex",
            alignItems: "center",
            gap: "8px"
          }}>
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        {/* Swap Form Card Container */}
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", position: "relative" }}>
          
          {/* FROM ASSET BOX */}
          <div style={{
            background: "var(--input-bg)",
            border: "1px solid var(--border-color)",
            borderRadius: "16px",
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            gap: "8px"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "var(--text-muted)" }}>
              <span>You Pay</span>
              <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                <span>Balance: {shieldedBalances?.[fromAsset] || 0} {fromAsset}</span>
                <button 
                  onClick={handleMaxAmount}
                  style={{
                    background: "rgba(16, 185, 129, 0.15)",
                    border: "none",
                    color: "var(--primary-accent)",
                    fontSize: "10px",
                    fontWeight: "800",
                    padding: "2px 6px",
                    borderRadius: "4px",
                    cursor: "pointer"
                  }}
                >
                  MAX
                </button>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
              <input 
                type="number" 
                placeholder="0.00" 
                value={fromAmount}
                onChange={(e) => setFromAmount(e.target.value)}
                style={{
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  fontSize: "24px",
                  fontWeight: "700",
                  color: "var(--text-primary)",
                  width: "100%"
                }}
              />
              <span style={{
                background: "var(--card-bg)",
                border: "1px solid var(--border-color)",
                padding: "8px 14px",
                borderRadius: "12px",
                fontSize: "14px",
                fontWeight: "700",
                color: "var(--text-primary)",
                whiteSpace: "nowrap"
              }}>
                {fromAsset}
              </span>
            </div>
          </div>

          {/* REVERSE ARROW BUTTON */}
          <div style={{
            display: "flex",
            justifyContent: "center",
            margin: "-18px 0",
            zIndex: 10
          }}>
            <button 
              onClick={handleFlipAssets}
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "50%",
                background: "var(--card-bg)",
                border: "2px solid var(--border-color)",
                color: "var(--primary-accent)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
                transition: "transform 0.2s ease"
              }}
              className="hover-highlight-btn"
            >
              <ArrowDownUp size={16} />
            </button>
          </div>

          {/* TO ASSET BOX */}
          <div style={{
            background: "var(--input-bg)",
            border: "1px solid var(--border-color)",
            borderRadius: "16px",
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            gap: "8px"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "var(--text-muted)" }}>
              <span>You Receive (Estimated)</span>
              <span>Balance: {shieldedBalances?.[toAsset] || 0} {toAsset}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
              <input 
                type="number" 
                placeholder="0.00" 
                value={toAmount}
                readOnly
                style={{
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  fontSize: "24px",
                  fontWeight: "700",
                  color: "var(--primary-accent)",
                  width: "100%"
                }}
              />
              <span style={{
                background: "var(--card-bg)",
                border: "1px solid var(--border-color)",
                padding: "8px 14px",
                borderRadius: "12px",
                fontSize: "14px",
                fontWeight: "700",
                color: "var(--text-primary)",
                whiteSpace: "nowrap"
              }}>
                {toAsset}
              </span>
            </div>
          </div>

        </div>

        {/* Exchange Rate & Slippage Settings */}
        <div style={{
          background: "rgba(255, 255, 255, 0.02)",
          border: "1px solid var(--border-color)",
          borderRadius: "14px",
          padding: "12px 14px",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          fontSize: "12px"
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-muted)" }}>
            <span>Exchange Rate</span>
            <span style={{ color: "var(--text-primary)", fontWeight: "600" }}>
              1 {fromAsset} = {rate.toFixed(4)} {toAsset}
            </span>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", color: "var(--text-muted)" }}>
            <span>Slippage Tolerance</span>
            <div style={{ display: "flex", gap: "6px" }}>
              {["0.1", "0.5", "1.0"].map((s) => (
                <button
                  key={s}
                  onClick={() => setSlippage(s)}
                  style={{
                    background: slippage === s ? "var(--primary-accent)" : "var(--input-bg)",
                    color: slippage === s ? "#FFFFFF" : "var(--text-muted)",
                    border: "1px solid var(--border-color)",
                    padding: "3px 8px",
                    borderRadius: "6px",
                    fontSize: "10px",
                    fontWeight: "700",
                    cursor: "pointer"
                  }}
                >
                  {s}%
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Submit Swap Button */}
        <button 
          onClick={handleConfirmSwap}
          disabled={true}
          className="btn-primary"
          style={{
            width: "100%",
            padding: "14px",
            borderRadius: "14px",
            fontSize: "15px",
            fontWeight: "700",
            cursor: "not-allowed",
            opacity: 0.65,
            background: "linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)",
            border: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px"
          }}
        >
          <ArrowDownUp size={18} />
          <span>Swap Feature Coming Soon</span>
        </button>

        {/* Security Notice */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", fontSize: "11px", color: "var(--text-muted)" }}>
          <Shield size={12} style={{ color: "var(--primary-accent)" }} />
          <span>Private swap executed inside Soroban shielded pool</span>
        </div>
      </div>
    </div>
  );
}
