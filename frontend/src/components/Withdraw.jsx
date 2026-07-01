import React from "react";

export default function Withdraw({
  withdrawRecipient,
  setWithdrawRecipient,
  selectedAsset,
  setSelectedAsset,
  depositAmount,
  setDepositAmount,
  shieldedBalances,
  handleCashOut,
  setWalletAction
}) {
  return (
    <form onSubmit={handleCashOut} className="glass-panel" style={{ padding: "24px", marginBottom: "20px" }}>
      {/* Title indicating the form action is withdrawal to a Stellar External Owner Account */}
      <h3 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "12px" }}>Withdraw (Stellar EOA)</h3>
      
      {/* Displays the currently selected asset's available shielded balance */}
      <span style={{ fontSize: "13px", color: "var(--text-muted)", display: "block", marginBottom: "16px" }}>
        Available Private Balance: {shieldedBalances[selectedAsset]?.toFixed(2) || "0.00"} {selectedAsset}
      </span>
      
      <div style={{ marginBottom: "16px" }}>
        {/* Recipient Stellar public key field */}
        <label style={{ display: "block", fontSize: "12px", color: "var(--text-muted)", marginBottom: "6px" }}>Stellar Recipient Address (EOA)</label>
        <input 
          type="text" 
          placeholder="Stellar public key starting with G" 
          value={withdrawRecipient} 
          onChange={(e) => setWithdrawRecipient(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} 
          required 
          style={{ marginTop: "4px", marginBottom: "14px" }}
        />
        
        {/* Asset selection option dropdown */}
        <label style={{ display: "block", fontSize: "12px", color: "var(--text-muted)", marginBottom: "6px" }}>Select Asset</label>
        <select value={selectedAsset} onChange={(e) => setSelectedAsset(e.target.value)} style={{ padding: "10px 14px", fontSize: "14px", marginTop: "4px", marginBottom: "14px" }}>
          <option value="USDC">USDC</option>
          <option value="XLM">XLM</option>
        </select>
        
        {/* Input for the amount to withdraw */}
        <label style={{ display: "block", fontSize: "12px", color: "var(--text-muted)", marginBottom: "6px" }}>Amount to Withdraw</label>
        <input 
          type="number" 
          step="0.01" 
          placeholder="0.00" 
          value={depositAmount} 
          onChange={(e) => setDepositAmount(e.target.value)} 
          required 
          style={{ marginTop: "4px" }}
        />
      </div>
      
      {/* Form action buttons to submit or cancel the transaction */}
      <div style={{ display: "flex", gap: "12px" }}>
        <button type="submit" className="btn-primary" style={{ flex: 1, padding: "14px" }} disabled={shieldedBalances[selectedAsset] <= 0}>Confirm</button>
        <button type="button" onClick={() => { setWalletAction(null); setWithdrawRecipient(""); }} className="btn-secondary" style={{ flex: 1, padding: "14px" }}>Cancel</button>
      </div>
    </form>
  );
}
