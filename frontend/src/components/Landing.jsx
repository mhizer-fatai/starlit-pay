import React, { useEffect, useRef } from "react";
import { Shield, ArrowRight, Activity, Cpu, Sun, Moon } from "lucide-react";

export default function Landing({ scrollY, setAuthState, theme, toggleTheme, logo, symbol }) {
  const observerRef = useRef(null);

  useEffect(() => {
    const options = {
      root: null,
      rootMargin: "0px",
      threshold: 0.1,
    };

    const handleIntersect = (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
        } else {
          entry.target.classList.remove("is-visible");
        }
      });
    };

    const observer = new IntersectionObserver(handleIntersect, options);
    observerRef.current = observer;

    const animatedElements = document.querySelectorAll(".animate-on-scroll");
    animatedElements.forEach((el) => observer.observe(el));

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, []);
  return (
    <div className="landing-page-root">
      {/* Background parallax grid patterns that slide during page scroll */}
      <div className="landing-grid-pattern" style={{ transform: `translate3d(0, ${scrollY * -0.05}px, 0)` }} />
      
      {/* Dynamic blurred radial background glow objects */}
      <div 
        className="landing-bg-glow" 
        style={{ 
          top: "10%", 
          left: "15%", 
          width: "400px", 
          height: "400px", 
          background: "var(--primary-accent)",
          transform: `translate3d(0, ${scrollY * 0.15}px, 0)` 
        }} 
      />
      <div 
        className="landing-bg-glow" 
        style={{ 
          top: "45%", 
          right: "10%", 
          width: "450px", 
          height: "450px", 
          background: "var(--secondary-accent)",
          transform: `translate3d(0, ${scrollY * -0.08}px, 0)` 
        }} 
      />
      <div 
        className="landing-bg-glow" 
        style={{ 
          top: "75%", 
          left: "20%", 
          width: "400px", 
          height: "400px", 
          background: "var(--primary-accent)",
          transform: `translate3d(0, ${scrollY * 0.2}px, 0)` 
        }} 
      />

      {/* Main marketing page header with logo icon and entrance trigger */}
      <header className="landing-header">
        <div className="landing-logo">
          <img src={symbol} alt="Starlit Pay Logo" style={{ height: "32px", width: "auto" }} />
          <span>Starlit Pay</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          {/* Theme Toggle Button */}
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
              backgroundColor: "rgba(255, 255, 255, 0.05)",
              width: "40px",
              height: "40px",
              transition: "all 0.2s ease"
            }}
          >
            {theme === "light" ? <Sun size={20} /> : <Moon size={20} />}
          </button>
          
          <button onClick={() => setAuthState("logged-out")} className="btn-secondary" style={{ padding: "10px 20px", borderRadius: "10px", fontSize: "14px", height: "auto" }}>
            Login / Launch
          </button>
        </div>
      </header>

      {/* Hero section highlighting private payments and app conversion action */}
      <section className="landing-hero">
        <img 
          src={logo} 
          alt="Starlit Pay Logo" 
          className="animate-on-scroll stagger-delay-1"
          style={{ height: "120px", width: "auto", marginBottom: "32px" }} 
        />
        <div className="hero-tag animate-on-scroll stagger-delay-1">Stellar Soroban Testnet</div>
        <h1 className="hero-title animate-on-scroll stagger-delay-2">Private Payments, Powered by Stellar</h1>
        <p className="hero-subtitle animate-on-scroll stagger-delay-3">
          Send money privately on Stellar
        </p>
        <div style={{ display: "flex", gap: "16px" }} className="animate-on-scroll stagger-delay-4">
          <button onClick={() => setAuthState("logged-out")} className="btn-primary" style={{ padding: "16px 32px" }}>
            <span>Enter Application</span>
            <ArrowRight size={18} />
          </button>
        </div>
      </section>

      {/* Features layout explaining privacy, relayer fees, and smart contracts */}
      <section id="features" className="landing-section">
        <div className="section-header animate-on-scroll">
          <span className="section-tag">Privacy by default</span>
          <h2 className="section-title">Core Protocols</h2>
        </div>
        <div className="landing-features-grid">
          <div className="landing-feature-card animate-on-scroll stagger-delay-1">
            <div className="feature-icon-wrapper">
              <Shield size={24} />
            </div>
            <h3 className="feature-card-title">Default ZK Privacy</h3>
            <p className="feature-card-desc">
              Keep your balances and transactions completely private. Zero-Knowledge proofs mask 
              your identity, assets, and transfer amounts on the public ledger.
            </p>
          </div>
          <div className="landing-feature-card animate-on-scroll stagger-delay-2">
            <div className="feature-icon-wrapper">
              <Activity size={24} />
            </div>
            <h3 className="feature-card-title">Relayer Sponsorship</h3>
            <p className="feature-card-desc">
              Execute transactions with zero gas. The Starlit Relayer network sponsors 
              and pays for Stellar network fees, creating a completely gas-less user experience.
            </p>
          </div>
          <div className="landing-feature-card animate-on-scroll stagger-delay-3">
            <div className="feature-icon-wrapper">
              <Cpu size={24} />
            </div>
            <h3 className="feature-card-title">Soroban Smart Contracts</h3>
            <p className="feature-card-desc">
              Built directly on Stellar's native smart contract platform. The shielded pool 
              and nullifier verification execute deterministically, securely, and trustlessly.
            </p>
          </div>
        </div>
      </section>

      {/* Step-by-step visual workflow explaining how users get started */}
      <section id="how-it-works" className="landing-section" style={{ paddingBottom: "160px" }}>
        <div className="section-header animate-on-scroll">
          <span className="section-tag">Seamless onboarding</span>
          <h2 className="section-title">How It Works</h2>
        </div>
        <div className="how-it-works-list">
          <div className="step-item animate-on-scroll stagger-delay-1">
            <div className="step-number">01</div>
            <div className="step-content">
              <h3>Set up Username & PIN</h3>
              <p>Register a unique username alias. We derive your zero-knowledge spending keys and public viewing key directly from your email and a secure 6-digit PIN.</p>
            </div>
          </div>
          <div className="step-item animate-on-scroll stagger-delay-2">
            <div className="step-number">02</div>
            <div className="step-content">
              <h3>Fund & Shield Assets</h3>
              <p>Add cash to your account by depositing public Stellar tokens (USDC or XLM) into the shielded contract pool, locking them into private zero-knowledge notes.</p>
            </div>
          </div>
          <div className="step-item animate-on-scroll stagger-delay-3">
            <div className="step-number">03</div>
            <div className="step-content">
              <h3>Transact Privately</h3>
              <p>Send payments directly to any username. You can also generate encrypted, shareable Pay Links that other users can claim directly to their Starlit balance.</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
