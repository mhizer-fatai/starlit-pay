import React from "react";
import { Shield, Lock, User, Sun, Moon } from "lucide-react";

export default function Auth({
  authState,
  setAuthState,
  email,
  setEmail,
  pin,
  setPin,
  pinConfirm,
  setPinConfirm,
  username,
  setUsername,
  userProfile,
  loading,
  feedback,
  handleEmailSubmit,
  handleGoogleLogin,
  handlePinSetup,
  handleRegisterProfile,
  handlePinSubmit,
  handleLogout,
  theme,
  toggleTheme,
  logo,
  symbol
}) {

  const renderContent = () => {
    // Render login screen for non-authenticated session state
    if (authState === "logged-out") {
      return (
        <div className="container" style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "80vh" }}>
          <div className="glass-panel" style={{ width: "100%", maxWidth: "400px", padding: "32px" }}>
            <div style={{ textAlign: "center", marginBottom: "24px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", marginBottom: "16px" }}>
                <img src={symbol} alt="Starlit Pay Logo" style={{ height: "48px", width: "auto" }} />
                <span style={{ fontSize: "28px", fontWeight: "800", color: "var(--text-primary)" }}>Starlit Pay</span>
              </div>
              <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>Fast, simple payments with default privacy</p>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <button 
                type="button" 
                onClick={handleGoogleLogin} 
                className="btn-primary" 
                disabled={loading}
                style={{ width: "100%", padding: "14px", display: "flex", alignItems: "center", justifyContent: "center", gap: "10px" }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#ffffff"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#ffffff" fillOpacity="0.85"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#ffffff" fillOpacity="0.85"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#ffffff" fillOpacity="0.9"/>
                </svg>
                Log in with Google
              </button>

              <div style={{ display: "flex", alignItems: "center", margin: "8px 0" }}>
                <hr style={{ flex: 1, border: "none", borderTop: "1px solid var(--border-color)" }} />
                <span style={{ padding: "0 10px", fontSize: "11px", color: "var(--text-muted)" }}>OR</span>
                <hr style={{ flex: 1, border: "none", borderTop: "1px solid var(--border-color)" }} />
              </div>

              <div style={{ opacity: 0.5 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <label style={{ fontSize: "13px", color: "var(--text-muted)", margin: 0 }}>Log in with Email</label>
                  <span style={{ fontSize: "9px", fontWeight: "700", color: "var(--primary-accent)", background: "rgba(124, 58, 237, 0.15)", padding: "2px 6px", borderRadius: "6px" }}>COMING SOON</span>
                </div>
                <input 
                  type="email" 
                  placeholder="email@example.com" 
                  disabled
                  style={{ cursor: "not-allowed", background: "rgba(255, 255, 255, 0.02)" }}
                />
                <button type="button" className="btn-secondary" disabled style={{ width: "100%", marginTop: "12px", cursor: "not-allowed" }}>
                  Continue
                </button>
              </div>
            </div>

            <button type="button" onClick={() => setAuthState("landing")} className="btn-secondary" style={{ marginTop: "16px", width: "100%", padding: "12px", fontSize: "14px" }}>
              Back to Home
            </button>
          </div>
        </div>
      );
    }

    // Render setup payment PIN screen
    if (authState === "pin-setup") {
      return (
        <div className="container" style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "80vh" }}>
          <div className="glass-panel" style={{ width: "100%", maxWidth: "400px", padding: "32px" }}>
            <div style={{ textAlign: "center", marginBottom: "24px" }}>
              <Lock size={32} style={{ color: "var(--secondary-accent)", marginBottom: "12px" }} />
              <h2 style={{ fontSize: "20px", fontWeight: "600" }}>Setup Payment PIN</h2>
              <p style={{ color: "var(--text-muted)", fontSize: "14px", marginTop: "4px" }}>Create a 6-digit PIN to secure your wallet keys</p>
            </div>

            <form onSubmit={handlePinSetup} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <input
                type="password"
                maxLength={6}
                placeholder="Enter 6-digit PIN"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                required
                style={{ textAlign: "center", letterSpacing: "8px", fontSize: "20px" }}
              />
              <input
                type="password"
                maxLength={6}
                placeholder="Confirm 6-digit PIN"
                value={pinConfirm}
                onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, ""))}
                required
                style={{ textAlign: "center", letterSpacing: "8px", fontSize: "20px" }}
              />
              <button type="submit" className="btn-primary">
                Continue Setup
              </button>
            </form>

            <button type="button" onClick={() => setAuthState("landing")} className="btn-secondary" style={{ marginTop: "16px", width: "100%", padding: "12px", fontSize: "14px" }}>
              Back to Home
            </button>
          </div>
        </div>
      );
    }

    // Render profile registration screen with customizable username and key PIN setup
    if (authState === "register-profile") {
      return (
        <div className="container" style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "80vh" }}>
          <div className="glass-panel" style={{ width: "100%", maxWidth: "400px", padding: "32px" }}>
            <div style={{ textAlign: "center", marginBottom: "24px" }}>
              <User size={32} style={{ color: "var(--primary-accent)", marginBottom: "12px" }} />
              <h2 style={{ fontSize: "20px", fontWeight: "600" }}>Choose Username</h2>
              <p style={{ color: "var(--text-muted)", fontSize: "14px", marginTop: "4px" }}>Register a username for receiving payments</p>
            </div>

            {feedback.message && (
              <div style={{
                padding: "12px 16px",
                borderRadius: "8px",
                marginBottom: "16px",
                background: feedback.type === "error" ? "rgba(255,59,48,0.1)" : "rgba(0,200,83,0.1)",
                border: `1px solid ${feedback.type === "error" ? "rgba(255,59,48,0.2)" : "rgba(0,200,83,0.2)"}`,
                color: feedback.type === "error" ? "#FF453A" : "var(--primary-accent)",
                fontSize: "13px"
              }}>
                {feedback.message}
              </div>
            )}

            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "13px", color: "var(--text-muted)", marginBottom: "8px" }}>Set a 6-digit Payment PIN</label>
              <input
                type="password"
                maxLength={6}
                placeholder="Enter 6-digit PIN"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                style={{ textAlign: "center", letterSpacing: "8px", fontSize: "20px", marginBottom: "12px" }}
              />
              <input
                type="password"
                maxLength={6}
                placeholder="Confirm PIN"
                value={pinConfirm}
                onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, ""))}
                style={{ textAlign: "center", letterSpacing: "8px", fontSize: "20px" }}
              />
            </div>

            <form onSubmit={handleRegisterProfile} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <input
                type="text"
                placeholder="Username (e.g. alice)"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ""))}
                required
              />
              <button type="submit" className="btn-primary" disabled={loading}>
                {loading ? "Registering..." : "Create Account"}
              </button>
            </form>

            <button type="button" onClick={() => setAuthState("landing")} className="btn-secondary" style={{ marginTop: "16px", width: "100%", padding: "12px", fontSize: "14px" }}>
              Back to Home
            </button>
          </div>
        </div>
      );
    }

    // Render enter PIN lockscreen to unlock viewing and spending keys
    if (authState === "pin-entry") {
      return (
        <div className="container" style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "80vh" }}>
          <div className="glass-panel" style={{ width: "100%", maxWidth: "400px", padding: "32px" }}>
            <div style={{ textAlign: "center", marginBottom: "24px" }}>
              <Lock size={32} style={{ color: "var(--primary-accent)", marginBottom: "12px" }} />
              <h2 style={{ fontSize: "20px", fontWeight: "600" }}>Unlock Wallet</h2>
              <p style={{ color: "var(--text-muted)", fontSize: "14px", marginTop: "4px" }}>
                Enter payment PIN for <span style={{ color: "var(--text-primary)", fontWeight: "600" }}>@{userProfile?.username || "Google User"}</span>
              </p>
            </div>

            {feedback.message && (
              <div style={{
                padding: "12px 16px",
                borderRadius: "8px",
                marginBottom: "16px",
                background: feedback.type === "error" ? "rgba(255,59,48,0.1)" : "rgba(0,200,83,0.1)",
                border: `1px solid ${feedback.type === "error" ? "rgba(255,59,48,0.2)" : "rgba(0,200,83,0.2)"}`,
                color: feedback.type === "error" ? "#FF453A" : "var(--primary-accent)",
                fontSize: "13px",
                textAlign: "center"
              }}>
                {feedback.message}
              </div>
            )}

            <form onSubmit={handlePinSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <input
                type="password"
                maxLength={6}
                placeholder="******"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                required
                style={{ textAlign: "center", letterSpacing: "8px", fontSize: "24px" }}
              />
              <button type="submit" className="btn-primary" disabled={loading}>
                {loading ? "Decrypting..." : "Unlock"}
              </button>
              <button type="button" onClick={handleLogout} className="btn-secondary" style={{ padding: "10px" }}>
                Switch Account
              </button>
            </form>

            <button type="button" onClick={() => setAuthState("landing")} className="btn-secondary" style={{ marginTop: "16px", width: "100%", padding: "12px", fontSize: "14px" }}>
              Back to Home
            </button>
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <div style={{ position: "relative", minHeight: "100vh", width: "100%", display: "flex", flexDirection: "column" }}>
      {/* Floating Theme Toggle in Auth View */}
      <div style={{ position: "fixed", top: "24px", right: "24px", zIndex: 1000 }}>
        <button
          onClick={toggleTheme}
          className="theme-toggle-btn"
          aria-label="Toggle Theme"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--text-primary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "8px",
            borderRadius: "50%",
            backgroundColor: "var(--card-bg)",
            border: "1px solid var(--border-color)",
            width: "40px",
            height: "40px",
            transition: "all 0.2s ease"
          }}
        >
          {theme === "light" ? <Sun size={20} /> : <Moon size={20} />}
        </button>
      </div>
      {renderContent()}
    </div>
  );
}
