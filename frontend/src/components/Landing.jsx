import React, { useEffect, useRef, useState } from "react";
import { 
  Shield, ArrowRight, Activity, Cpu, Sun, Moon, 
  Lock, Eye, HelpCircle, ChevronDown, Check, Zap, Sparkles, FileText
} from "lucide-react";

export default function Landing({ scrollY, setAuthState, theme, toggleTheme, logo, symbol }) {
  const observerRef = useRef(null);
  
  // Interactive Simulator State
  const [simulatorStep, setSimulatorStep] = useState(0);
  
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

  const simulatorSteps = [
    {
      title: "1. Deposit & Shield",
      badge: "Public → Private",
      description: "You deposit public Stellar tokens (like XLM or USDC) into the Starlit smart contract. The contract locks the public tokens and issues private cryptographic 'notes' directly to your account. Your public balance drops, and your shielded balance increases privately.",
      highlightNode: "alice",
      arrowActive: "left"
    },
    {
      title: "2. Create Zero-Knowledge Proof",
      badge: "In-Browser Proof",
      description: "When you want to send money, your browser compiles a Zero-Knowledge proof locally. This proof proves that you own the private notes and have enough balance, without revealing your identity, your balance, or who you are sending money to.",
      highlightNode: "alice",
      arrowActive: "none"
    },
    {
      title: "3. Submit via Gasless Relayer",
      badge: "Sponsors Network Fee",
      description: "Your browser sends the proof to a Relayer node. The Relayer pays the gas fee (in XLM) and submits the transaction to the Stellar Soroban blockchain. This keeps the transaction fully private and gas-free for you.",
      highlightNode: "blockchain",
      arrowActive: "right"
    },
    {
      title: "4. Recipient Decrypts",
      badge: "Dual-Key Scanning",
      description: "Bob's browser scans the blockchain events. Using his Viewing Key, his browser decrypts and detects the incoming private notes. Bob's private balance increases instantly, and only Bob knows he received the payment.",
      highlightNode: "bob",
      arrowActive: "none"
    }
  ];

  const protocols = {
    "shielded-pool": {
      title: "Shielded Asset Pool",
      description: "Starlit Pay acts like a single massive pool of assets on the Stellar blockchain. When you deposit assets, they mix into this pool.",
      points: [
        "Balances and token transfers are completely hidden on the public ledger.",
        "Supports major Stellar assets: XLM, USDC, and EURC.",
        "Prevents anyone from tracking your cash flow or total holdings."
      ],
      visual: `// On-Chain State View
contract ShieldedPool {
  // Commitments hide owners & values
  commitments: Map<Hash, bool>, 
  
  // Nullifiers prevent double spends
  spent_nullifiers: Map<Hash, bool>
}`
    },
    "gasless": {
      title: "Gasless Transactions",
      description: "You do not need to buy or hold XLM just to pay for network transactions. Our Relayer network handles all fees.",
      points: [
        "Zero gas fees for user accounts when sending private payments.",
        "Relayers wrap transactions, pay fees, and submit them to Stellar.",
        "Enjoy a seamless Web2-like payment experience without crypto friction."
      ],
      visual: `// Relayer Sponsorship Flow
[User Browser] -> (Signed ZK Proof)
       v
[Relayer Node] -> (Sponsors XLM Fees)
       v
[Stellar Ledger] -> (Executes Payment)`
    },
    "noir-lang": {
      title: "On-Device Noir Prover",
      description: "Your secret spending keys never leave your device. All cryptographic proofs are generated locally in your web browser.",
      points: [
        "Uses WebAssembly to compile proofs inside your web browser.",
        "Zero server dependencies: your transactions cannot be blocked or censored.",
        "Securely derives spending keys from your email and 6-digit PIN."
      ],
      visual: `// In-Browser Noir Engine
const proof = await noir.generateProof({
  private_key: pin_derived_key,
  note_balance: 100,
  transfer_amount: 30,
  recipient_hash: hash(bob)
});`
    },
    "compliance": {
      title: "Compliance & Viewing Keys",
      description: "Privacy does not mean hiding from tax authorities. Starlit separates spending control from history access.",
      points: [
        "Spending Key: Required to send transactions. Never leaves your device.",
        "Viewing Key: Read-only key to decrypt and export your transaction log.",
        "Easily share your Viewing Key with tax inspectors or auditors for compliance."
      ],
      visual: `// Dual-Key Cryptography
Keys: {
  SpendingKey: "Required to sign & spend",
  ViewingKey:  "Read-only logs decryptor"
}
// Export history as a secure PDF report`
    }
  };

  const faqs = [
    {
      question: "Are my funds completely safe and under my control?",
      answer: "Yes. Starlit Pay is self-custodial. Your keys are generated in your browser using a combination of your email and a 6-digit PIN. We never save your password, PIN, or private keys on our servers. You are the only person who can access or spend your money."
    },
    {
      question: "How are transaction fees paid if I don't have XLM?",
      answer: "We use a Relayer network to sponsor fees. When you make a private transfer, your browser generates a transaction proof and forwards it to a Relayer. The Relayer pays the transaction fees in XLM on the Stellar network. This gives you a gasless experience without needing to hold native gas tokens."
    },
    {
      question: "Is Starlit Pay regulatory compliant?",
      answer: "Yes. Starlit utilizes dual-key cryptography. It splits your wallet into a Spending Key and a Viewing Key. The Spending Key stays on your device to execute transactions. The Viewing Key is a read-only key that can decrypt your transaction history. You can share this Viewing Key with auditors or tax authorities to prove your income or payments without giving up ownership of your funds."
    },
    {
      question: "Can other people see my balance on the blockchain?",
      answer: "No. To an outside observer on the Stellar ledger, all funds look like they belong to a single collective smart contract pool. Individual transaction details, asset types, and balances are hidden behind zero-knowledge note commitments. Only you can view your personal balance and history."
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
        <div className="hero-tag animate-on-scroll stagger-delay-1">Stellar Soroban Testnet</div>
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

      {/* How It Works - Interactive Simulator */}
      <section id="simulator" className="landing-section">
        <div className="section-header animate-on-scroll">
          <span className="section-tag">Interactive Demo</span>
          <h2 className="section-title">See How It Works</h2>
        </div>
        
        <div className="simulator-container animate-on-scroll">
          {/* Left panel: Info and controls */}
          <div className="simulator-card">
            <div className="simulator-steps-nav">
              {simulatorSteps.map((step, idx) => (
                <button
                  key={idx}
                  onClick={() => setSimulatorStep(idx)}
                  className={`simulator-step-btn ${simulatorStep === idx ? "active" : ""}`}
                >
                  Step {idx + 1}
                </button>
              ))}
            </div>
            
            <span className="simulator-badge">{simulatorSteps[simulatorStep].badge}</span>
            <h3 className="simulator-card-title" style={{ marginTop: "16px" }}>
              {simulatorSteps[simulatorStep].title}
            </h3>
            <p className="simulator-card-desc">
              {simulatorSteps[simulatorStep].description}
            </p>
            
            <div style={{ display: "flex", gap: "12px" }}>
              <button 
                onClick={() => setSimulatorStep(prev => (prev > 0 ? prev - 1 : simulatorSteps.length - 1))}
                className="btn-secondary"
                style={{ padding: "10px 20px", fontSize: "14px" }}
              >
                Previous
              </button>
              <button 
                onClick={() => setSimulatorStep(prev => (prev < simulatorSteps.length - 1 ? prev + 1 : 0))}
                className="btn-primary"
                style={{ padding: "10px 20px", fontSize: "14px" }}
              >
                Next Step
              </button>
            </div>
          </div>
          
          {/* Right panel: Graphic visualization */}
          <div className="simulator-visualizer">
            <div className="simulator-flow-graphic">
              {/* Alice Node */}
              <div className={`simulator-node ${simulatorSteps[simulatorStep].highlightNode === "alice" ? "active" : ""}`}>
                <div className="simulator-node-icon">
                  <Lock size={24} />
                </div>
                <span className="simulator-node-label">Alice</span>
              </div>
              
              {/* Arrow Alice -> Blockchain */}
              <div className={`simulator-arrow ${simulatorSteps[simulatorStep].arrowActive === "left" ? "active" : ""}`}>
                {simulatorSteps[simulatorStep].arrowActive === "left" && <div className="simulator-arrow-dot" />}
              </div>
              
              {/* Blockchain Node */}
              <div className={`simulator-node ${simulatorSteps[simulatorStep].highlightNode === "blockchain" ? "active" : ""}`}>
                <div className="simulator-node-icon">
                  <Cpu size={24} />
                </div>
                <span className="simulator-node-label">Soroban Pool</span>
              </div>
              
              {/* Arrow Blockchain -> Bob */}
              <div className={`simulator-arrow ${simulatorSteps[simulatorStep].arrowActive === "right" ? "active" : ""}`}>
                {simulatorSteps[simulatorStep].arrowActive === "right" && <div className="simulator-arrow-dot" />}
              </div>
              
              {/* Bob Node */}
              <div className={`simulator-node ${simulatorSteps[simulatorStep].highlightNode === "bob" ? "active" : ""}`}>
                <div className="simulator-node-icon">
                  <Eye size={24} />
                </div>
                <span className="simulator-node-label">Bob</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Protocols Deep Dive - Tabbed Layout */}
      <section id="protocols" className="landing-section">
        <div className="section-header animate-on-scroll">
          <span className="section-tag">Deep Dive</span>
          <h2 className="section-title">Core Technologies</h2>
        </div>
        
        <div className="protocols-tabs-nav animate-on-scroll">
          <button 
            onClick={() => setActiveTab("shielded-pool")}
            className={`protocols-tab-btn ${activeTab === "shielded-pool" ? "active" : ""}`}
          >
            <Shield size={18} />
            <span>Shielded Pool</span>
          </button>
          <button 
            onClick={() => setActiveTab("gasless")}
            className={`protocols-tab-btn ${activeTab === "gasless" ? "active" : ""}`}
          >
            <Zap size={18} />
            <span>Gasless Relayer</span>
          </button>
          <button 
            onClick={() => setActiveTab("noir-lang")}
            className={`protocols-tab-btn ${activeTab === "noir-lang" ? "active" : ""}`}
          >
            <Cpu size={18} />
            <span>On-Device Noir</span>
          </button>
          <button 
            onClick={() => setActiveTab("compliance")}
            className={`protocols-tab-btn ${activeTab === "compliance" ? "active" : ""}`}
          >
            <FileText size={18} />
            <span>Auditing Keys</span>
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
              <pre style={{ margin: 0, overflowX: "auto" }}>
                <code>{protocols[activeTab].visual}</code>
              </pre>
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

          {/* EURC */}
          <div className="asset-card-homepage">
            <div className="asset-card-homepage-header">
              <span className="asset-card-homepage-title">
                <Sparkles size={20} style={{ color: "#10b981" }} />
                EURC
              </span>
              <span className="asset-card-homepage-tag">Euro Stablecoin</span>
            </div>
            <p className="asset-card-homepage-desc">
              Private European stablecoin transactions. Send and store euros securely, bridging traditional currency to private ledger pools.
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

      {/* Security Specs Matrix */}
      <section id="security" className="landing-section">
        <div className="section-header animate-on-scroll">
          <span className="section-tag">Security & Compliance</span>
          <h2 className="section-title">Built-In Protections</h2>
        </div>
        
        <div className="specs-table-container animate-on-scroll">
          <table className="specs-table">
            <thead>
              <tr>
                <th>Security Feature</th>
                <th>How It Works</th>
                <th>Why It Matters</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="specs-feature-name">Anti-Replay Guard</td>
                <td>Once spent, note nullifiers are permanently stored on-chain.</td>
                <td>Prevents double-spending of the same notes.</td>
              </tr>
              <tr>
                <td className="specs-feature-name">Front-Running Protection</td>
                <td>ZK-proofs are cryptographically locked to the destination address.</td>
                <td>Malicious bots cannot steal or intercept your payment proof.</td>
              </tr>
              <tr>
                <td className="specs-feature-name">Dual-Key Separation</td>
                <td>Separates spending rights (private) from history viewing (shareable).</td>
                <td>Lets you share records for taxes without exposing your spending key.</td>
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
          Step into Starlit Pay on the Stellar Soroban Testnet today. Send money gas-free with complete confidence.
        </p>
        <button onClick={() => setAuthState("logged-out")} className="btn-primary" style={{ padding: "16px 36px", margin: "0 auto" }}>
          <span>Launch Application</span>
          <ArrowRight size={18} />
        </button>
      </section>
    </div>
  );
}
