import React from "react";
import { Coins, Link as LinkIcon, FileText, Download, LogOut, Sun, Moon } from "lucide-react";

export default function Sidebar({
  currentTab,
  setCurrentTab,
  userProfile,
  deferredPrompt,
  handleInstallApp,
  handleLogout,
  setMobileTab,
  theme,
  toggleTheme,
  profilePic,
  onProfilePicClick,
  logo,
  symbol
}) {
  return (
    <aside className="sidebar">
      {/* App Logo */}
      <div style={{ marginBottom: "32px", paddingLeft: "8px", display: "flex", alignItems: "center", gap: "10px" }}>
        <img src={symbol} alt="Starlit Pay Logo" style={{ height: "28px", width: "auto" }} />
        <span style={{ fontSize: "20px", fontWeight: "700", color: "var(--text-primary)" }}>Starlit Pay</span>
      </div>
      {/* User profile section at the top of the sidebar */}
      <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "40px" }}>
        <div 
          onClick={onProfilePicClick}
          className="sidebar-avatar-container"
          style={{
            width: "48px",
            height: "48px",
            borderRadius: "50%",
            background: "var(--primary-accent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: "700",
            fontSize: "18px",
            color: "#FFFFFF",
            cursor: "pointer",
            position: "relative",
            overflow: "hidden"
          }}
        >
          {profilePic ? (
            <img 
              src={profilePic} 
              alt="Profile" 
              style={{ width: "100%", height: "100%", objectFit: "cover" }} 
            />
          ) : (
            userProfile?.username?.substring(0, 2).toUpperCase() || "SP"
          )}
          <div 
            className="sidebar-avatar-overlay"
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(0, 0, 0, 0.4)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              opacity: 0,
              transition: "opacity 0.2s ease",
              fontSize: "10px",
              fontWeight: "600",
              color: "#ffffff"
            }}
          >
            EDIT
          </div>
        </div>
        <div>
          <h2 style={{ fontSize: "16px", fontWeight: "700", color: "var(--text-primary)" }}>
            {userProfile?.display_name || userProfile?.username}
          </h2>
          <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>@{userProfile?.username}</span>
        </div>
      </div>

      {/* Navigation buttons to switch between Dashboard, Links and Statements views */}
      <nav className="sidebar-nav">
        <button onClick={() => { setCurrentTab("home"); if (setMobileTab) setMobileTab("wallet"); }} className={`sidebar-btn ${currentTab === "home" ? "active" : ""}`}>
          <Coins size={18} />
          <span>Dashboard</span>
        </button>
        <button onClick={() => setCurrentTab("pay-links")} className={`sidebar-btn ${currentTab === "pay-links" ? "active" : ""}`}>
          <LinkIcon size={18} />
          <span>Links</span>
        </button>
      </nav>

      {/* Action buttons at the bottom for App installation, Theme toggle and Logging out */}
      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: "12px" }}>
        <button onClick={toggleTheme} className="sidebar-btn" style={{ cursor: "pointer" }}>
          {theme === "light" ? <Sun size={18} /> : <Moon size={18} />}
          <span>{theme === "light" ? "Light Mode" : "Dark Mode"}</span>
        </button>
        {deferredPrompt && (
          <button onClick={handleInstallApp} className="sidebar-btn" style={{ color: "var(--primary-accent)" }}>
            <Download size={18} />
            <span>Install App</span>
          </button>
        )}
        <button onClick={handleLogout} className="sidebar-btn" style={{ color: "var(--error-color)" }}>
          <LogOut size={18} />
          <span>Log Out</span>
        </button>
      </div>
    </aside>
  );
}
