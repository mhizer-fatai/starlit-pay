import React, { useEffect, useRef, useState } from "react";
import { 
  Shield, ArrowRight, Activity, Cpu, Sun, Moon, 
  Lock, Eye, HelpCircle, ChevronDown, Check, Zap, Sparkles, FileText
} from "lucide-react";

export default function Landing({ scrollY, setAuthState, theme, toggleTheme, logo, symbol }) {
  const observerRef = useRef(null);
  
  // Protocols Tabs State
  const [activeTab, setActiveTab] = useState("shielded-pool");
  
  // FAQ Accordion State
  const [expandedFaq, setExpandedFaq] = useState(null);

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

  const protocols = {
    "shielded-pool": {
      title: "Complete Privacy",
      description: "Starlit Pay acts like a secure digital vault. When you put money in, it is mixed to hide your identity and amounts.",
      points: [
        "Your balances are completely hidden from public view.",
        "Supports standard tokens like digital dollars (USDC) and XLM.",
        "Prevents anyone from spying on how much you spend or hold."
      ],
      visual: (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", alignItems: "center", justifyContent: "center", height: "100%", minHeight: "160px", padding: "10px" }}>
          <div style={{ fontSize: "14px", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: "600", letterSpacing: "1px" }}>Current Balance</div>
          <div style={{ fontSize: "36px", fontWeight: "800", color: "var(--success-color)", display: "flex", alignItems: "center", gap: "8px" }}>
            <Lock size={28} />
            <span>🔒 Shielded</span>
          </div>
          <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>Fully hidden from public view</div>
        </div>
      )
    },
    "gasless": {
      title: "No Network Fees",
      description: "You do not need to buy or keep extra tokens just to pay for network transactions. We handle everything.",
      points: [
        "Absolutely zero transaction fees for your account.",
        "No need to buy native network tokens to pay for gas.",
        "Simple, fast, and works exactly like sending an email."
      ],
      visual: (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", alignItems: "center", justifyContent: "center", height: "100%", minHeight: "160px", padding: "10px" }}>
          <div style={{ fontSize: "14px", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: "600", letterSpacing: "1px" }}>Transaction Cost</div>
          <div style={{ fontSize: "36px", fontWeight: "800", color: "#64748b", textDecoration: "line-through", opacity: 0.5 }}>$0.25</div>
          <div style={{ fontSize: "44px", fontWeight: "900", color: "var(--primary-accent)", textShadow: "0 0 20px rgba(139, 92, 246, 0.4)" }}>$0.00</div>
          <div style={{ fontSize: "12px", color: "var(--success-color)", fontWeight: "600" }}>Sponsored & Free</div>
        </div>
      )
    },
    "noir-lang": {
      title: "On-Device Security",
      description: "Your secret access keys never leave your phone or computer. All security checks happen right in your app.",
      points: [
        "Your secret password stays in your device's secure memory.",
        "Your money cannot be frozen, blocked, or controlled by anyone else.",
        "Log in securely with just your email and a simple 6-digit PIN."
      ],
      visual: (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", width: "100%", height: "100%", justifyContent: "center", minHeight: "160px", padding: "10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", background: "rgba(255,255,255,0.03)", padding: "12px", borderRadius: "12px", border: "1px solid var(--border-color)" }}>
            <Lock size={18} style={{ color: "var(--success-color)", flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>SECRET KEY</div>
              <div style={{ fontSize: "12px", fontWeight: "700" }}>Stored on your device</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", background: "rgba(255,255,255,0.03)", padding: "12px", borderRadius: "12px", border: "1px solid var(--border-color)" }}>
            <Cpu size={18} style={{ color: "var(--primary-accent)", flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>SECURITY CHECKS</div>
              <div style={{ fontSize: "12px", fontWeight: "700" }}>Run locally in app</div>
            </div>
          </div>
        </div>
      )
    }
  };

  const faqs = [
    {
      question: "Are my funds completely safe and under my control?",
      answer: "Yes. Starlit Pay is self-custodial. Your keys are generated in your browser using a combination of your email and a 6-digit PIN. We never save your password, PIN, or keys on our servers. You are the only person who can access or spend your money."
    },
    {
      question: "How are transaction fees paid if I don't have XLM?",
      answer: "We use a sponsored fee network. When you make a private transfer, your browser generates a transaction and forwards it to our helper nodes. These nodes pay the network fees on the Stellar network. This gives you a completely free experience without needing to hold any gas tokens."
    },
    {
      question: "What happens if I lose my 6-digit PIN?",
      answer: "Starlit Pay is fully private and secure, which means we do not store your keys. If you lose your PIN, you cannot decrypt your local access seed or spend your shielded balance. Always write down your PIN and keep it in a safe place."
    },
    {
      question: "Can other people see my balance on the blockchain?",
      answer: "No. To an outside observer on the Stellar ledger, all funds look like they belong to a single collective vault. Individual transaction details, asset types, and balances are hidden. Only you can view your personal balance and history."
    }
  ];

  return (
    <div className="landing-page-root">
      {/* Background parallax grid patterns */}
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
          top: "35%", 
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
          top: "70%", 
          left: "20%", 
          width: "400px", 
          height: "400px", 
          background: "var(--primary-accent)",
          transform: `translate3d(0, ${scrollY * 0.2}px, 0)` 
        }} 
      />

      {/* Header */}
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

      {/* Hero Section */}
      <section className="landing-hero">
        <img 
          src={logo} 
          alt="Starlit Pay Logo" 
          className="animate-on-scroll stagger-delay-1"
          style={{ height: "120px", width: "auto", marginBottom: "32px" }} 
        />
        <div className="hero-tag animate-on-scroll stagger-delay-1">Stellar Testnet</div>
        <h1 className="hero-title animate-on-scroll stagger-delay-2">Private Payments, Made Simple</h1>
        <p className="hero-subtitle animate-on-scroll stagger-delay-3">
          Shield your balances and send tokens privately on Stellar. Fully gasless, secure, and instant.
        </p>
        <div style={{ display: "flex", gap: "16px" }} className="animate-on-scroll stagger-delay-4">
          <button onClick={() => setAuthState("logged-out")} className="btn-primary" style={{ padding: "16px 32px" }}>
            <span>Enter Application</span>
            <ArrowRight size={18} />
          </button>
        </div>
      </section>

      {/* How It Works - Non-scrolling Timeline */}
      <section id="how-it-works" className="landing-section">
        <div className="section-header animate-on-scroll">
          <span className="section-tag">Simple Steps</span>
          <h2 className="section-title">How It Works</h2>
        </div>
        
        <div className="how-it-works-list">
          <div className="step-item animate-on-scroll stagger-delay-1">
            <div className="step-number">01</div>
            <div className="step-content">
              <h3>Create Your Account</h3>
              <p>Sign up in seconds using your email and a secure 6-digit PIN. No complicated backup phrases to write down or lose.</p>
            </div>
          </div>
          <div className="step-item animate-on-scroll stagger-delay-2">
            <div className="step-number">02</div>
            <div className="step-content">
              <h3>Deposit & Shield Funds</h3>
              <p>Put standard tokens (like USDC or XLM) into the secure vault. Your public balance drops, and your wallet balance becomes completely private.</p>
            </div>
          </div>
          <div className="step-item animate-on-scroll stagger-delay-3">
            <div className="step-number">03</div>
            <div className="step-content">
              <h3>Send Money for Free</h3>
              <p>Type in any username to send money privately. A helper network processes the transfer and sponsors the transaction fee, keeping it free for you.</p>
            </div>
          </div>
          <div className="step-item animate-on-scroll stagger-delay-4">
            <div className="step-number">04</div>
            <div className="step-content">
              <h3>Receive Privately</h3>
              <p>Payments show up directly in your account. Only you can see your history, received tokens, and private wallet balance.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Why Starlit Pay? */}
      <section id="protocols" className="landing-section">
        <div className="section-header animate-on-scroll">
          <span className="section-tag">Designed for Everyone</span>
          <h2 className="section-title">Why Starlit Pay?</h2>
        </div>
        
        <div className="protocols-tabs-nav animate-on-scroll">
          <button 
            onClick={() => setActiveTab("shielded-pool")}
            className={`protocols-tab-btn ${activeTab === "shielded-pool" ? "active" : ""}`}
          >
            <Shield size={18} />
            <span>Complete Privacy</span>
          </button>
          <button 
            onClick={() => setActiveTab("gasless")}
            className={`protocols-tab-btn ${activeTab === "gasless" ? "active" : ""}`}
          >
            <Zap size={18} />
            <span>No Network Fees</span>
          </button>
          <button 
            onClick={() => setActiveTab("noir-lang")}
            className={`protocols-tab-btn ${activeTab === "noir-lang" ? "active" : ""}`}
          >
            <Cpu size={18} />
            <span>On-Device Security</span>
          </button>
        </div>
        
        <div className="protocols-tab-content animate-on-scroll">
          <div className="protocols-content-grid">
            <div>
              <h3 className="protocols-tab-title">{protocols[activeTab].title}</h3>
              <p className="protocols-tab-desc">{protocols[activeTab].description}</p>
              
              <div className="protocols-points-list">
                {protocols[activeTab].points.map((point, idx) => (
                  <div key={idx} className="protocols-point-item">
                    <Check size={16} />
                    <span>{point}</span>
                  </div>
                ))}
              </div>
            </div>
            
            <div className="protocols-visual-card">
              {protocols[activeTab].visual}
            </div>
          </div>
        </div>
      </section>

      {/* Supported Assets */}
      <section id="assets" className="landing-section">
        <div className="section-header animate-on-scroll">
          <span className="section-tag">Multi-Asset</span>
          <h2 className="section-title">Supported Assets</h2>
        </div>
        
        <div className="assets-grid animate-on-scroll">
          {/* USDC */}
          <div className="asset-card-homepage">
            <div className="asset-card-homepage-header">
              <span className="asset-card-homepage-title">
                <Sparkles size={20} style={{ color: "#3b82f6" }} />
                USDC
              </span>
              <span className="asset-card-homepage-tag">USD Stablecoin</span>
            </div>
            <p className="asset-card-homepage-desc">
              Transact with digital dollars privately. Perfect for payments, savings, and global transfers without price swings.
            </p>
            <div className="asset-card-homepage-details">
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Gas Sponsorship:</span>
                <span style={{ color: "var(--success-color)", fontWeight: "600" }}>Active</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Settle Time:</span>
                <span style={{ color: "#ffffff", fontWeight: "600" }}>~5 Seconds</span>
              </div>
            </div>
          </div>

          {/* XLM */}
          <div className="asset-card-homepage">
            <div className="asset-card-homepage-header">
              <span className="asset-card-homepage-title">
                <Activity size={20} style={{ color: "#8b5cf6" }} />
                XLM
              </span>
              <span className="asset-card-homepage-tag">Stellar Native</span>
            </div>
            <p className="asset-card-homepage-desc">
              Send the native asset of Stellar privately. Ideal for fast micro-payments and network transfers with zero fee friction.
            </p>
            <div className="asset-card-homepage-details">
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Gas Sponsorship:</span>
                <span style={{ color: "var(--success-color)", fontWeight: "600" }}>Active</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Settle Time:</span>
                <span style={{ color: "#ffffff", fontWeight: "600" }}>~5 Seconds</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Security Specifications */}
      <section id="security" className="landing-section">
        <div className="section-header animate-on-scroll">
          <span className="section-tag">Security & Compliance</span>
          <h2 className="section-title">Built-In Protections</h2>
        </div>
        
        <div className="specs-table-container animate-on-scroll">
          <table className="specs-table">
            <thead>
              <tr>
                <th>Protection</th>
                <th>How It Works</th>
                <th>Why You Need It</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="specs-feature-name">Double-Spend Prevention</td>
                <td>Ensures a payment cannot be copied or sent twice.</td>
                <td>Keeps the system accurate and fraud-free.</td>
              </tr>
              <tr>
                <td className="specs-feature-name">Payment Intercept Protection</td>
                <td>Locks the payment securely to the recipient's username.</td>
                <td>Prevents unauthorized people from redirecting your funds.</td>
              </tr>
              <tr>
                <td className="specs-feature-name">Device-Level Encryption</td>
                <td>Your private password is encrypted on your device and never stored online.</td>
                <td>Keeps your money safe even if our servers go down.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* FAQ Accordion */}
      <section id="faq" className="landing-section">
        <div className="section-header animate-on-scroll">
          <span className="section-tag">Got Questions?</span>
          <h2 className="section-title">Frequently Asked Questions</h2>
        </div>
        
        <div className="faq-container animate-on-scroll">
          {faqs.map((faq, idx) => (
            <div 
              key={idx} 
              className={`faq-item ${expandedFaq === idx ? "open" : ""}`}
            >
              <button 
                onClick={() => setExpandedFaq(expandedFaq === idx ? null : idx)}
                className="faq-question-btn"
              >
                <span>{faq.question}</span>
                <ChevronDown size={18} className="faq-arrow" />
              </button>
              
              <div 
                className="faq-answer-content"
                style={{ maxHeight: expandedFaq === idx ? "200px" : "0" }}
              >
                <p>{faq.answer}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Bottom CTA Banner */}
      <section className="landing-cta animate-on-scroll">
        <h2 className="cta-title">Ready to Transact Privately?</h2>
        <p className="cta-desc">
          Step into Starlit Pay today. Send money gas-free with complete confidence.
        </p>
        <button onClick={() => setAuthState("logged-out")} className="btn-primary" style={{ padding: "16px 36px", margin: "0 auto" }}>
          <span>Launch Application</span>
          <ArrowRight size={18} />
        </button>
      </section>
    </div>
  );
}
