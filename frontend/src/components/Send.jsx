import React from "react";

export default function Send({
  sendRecipient,
  setSendRecipient,
  sendAmount,
  setSendAmount,
  selectedAsset,
  setSelectedAsset,
  loading,
  shieldedBalances,
  contacts,
  handleSendSubmit,
  prices = { USDC: 1.00, XLM: 0.12 }
}) {
  const amountNum = parseFloat(sendAmount) || 0;
  let equivalentText = "";
  if (amountNum > 0) {
    if (selectedAsset === "XLM") {
      const usdcEquiv = amountNum * prices.XLM;
      equivalentText = `≈ $${usdcEquiv.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`;
    } else if (selectedAsset === "USDC") {
      const xlmEquiv = amountNum / prices.XLM;
      equivalentText = `≈ ${xlmEquiv.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} XLM`;
    }
  }
  return (
    <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
      {/* Title banner for the private payment sending action */}
      <h3 style={{ fontSize: "18px", fontWeight: "700", marginBottom: "16px", color: "#ffffff" }}>Send Private Payment</h3>
      
      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        <div>
          {/* Recipient user profile query field */}
          <label style={{ display: "block", fontSize: "13px", color: "var(--text-muted)", marginBottom: "8px" }}>Recipient Username</label>
          <input 
            type="text" 
            placeholder="Recipient Starlit username" 
            value={sendRecipient} 
            onChange={(e) => setSendRecipient(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ""))} 
            style={{ padding: "14px", fontSize: "15px", width: "100%" }}
          />
        </div>

        <div>
          {/* Select dropdown indicating which private asset to send */}
          <label style={{ display: "block", fontSize: "13px", color: "var(--text-muted)", marginBottom: "8px" }}>Asset</label>
          <select value={selectedAsset} onChange={(e) => setSelectedAsset(e.target.value)} style={{ padding: "14px", fontSize: "15px" }}>
            <option value="USDC">USDC</option>
            <option value="XLM">XLM</option>
          </select>
        </div>

        <div>
          {/* Amount input block with validation to limit digits */}
          <label style={{ display: "block", fontSize: "13px", color: "var(--text-muted)", marginBottom: "8px" }}>Amount</label>
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: "16px", top: "50%", transform: "translateY(-50%)", fontSize: "24px", fontWeight: "700", color: "var(--text-muted)" }}>
              {selectedAsset === "XLM" ? "" : "$"}
            </span>
            <input 
              type="text" 
              placeholder="0.00" 
              value={sendAmount} 
              onChange={(e) => {
                const val = e.target.value.replace(/[^0-9.]/g, "");
                const parts = val.split(".");
                if (parts.length > 2) return;
                if (parts[1] && parts[1].length > 2) return;
                setSendAmount(val);
              }} 
              style={{ padding: "16px 16px 16px 36px", fontSize: "24px", fontWeight: "700", textAlign: "center", width: "100%" }}
            />
          </div>
          {equivalentText && (
            <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "6px", textAlign: "right", fontWeight: "600", fontFamily: "var(--font-mono)" }}>
              {equivalentText}
            </div>
          )}
        </div>
      </div>

      {/* Main submission button initiating ZK transfer proof generation */}
      <button 
        onClick={handleSendSubmit} 
        className="btn-primary" 
        style={{ width: "100%", marginTop: "24px" }}
        disabled={!sendRecipient || parseFloat(sendAmount || 0) <= 0 || (shieldedBalances[selectedAsset] || 0) < parseFloat(sendAmount) || loading}
      >
        {loading ? "Processing..." : `Send ${sendAmount || "0"} ${selectedAsset}`}
      </button>

      {/* Renders horizontal scroll of frequently used contact shortcuts */}
      <div style={{ marginTop: "24px" }}>
        <span style={{ fontSize: "13px", fontWeight: "600", color: "var(--text-muted)", display: "block", marginBottom: "12px" }}>Top Contacts</span>
        <div className="contact-list">
          {contacts.map((contact, idx) => (
            <div 
              key={idx} 
              className="contact-item" 
              onClick={() => setSendRecipient(contact.username)}
            >
              <div className="contact-avatar">
                {contact.display_name?.substring(0, 2).toUpperCase() || contact.username.substring(0, 2).toUpperCase()}
              </div>
              <div className="contact-name">{contact.display_name || contact.username}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
