import React, { useState, useEffect, useRef } from "react";
import {
  Shield, Coins, Send as SendIcon, Download, RefreshCw, User, Lock,
  FileText, Eye, EyeOff, CheckCircle, AlertCircle, LogOut, Search, Key, Link as LinkIcon, Upload,
  ArrowRight, Globe, Cpu, Activity as ActivityIcon, Check, Sun, Moon
} from "lucide-react";
import { createClient } from "@supabase/supabase-js";
import nacl from "tweetnacl";
import { connectWithWalletKit, signWithWalletKit } from "./utils/walletKit";
import Landing from "./components/Landing";
import Auth from "./components/Auth";
import Sidebar from "./components/Sidebar";
import logoDark from "./assets/logo_dark.png";
import logoLight from "./assets/logo_light.png";
import symbolDark from "./assets/symbol_dark.png";
import symbolLight from "./assets/symbol_light.png";
import Balances from "./components/Balances";
import Send from "./components/Send";
import Receive from "./components/Receive";
import Withdraw from "./components/Withdraw";
import Activity from "./components/Activity";
import Links from "./components/Links";
import Keys from "./components/Keys";
import {
  deriveKeysFromEmailAndPin, encryptNote, decryptNote,
  encryptSeedLocally, decryptSeedLocally, bytesToHex, hexToBytes,
  encryptSymmetrically, decryptSymmetrically
} from "./utils/crypto";
import {
  claimFromPool, sendPublicPayment,
  buildPublicPaymentTxXdr, submitSignedXdr
} from "./utils/stellar";
import {
  calculateCommitment, calculateNullifier, generateShieldedPaymentProof
} from "./utils/zk";

// Soroban Contract Configuration
const SHIELDED_POOL_CONTRACT_ID = "CDGRLPOMGHXFPVCH6AZGXAOBQUDWKXQUKQU7NDH3XUZA7EWWWWQP6MUI";
const DEPOSIT_GATEWAY_ADDRESS = "GCDQQE7CPLIGMAH4QEB2SSIEAS5MZMFSQAYSEJYSF7P5ZLA6HOU4BWWY";

const TOKENS = {
  XLM: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC", // Native XLM Wrapper
  USDC: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA" // Testnet USDC
};

// Dynamic backend routing base URL
const BACKEND_URL = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
  ? "http://localhost:3001"
  : "https://starlit-pay.onrender.com";

// Initialize Supabase Client
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);



export default function App() {
  // Navigation & Auth States
  const [currentTab, setCurrentTab] = useState("home"); // Tracks the currently active dashboard view
  const [authState, setAuthState] = useState("landing"); // landing, logged-out, pin-setup, pin-entry, logged-in
  const [scrollY, setScrollY] = useState(0);
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "dark");

  const toggleTheme = () => setTheme(prev => prev === "light" ? "dark" : "light");

  useEffect(() => {
    if (theme === "light") {
      document.documentElement.classList.add("light-theme");
    } else {
      document.documentElement.classList.remove("light-theme");
    }
    localStorage.setItem("theme", theme);
  }, [theme]);
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [inAppNotification, setInAppNotification] = useState(null);

  // Manages layout overflow settings and records scrolling offset
  useEffect(() => {
    if (authState === "landing") {
      document.body.style.overflow = "auto";
      document.documentElement.style.overflow = "auto";
      const rootEl = document.getElementById("root");
      if (rootEl) {
        rootEl.style.overflow = "auto";
        rootEl.style.height = "auto";
      }
      const handleScroll = () => {
        setScrollY(window.scrollY);
      };
      window.addEventListener("scroll", handleScroll);
      return () => {
        window.removeEventListener("scroll", handleScroll);
        document.body.style.overflow = "hidden";
        document.documentElement.style.overflow = "hidden";
        if (rootEl) {
          rootEl.style.overflow = "hidden";
          rootEl.style.height = "100%";
        }
      };
    } else {
      document.body.style.overflow = "hidden";
      document.documentElement.style.overflow = "hidden";
      const rootEl = document.getElementById("root");
      if (rootEl) {
        rootEl.style.overflow = "hidden";
        rootEl.style.height = "100%";
      }
      setScrollY(0);
    }
  }, [authState]);

  // Mobile layout state management
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 800);
  const [mobileTab, setMobileTab] = useState("wallet"); // wallet, pay, activity, more
  const [walletAction, setWalletAction] = useState(null); // null, add, out
  const [contacts, setContacts] = useState([]);
  const [dashboardAction, setDashboardAction] = useState(null); // null, send, receive
  const [showPinConfirm, setShowPinConfirm] = useState(false);
  const [confirmPinInput, setConfirmPinInput] = useState("");
  const [payRequestCommitment, setPayRequestCommitment] = useState("");
  const [payRequestDetails, setPayRequestDetails] = useState(null);
  const [payStep, setPayStep] = useState("loading"); // loading, details, success, error

  const [secondsLeft, setSecondsLeft] = useState(null);
  const [connectedWalletAddress, setConnectedWalletAddress] = useState(null);
  const [connectedWalletName, setConnectedWalletName] = useState(null);
  const logo = theme === "light" ? logoLight : logoDark;
  const symbol = theme === "light" ? symbolLight : symbolDark;
  const [prices, setPrices] = useState({ USDC: 1.00, XLM: 0.12 });


  useEffect(() => {
    const fetchPrices = async () => {
      try {
        const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=stellar,usd-coin&vs_currencies=usd");
        const data = await res.json();
        if (data.stellar?.usd && data["usd-coin"]?.usd) {
          setPrices({
            XLM: data.stellar.usd,
            USDC: data["usd-coin"].usd
          });
        }
      } catch (err) {
        console.warn("Failed to fetch live prices, using cache:", err);
      }
    };

    fetchPrices();
    const interval = setInterval(fetchPrices, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 800);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Sets up the install prompt listener for the web app manifest
  useEffect(() => {
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  }, []);

  // Triggers the browser app installation prompt
  const handleInstallApp = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setDeferredPrompt(null);
    }
  };
  // User Profile
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [username, setUsername] = useState("");
  const [userProfile, setUserProfile] = useState(null);
  const [walletKeys, setWalletKeys] = useState(null);

  const [profilePic, setProfilePic] = useState(null);
  const profilePicInputRef = useRef(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const [receiptData, setReceiptData] = useState(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [flareParticles, setFlareParticles] = useState([]);

  const triggerFlares = () => {
    const particles = [];
    const colors = ["#8B5CF6", "#3B82F6", "#EC4899", "#F59E0B", "#10B981", "#06B6D4"];
    for (let i = 0; i < 60; i++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = 80 + Math.random() * 140;
      const x = Math.cos(angle) * distance;
      const y = Math.sin(angle) * distance;
      const r = Math.random() * 360;
      const size = 6 + Math.random() * 8;
      const delay = Math.random() * 0.2;
      const color = colors[Math.floor(Math.random() * colors.length)];
      const isSquare = Math.random() > 0.5;

      particles.push({
        id: i,
        x: `${x}px`,
        y: `${y}px`,
        r: `${r}deg`,
        size: `${size}px`,
        color,
        delay: `${delay}s`,
        borderRadius: isSquare ? "2px" : "50%"
      });
    }
    setFlareParticles(particles);
  };

  useEffect(() => {
    if (userProfile?.username) {
      const savedPic = localStorage.getItem(`starlit_profile_pic_${userProfile.username}`);
      setProfilePic(savedPic);
    } else {
      setProfilePic(null);
    }
  }, [userProfile]);

  const handleProfilePicChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64data = reader.result;
        setProfilePic(base64data);
        if (userProfile?.username) {
          localStorage.setItem(`starlit_profile_pic_${userProfile.username}`, base64data);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const triggerProfilePicSelect = () => {
    if (profilePicInputRef.current) {
      profilePicInputRef.current.click();
    }
  };

  const authStateRef = useRef(authState);
  const walletKeysRef = useRef(walletKeys);
  const syncInProgressRef = useRef(false);
  const notifiedCommitmentsRef = useRef(new Set());
  const isFirstLoadRef = useRef(true);
  // Event tracking and pointers are managed on the backend indexer database

  useEffect(() => {
    authStateRef.current = authState;
  }, [authState]);

  useEffect(() => {
    walletKeysRef.current = walletKeys;
  }, [walletKeys]);

  // Balances
  const [shieldedBalances, setShieldedBalances] = useState({ XLM: 0, USDC: 0 });
  const [shieldedNotes, setShieldedNotes] = useState([]);
  const [transactions, setTransactions] = useState([]);

  // Form Inputs
  const [selectedAsset, setSelectedAsset] = useState("USDC");
  const [depositAmount, setDepositAmount] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [sendRecipient, setSendRecipient] = useState("");
  const [withdrawRecipient, setWithdrawRecipient] = useState("");

  // Payment Links active state
  const [paymentLinks, setPaymentLinks] = useState([]);
  const [linkDescription, setLinkDescription] = useState("");
  const [generatedLink, setGeneratedLink] = useState("");

  // UI Status
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [zkProgress, setZkProgress] = useState("");
  const [showingZkLoader, setShowingZkLoader] = useState(false);
  const [showViewingKey, setShowViewingKey] = useState(false);
  const [feedback, setFeedback] = useState({ type: "", message: "" });

  // Listen for Supabase session changes (for Google OAuth and persistent logins)
  useEffect(() => {
    const initAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session && !walletKeysRef.current) {
        await handleOAuthSession(session);
      }
    };
    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session) {
        if (!walletKeysRef.current && authStateRef.current !== "logged-in") {
          await handleOAuthSession(session);
        }
      } else if (event === "SIGNED_OUT") {
        handleLogoutState();
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Handle Payment Request Route Routing
  useEffect(() => {
    const handleHashChange = async () => {
      const hash = window.location.hash;
      if (hash.startsWith("#/pay-request/")) {
        const commitment = hash.replace("#/pay-request/", "");
        setPayRequestCommitment(commitment);
        setCurrentTab("pay-request");
        await loadPayRequestDetails(commitment);
      } else if (currentTab === "pay-request") {
        setCurrentTab("home");
        setSecondsLeft(null);
        setConnectedWalletAddress(null);
        setConnectedWalletName(null);
      }
    };

    window.addEventListener("hashchange", handleHashChange);
    handleHashChange();

    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [currentTab]);

  // Default to #dashboard when logged in and no specific route is present
  useEffect(() => {
    const handleDefaultHash = () => {
      if (authState === "logged-in" && (window.location.hash === "" || window.location.hash === "#")) {
        window.location.hash = "dashboard";
      }
    };
    window.addEventListener("hashchange", handleDefaultHash);
    handleDefaultHash();
    return () => window.removeEventListener("hashchange", handleDefaultHash);
  }, [authState]);

  // Formats the remaining seconds into MM:SS format
  const formatTimeLeft = (seconds) => {
    if (seconds === null || seconds < 0) return "";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // Counts down the remaining seconds every second and triggers expiration once it hits zero
  useEffect(() => {
    if (secondsLeft === null || secondsLeft <= 0) return;

    const interval = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          if (currentTab === "pay-request") {
            setPayStep("error");
            setStatusMessage("This payment request has expired.");
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [secondsLeft, currentTab]);

  // Resets the countdown timer when the user navigates away from the active payment request
  useEffect(() => {
    if (currentTab !== "pay-request") {
      setSecondsLeft(null);
      setConnectedWalletAddress(null);
      setConnectedWalletName(null);
    }
  }, [currentTab]);


  const loadPayRequestDetails = async (commitment) => {
    setPayStep("loading");
    try {
      const res = await fetch(`${BACKEND_URL}/api/payment-links/${commitment}`);
      if (res.status === 404) {
        setPayStep("error");
        setStatusMessage("Payment request link not found.");
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setPayStep("error");
        setStatusMessage(data.error || "Failed to load payment request details.");
        return;
      }
      const link = data.link;

      if (link.status === "claimed") {
        setPayStep("error");
        setStatusMessage("This payment request has already been paid.");
        return;
      }

      // Computes remaining time based on the database creation timestamp
      const createdAt = new Date(link.created_at);
      const now = new Date();
      const diffMs = now.getTime() - createdAt.getTime();
      const diffSeconds = Math.floor(diffMs / 1000);
      const remainingSeconds = 30 * 60 - diffSeconds;

      if (remainingSeconds <= 0) {
        setPayStep("error");
        setStatusMessage("This payment request has expired.");
        return;
      }

      setSecondsLeft(remainingSeconds);

      const parsedDesc = JSON.parse(link.description);

      setPayRequestDetails({
        commitment,
        amount: link.amount,
        asset: link.asset,
        recipientAddress: parsedDesc.recipientAddress,
        recipientMemo: parsedDesc.recipientMemo,
        recipientUsername: parsedDesc.username,
        createdAt: link.created_at
      });
      setPayStep("details");
    } catch (err) {
      console.error(err);
      setPayStep("error");
      setStatusMessage("Failed to load payment request details.");
    }
  };

  const handleLogoutState = () => {
    setAuthState("logged-out");
    setUserProfile(null);
    setWalletKeys(null);
    setEmail("");
    setPin("");
    notifiedCommitmentsRef.current.clear();
    isFirstLoadRef.current = true;
    window.location.hash = "";
  };

  const handleOAuthSession = async (session) => {
    const userEmail = session.user.email;
    setEmail(userEmail);

    try {
      const { data: user, error } = await supabase
        .from("users")
        .select("*")
        .eq("email", userEmail.toLowerCase())
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (!user) {
        // User profile doesn't exist yet, redirect to PIN setup
        setUserProfile({ email: userEmail });
        setAuthState("register-profile");
      } else {
        // Profile exists, prompt for PIN entry to unlock keys
        setUserProfile(user);
        setAuthState("pin-entry");
      }
    } catch (err) {
      showFeedback("error", "Failed to load authenticated profile.");
    }
  };

  // 1. Initial Login Check (Checks if email exists in Database)
  const handleEmailSubmit = async (e) => {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    setStatusMessage("Checking user status...");

    try {
      const { data: user, error } = await supabase
        .from("users")
        .select("*")
        .eq("email", email.toLowerCase())
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (!user) {
        setAuthState("pin-setup");
      } else {
        setUserProfile(user);
        setAuthState("pin-entry");
      }
    } catch (error) {
      showFeedback("error", "Database connection failed. Please check your Supabase credentials.");
    } finally {
      setLoading(false);
    }
  };

  // 2. PIN Setup for New Users
  const handlePinSetup = async (e) => {
    e.preventDefault();
    if (pin.length !== 6 || pinConfirm.length !== 6) {
      showFeedback("error", "PIN must be exactly 6 digits");
      return;
    }
    if (pin !== pinConfirm) {
      showFeedback("error", "PINs do not match");
      return;
    }
    setAuthState("register-profile");
  };

  // 3. Complete Profile Registration & Supabase Authentication
  const handleRegisterProfile = async (e) => {
    e.preventDefault();
    if (pin.length !== 6) {
      showFeedback("error", "PIN must be exactly 6 digits");
      return;
    }
    if (pinConfirm && pin !== pinConfirm) {
      showFeedback("error", "PINs do not match");
      return;
    }
    if (!username) {
      showFeedback("error", "Username is required");
      return;
    }
    setLoading(true);
    setStatusMessage("Creating secure account...");

    try {
      // 1. Check if we have a supabase user session (Google OAuth flow)
      const { data: { session } } = await supabase.auth.getSession();
      let userId;

      if (session) {
        userId = session.user.id;
      } else {
        const { data: authData, error: authError } = await supabase.auth.signUp({
          email: email.toLowerCase(),
          password: pin
        });

        if (authError) {
          showFeedback("error", authError.message);
          setLoading(false);
          return;
        }
        userId = authData.user.id;
      }

      // 2. Derive cryptographic keys from email + PIN
      const derived = await deriveKeysFromEmailAndPin(email, pin);

      // 3. Save profile to users table
      const { data: newUser, error: profileError } = await supabase
        .from("users")
        .insert([
          {
            id: userId,
            email: email.toLowerCase(),
            username: username.toLowerCase().replace("@", ""),
            display_name: username,
            stellar_address: derived.stellar.publicKey,
            identity_commitment: derived.spendingKey,
            public_encryption_key: derived.viewing.publicKey,
            avatar_url: `https://api.dicebear.com/7.x/bottts/svg?seed=${username}`,
            deposit_memo: Math.floor(100000 + Math.random() * 900000)
          }
        ])
        .select()
        .single();

      if (profileError) {
        showFeedback("error", profileError.message);
        setLoading(false);
        return;
      }

      // 4. Save encrypted seed locally
      const encryptedLocalSeed = await encryptSeedLocally(derived.masterSeed, pin);
      localStorage.setItem(`seed:${email.toLowerCase()}`, JSON.stringify(encryptedLocalSeed));

      setUserProfile(newUser);
      setWalletKeys(derived);
      setAuthState("logged-in");
      showFeedback("success", "Account registered successfully!");
    } catch (error) {
      console.error("Registration error:", error);
      showFeedback("error", error.message || "Failed to create account.");
    } finally {
      setLoading(false);
    }
  };

  // 4. PIN verification & Supabase Auth SignIn
  const handlePinSubmit = async (e) => {
    e.preventDefault();
    if (pin.length !== 6) return;
    setLoading(true);
    setStatusMessage("Verifying password PIN...");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.toLowerCase(),
          password: pin
        });

        if (error) {
          showFeedback("error", "Incorrect email or PIN credentials.");
          setPin("");
          setLoading(false);
          return;
        }
      }

      const derived = await deriveKeysFromEmailAndPin(email, pin);

      if (userProfile && userProfile.identity_commitment && derived.spendingKey !== userProfile.identity_commitment) {
        showFeedback("error", "Incorrect PIN.");
        setPin("");
        setLoading(false);
        return;
      }

      if (userProfile && !userProfile.stellar_address) {
        const { error: updateError } = await supabase
          .from("users")
          .update({ stellar_address: derived.stellar.publicKey })
          .eq("id", userProfile.id);
        if (!updateError) {
          userProfile.stellar_address = derived.stellar.publicKey;
        }
      }

      if (userProfile && !userProfile.deposit_memo) {
        const generatedMemo = Math.floor(100000 + Math.random() * 900000);
        const { error: updateError } = await supabase
          .from("users")
          .update({ deposit_memo: generatedMemo })
          .eq("id", userProfile.id);
        if (!updateError) {
          userProfile.deposit_memo = generatedMemo;
        }
      }

      const storedLocalSeed = JSON.parse(localStorage.getItem(`seed:${userProfile.email.toLowerCase()}`));
      let masterSeed;
      if (storedLocalSeed) {
        try {
          masterSeed = await decryptSeedLocally(storedLocalSeed, pin);
        } catch (decryptErr) {
          console.error("Local seed decryption failed, but PIN verified against commitment.", decryptErr);
        }
      }

      if (!storedLocalSeed) {
        const encryptedLocalSeed = await encryptSeedLocally(derived.masterSeed, pin);
        localStorage.setItem(`seed:${email.toLowerCase()}`, JSON.stringify(encryptedLocalSeed));
      }

      setWalletKeys(derived);
      setAuthState("logged-in");
      showFeedback("success", "Wallet unlocked successfully.");
    } catch (error) {
      console.error("PIN verification error:", error);
      showFeedback("error", "Failed to decrypt wallet keys.");
    } finally {
      setLoading(false);
    }
  };

  // 5. Google Sign In Integration
  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin
        }
      });
      if (error) throw error;
    } catch (error) {
      showFeedback("error", error.message || "Google Sign-In failed.");
    } finally {
      setLoading(false);
    }
  };




  // Logs a new encrypted transaction history entry symmetrically
  const logTransaction = async (type, amount, asset, counterparty, txHash, commitment = "") => {
    try {
      if (!walletKeys || !userProfile) return;
      const txData = {
        type,
        amount,
        asset,
        party: counterparty || "",
        hash: txHash || "",
        commitment: commitment || "",
        timestamp: Date.now()
      };
      const encryptedPayload = encryptSymmetrically(JSON.stringify(txData), walletKeys.viewing.secretKey);
      await fetch(`${BACKEND_URL}/api/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userProfile.id,
          encrypted_payload: encryptedPayload
        })
      });
    } catch (err) {
      console.error("Failed to log transaction:", err.message);
    }
  };

  // Validates withdrawal parameters and requests PIN verification
  const handleCashOut = async (e) => {
    e.preventDefault();
    if (!depositAmount || isNaN(depositAmount)) return;
    if (!withdrawRecipient || !withdrawRecipient.startsWith("G") || withdrawRecipient.length !== 56) {
      showFeedback("error", "Please enter a valid Stellar public address (starts with G).");
      return;
    }

    const amount = parseFloat(depositAmount);
    if (shieldedBalances[selectedAsset] < amount) {
      showFeedback("error", "Insufficient balance to cash out.");
      return;
    }

    setConfirmPinInput("");
    setShowPinConfirm(true);
  };

  // Executes withdrawal after PIN has been verified
  const executeWithdrawal = async (derivedKeys) => {
    setLoading(true);
    setStatusMessage("Preparing withdrawal...");

    try {
      const amount = parseFloat(depositAmount);
      const tokenAddress = TOKENS[selectedAsset];

      const spentNotes = shieldedNotes.filter(n => n.tokenAddress === tokenAddress);
      if (spentNotes.length === 0) {
        showFeedback("error", "No available bills to cash out.");
        setLoading(false);
        return;
      }

      // Sort notes descending (largest first) to find the best match
      const sortedNotes = [...spentNotes].sort((a, b) => b.amount - a.amount);

      let remainingAmount = amount;
      const txSteps = [];
      let currentInputNotes = [];
      let currentInputSum = 0;

      for (const note of sortedNotes) {
        currentInputNotes.push(note);
        currentInputSum += note.amount;

        if (currentInputNotes.length === 2 || currentInputSum >= remainingAmount) {
          const stepSpend = Math.min(currentInputSum, remainingAmount);
          txSteps.push({
            inputs: currentInputNotes,
            spendAmount: stepSpend,
            inputSum: currentInputSum
          });
          remainingAmount -= stepSpend;

          currentInputNotes = [];
          currentInputSum = 0;

          if (remainingAmount <= 0.0001) {
            break;
          }
        }
      }

      if (remainingAmount > 0.0001) {
        showFeedback("error", "Insufficient balance to execute withdrawal.");
        setLoading(false);
        return;
      }

      setShowingZkLoader(true);

      const totalSteps = txSteps.length;
      let stepIndex = 0;
      let lastTxHash = "";

      for (const step of txSteps) {
        stepIndex++;
        const input1 = step.inputs[0];
        const input2 = step.inputs[1] || null;

        const spendAmount = step.spendAmount;
        const changeAmount = step.inputSum - spendAmount;

        const spendRoot = input1.root;
        if (!spendRoot) {
          throw new Error("No Merkle root found for one of the selected private notes.");
        }

        // Setup unique dummy note parameters if input2 is null (single note spend) to prevent nullifier collision
        let secret2Hex = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
        const dummyOwner = derivedKeys.viewing.publicKey;
        let commitment2Hex = await calculateCommitment(0, dummyOwner, tokenAddress, secret2Hex);

        if (input2) {
          secret2Hex = input2.secret;
          commitment2Hex = input2.commitment;
        }

        setZkProgress(`Processing withdrawal ${stepIndex}/${totalSteps}: Generating zero-knowledge withdrawal proof...`);

        let changeCommitmentHex = "0000000000000000000000000000000000000000000000000000000000000000";
        let changeEncryptedHex = "00";
        let changeSecret = "";

        if (changeAmount > 0.0001) {
          changeSecret = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
          changeCommitmentHex = await calculateCommitment(changeAmount, derivedKeys.viewing.publicKey, tokenAddress, changeSecret);

          const changeEncrypted = encryptNote(
            changeAmount,
            selectedAsset,
            changeSecret,
            userProfile.username,
            derivedKeys.viewing.publicKey
          );
          changeEncryptedHex = changeEncrypted.ephemeralPublicKey + changeEncrypted.nonce + changeEncrypted.ciphertext;
        }

        // Generate 2-in-2 ZK proof
        const zkData = await generateShieldedPaymentProof(
          input1.secret,
          input1.commitment,
          secret2Hex,
          commitment2Hex,
          withdrawRecipient,
          tokenAddress,
          spendAmount,
          changeAmount,
          (msg) => setZkProgress(`Withdrawal ${stepIndex}/${totalSteps}: ${msg}`)
        );

        setZkProgress(`Withdrawal ${stepIndex}/${totalSteps}: Submitting transaction via Relayer...`);

        // Submit withdrawal with change to Relayer using dual nullifiers
        const relayerRes = await fetch(`${BACKEND_URL}/api/relayer/withdraw`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            proof: zkData.proofHex,
            nullifier_1: zkData.nullifier1Hex,
            nullifier_2: zkData.nullifier2Hex,
            recipient: withdrawRecipient,
            token: tokenAddress,
            amount: spendAmount,
            root: spendRoot,
            change_commitment: changeCommitmentHex,
            encrypted_change_note: changeEncryptedHex
          })
        });

        if (!relayerRes.ok) {
          const errData = await relayerRes.json();
          throw new Error(errData.error || `Relayer failed to process withdrawal step ${stepIndex}.`);
        }

        const relayerData = await relayerRes.json();
        lastTxHash = relayerData.hash;

        await fetch(`${BACKEND_URL}/api/notes/spend`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ commitment: input1.commitment })
        });

        if (input2) {
          await fetch(`${BACKEND_URL}/api/notes/spend`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ commitment: input2.commitment })
          });
        }

        if (changeAmount > 0.0001) {
          await fetch(`${BACKEND_URL}/api/notes`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              commitment: changeCommitmentHex,
              token_address: tokenAddress,
              amount: changeAmount,
              encrypted_note: changeEncryptedHex,
              recipient_viewing_key: derivedKeys.viewing.publicKey
            })
          });
        }

        await logTransaction("Withdrawal", spendAmount, selectedAsset, withdrawRecipient, relayerData.hash);

        remainingAmount -= spendAmount;
      }

      setReceiptData({
        recipient: withdrawRecipient,
        amount: amount,
        asset: selectedAsset,
        hash: lastTxHash,
        timestamp: new Date().toLocaleTimeString(),
        type: "Withdrawal"
      });
      setDepositAmount("");
      setWithdrawRecipient("");
      triggerFlares();
      setShowSuccessModal(true);
      await loadWalletData();
    } catch (error) {
      console.error(error);
      showFeedback("error", error.message || "Withdrawal failed.");
    } finally {
      setLoading(false);
      setShowingZkLoader(false);
    }
  };

  // Synchronizes Starlit balances and queries the cache server for recent notes
  const loadWalletData = async (isSilent = false) => {
    if (!walletKeys || !userProfile) return;
    // Abort if a wallet synchronization operation is already in progress
    if (syncInProgressRef.current) return;
    syncInProgressRef.current = true;

    if (!isSilent) {
      setLoading(true);
      setStatusMessage("Syncing Starlit wallet...");
    }

    try {


      // Fetch transaction history
      const txsRes = await fetch(`${BACKEND_URL}/api/transactions/${userProfile.id}`);
      const txsData = await txsRes.json();
      const dbTxs = txsData.transactions || [];

      const decryptedTxs = [];
      const loggedCommitments = new Set();

      for (const tx of dbTxs) {
        const decryptedPayload = decryptSymmetrically(tx.encrypted_payload, walletKeys.viewing.secretKey);
        if (decryptedPayload) {
          const txObj = JSON.parse(decryptedPayload);
          decryptedTxs.push(txObj);
          if (txObj.commitment) {
            loggedCommitments.add(txObj.commitment);
          }
        }
      }

      // Fetch unspent commitments from backend database notes cache
      const notesRes = await fetch(`${BACKEND_URL}/api/notes/${walletKeys.viewing.publicKey}`);
      const notesData = await notesRes.json();
      const cachedNotes = notesData.notes || [];

      const decryptedNotes = [];
      const balanceSum = { XLM: 0, USDC: 0 };

      // Scan and decrypt all unspent cached commitments
      for (const note of cachedNotes) {
        const notePayload = {
          ephemeralPublicKey: note.encrypted_note.substring(0, 64),
          nonce: note.encrypted_note.substring(64, 112),
          ciphertext: note.encrypted_note.substring(112)
        };

        const decrypted = decryptNote(notePayload, walletKeys.viewing.secretKey);

        if (decrypted) {
          let tokenCode = "USDC";
          for (const [code, addr] of Object.entries(TOKENS)) {
            if (note.token_address === addr) {
              tokenCode = code;
            }
          }

          const parsedAmount = parseFloat(decrypted.amount);
          const noteRoot = note.root;

          // Add to balance immediately, even if pending indexer confirmation
          balanceSum[tokenCode] += parsedAmount;

          // Log received transaction if not already done
          if (decrypted.sender !== userProfile.username) {
            if (!loggedCommitments.has(note.commitment)) {
              const isDeposit = decrypted.sender === "deposit" || decrypted.sender.startsWith("G");
              const txType = isDeposit ? "Deposit" : "Deposited";
              await logTransaction(txType, parsedAmount, tokenCode, decrypted.sender, "", note.commitment);
              decryptedTxs.unshift({
                type: txType,
                amount: parsedAmount,
                asset: tokenCode,
                party: decrypted.sender,
                hash: "",
                commitment: note.commitment,
                timestamp: new Date(note.created_at).getTime()
              });
              loggedCommitments.add(note.commitment);
            }
          }

          // Track and check if we have already notified this commitment
          const alreadyNotified = notifiedCommitmentsRef.current.has(note.commitment);

          if (!alreadyNotified) {
            // Only trigger notifications if it is NOT the first load of the session
            if (!isFirstLoadRef.current && decrypted.sender !== userProfile.username) {
              showFeedback("success", `You received ${parsedAmount} ${tokenCode} from @${decrypted.sender}!`);

              // Triggers a native system alert popup
              if ("Notification" in window && Notification.permission === "granted") {
                new Notification("Payment Received", {
                  body: `You received ${parsedAmount} ${tokenCode} from @${decrypted.sender}!`,
                  icon: "/favicon.png"
                });
              }

              // Displays a temporary custom in-app frosted glass sliding card
              setInAppNotification({
                amount: parsedAmount,
                asset: tokenCode,
                sender: decrypted.sender
              });
              setTimeout(() => {
                setInAppNotification(null);
              }, 6000);
            }

            // Mark this commitment as notified/known
            notifiedCommitmentsRef.current.add(note.commitment);
          }

          if (!noteRoot) {
            console.log(`Note commitment ${note.commitment} is pending indexer confirmation...`);
            continue;
          }

          const decryptedNoteObj = {
            amount: parsedAmount,
            commitment: note.commitment,
            tokenAddress: note.token_address,
            sender: decrypted.sender,
            secret: decrypted.secret,
            root: noteRoot,
            created_at: note.created_at
          };
          decryptedNotes.push(decryptedNoteObj);
        }
      }

      // Mark the first load of the session as completed
      isFirstLoadRef.current = false;

      setShieldedNotes(decryptedNotes);
      setShieldedBalances(balanceSum);

      // Deduplicate recent transactions to handle database duplicates from network retries or tab concurrency
      const uniqueTxs = [];
      const seenTxKeys = new Set();
      for (const tx of decryptedTxs) {
        const key = `${tx.type}-${tx.amount}-${tx.asset}-${tx.party}-${tx.commitment || tx.hash}`;
        if (!seenTxKeys.has(key)) {
          seenTxKeys.add(key);
          uniqueTxs.push(tx);
        }
      }

      // Sort recent transactions by time descending
      uniqueTxs.sort((a, b) => b.timestamp - a.timestamp);
      setTransactions(uniqueTxs);
 
       // Cache decrypted notes, balances, and transactions for instant UI loads
       try {
         localStorage.setItem(`starlit_notes_${userProfile.id}`, JSON.stringify(decryptedNotes));
         localStorage.setItem(`starlit_balance_${userProfile.id}`, JSON.stringify(balanceSum));
         localStorage.setItem(`starlit_txs_${userProfile.id}`, JSON.stringify(uniqueTxs));
       } catch (e) {
         console.error("Failed to cache wallet data:", e);
       }

      // Populate Recently Contacted list from transaction history
      const recentUsernames = [];
      const seenUsernames = new Set();

      for (const tx of uniqueTxs) {
        const party = tx.party;
        if (
          party &&
          party !== "deposit" &&
          !party.startsWith("G") &&
          party.toLowerCase() !== userProfile.username.toLowerCase()
        ) {
          const lowerParty = party.toLowerCase();
          if (!seenUsernames.has(lowerParty)) {
            seenUsernames.add(lowerParty);
            recentUsernames.push(party);
          }
        }
        if (recentUsernames.length >= 10) break;
      }

      let recentContacts = [];
      if (recentUsernames.length > 0) {
        const { data: profiles } = await supabase
          .from("users")
          .select("username, display_name, avatar_url, stellar_address")
          .in("username", recentUsernames);

        if (profiles && profiles.length > 0) {
          const profileMap = new Map(profiles.map(p => [p.username.toLowerCase(), p]));
          for (const username of recentUsernames) {
            const profile = profileMap.get(username.toLowerCase());
            if (profile) {
              recentContacts.push(profile);
            }
          }
        }
      }

      // If we don't have enough recent contacts, fill the rest with registered users
      const { data: dbUsers } = await supabase
        .from("users")
        .select("username, display_name, avatar_url, stellar_address")
        .neq("username", userProfile.username)
        .limit(20);

      if (dbUsers && dbUsers.length > 0) {
        const existingUsernames = new Set(recentContacts.map(c => c.username.toLowerCase()));
        for (const user of dbUsers) {
          if (!existingUsernames.has(user.username.toLowerCase())) {
            recentContacts.push(user);
            existingUsernames.add(user.username.toLowerCase());
          }
          if (recentContacts.length >= 10) break;
        }
      }

      // Fallback to static users if database is empty/inaccessible
      if (recentContacts.length === 0) {
        recentContacts = [
          { username: "alice", display_name: "Alice Vance", avatar_url: "https://api.dicebear.com/7.x/bottts/svg?seed=alice" },
          { username: "bob", display_name: "Bob Stone", avatar_url: "https://api.dicebear.com/7.x/bottts/svg?seed=bob" },
          { username: "charlie", display_name: "Charlie Day", avatar_url: "https://api.dicebear.com/7.x/bottts/svg?seed=charlie" }
        ];
      }

      setContacts(recentContacts);
    } catch (error) {
      console.error(error);
      if (!isSilent) {
        showFeedback("error", "Error loading private shielded notes.");
      }
    } finally {
      // Clear the synchronization state lock on completion
      syncInProgressRef.current = false;
      if (!isSilent) {
        setLoading(false);
      }
    }
  };
  // Scan, select, and merge small fragmented private notes in the background
  const autoMergeNotes = async () => {
    if (loading || showingZkLoader || !walletKeys || !userProfile) return;

    // Group unspent notes by asset token address
    const tokenGroups = {};
    for (const note of shieldedNotes) {
      const token = note.tokenAddress;
      if (!tokenGroups[token]) tokenGroups[token] = [];
      tokenGroups[token].push(note);
    }

    // Merge notes if we have 3 or more for any token
    for (const [tokenAddress, notes] of Object.entries(tokenGroups)) {
      if (notes.length >= 3) {
        let tokenCode = "USDC";
        for (const [code, addr] of Object.entries(TOKENS)) {
          if (tokenAddress === addr) {
            tokenCode = code;
          }
        }

        // Sort ascending to merge the two smallest note values
        const sorted = [...notes].sort((a, b) => a.amount - b.amount);
        const note1 = sorted[0];
        const note2 = sorted[1];

        // Ensure both notes have valid Merkle roots confirmed before spending
        if (!note1.root || !note2.root) {
          continue;
        }

        console.log(`[Auto-Merge] Silently consolidating private ${tokenCode} notes: ${note1.amount} + ${note2.amount}`);

        try {
          // Generate key secrets for new merged note
          const mergedSecret = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
          const mergedAmount = note1.amount + note2.amount;
          const mergedCommitment = await calculateCommitment(mergedAmount, walletKeys.viewing.publicKey, tokenAddress, mergedSecret);

          // Encrypt the combined note back to our own viewing key
          const mergedEncrypted = encryptNote(
            mergedAmount,
            tokenCode,
            mergedSecret,
            "auto-merge",
            walletKeys.viewing.publicKey
          );
          const mergedEncryptedHex = mergedEncrypted.ephemeralPublicKey + mergedEncrypted.nonce + mergedEncrypted.ciphertext;

          // Generate unique dummy parameters for second output
          const dummySecret = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
          const dummyCommitment = await calculateCommitment(0, walletKeys.viewing.publicKey, tokenAddress, dummySecret);
          const dummyEncrypted = encryptNote(
            0,
            tokenCode,
            dummySecret,
            "auto-merge",
            walletKeys.viewing.publicKey
          );
          const dummyEncryptedHex = dummyEncrypted.ephemeralPublicKey + dummyEncrypted.nonce + dummyEncrypted.ciphertext;

          // Generate 2-in-2 ZK proof
          const zkData = await generateShieldedPaymentProof(
            note1.secret,
            note1.commitment,
            note2.secret,
            note2.commitment,
            walletKeys.stellar.publicKey,
            tokenAddress,
            mergedAmount,
            0,
            (msg) => console.log(`[Auto-Merge Proof] ${msg}`)
          );

          // Submit ZK transfer to relayer
          const relayerRes = await fetch(`${BACKEND_URL}/api/relayer/transfer`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              proof: zkData.proofHex,
              nullifier_1: zkData.nullifier1Hex,
              nullifier_2: zkData.nullifier2Hex,
              output_commitment_1: mergedCommitment,
              encrypted_note_1: mergedEncryptedHex,
              output_commitment_2: dummyCommitment,
              encrypted_note_2: dummyEncryptedHex,
              root: note1.root
            })
          });

          if (!relayerRes.ok) {
            const errData = await relayerRes.json();
            throw new Error(errData.error || "Relayer error during auto-merge");
          }

          const relayerData = await relayerRes.json();

          // Mark notes as spent
          await fetch(`${BACKEND_URL}/api/notes/spend`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ commitment: note1.commitment })
          });
          await fetch(`${BACKEND_URL}/api/notes/spend`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ commitment: note2.commitment })
          });

          // Register new merged note in backend note cache
          await fetch(`${BACKEND_URL}/api/notes`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              commitment: mergedCommitment,
              token_address: tokenAddress,
              amount: mergedAmount,
              encrypted_note: mergedEncryptedHex,
              recipient_viewing_key: walletKeys.viewing.publicKey
            })
          });

          console.log(`[Auto-Merge] Successfully consolidated notes! Tx hash: ${relayerData.hash}`);

          // Reload wallet silently to fetch new commitments
          await loadWalletData(true);
        } catch (err) {
          console.error("[Auto-Merge] Consolidating notes failed:", err.message);
        }

        // Limit to 1 merge transaction per polling interval to prevent sequence conflicts
        break;
      }
    }
  };

  // Trigger sync on login, instantly loading from localStorage cache if available
  useEffect(() => {
    if (authState === "logged-in") {
      const cachedNotes = localStorage.getItem(`starlit_notes_${userProfile.id}`);
      const cachedBalance = localStorage.getItem(`starlit_balance_${userProfile.id}`);
      const cachedTxs = localStorage.getItem(`starlit_txs_${userProfile.id}`);

      let hasCache = false;
      if (cachedNotes && cachedBalance && cachedTxs) {
        try {
          setShieldedNotes(JSON.parse(cachedNotes));
          setShieldedBalances(JSON.parse(cachedBalance));
          setTransactions(JSON.parse(cachedTxs));
          hasCache = true;
        } catch (e) {
          console.error("Failed to load cached wallet state:", e);
        }
      }

      // Sync wallet (silently in background if we have local cache, otherwise show active spinner)
      loadWalletData(hasCache).then(() => {
        autoMergeNotes();
      });

      // Requests browser permission for native operating system notifications
      if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission();
      }

      const interval = setInterval(() => {
        loadWalletData(true).then(() => {
          autoMergeNotes();
        });
      }, 15000);

      return () => clearInterval(interval);
    }
  }, [authState, walletKeys]);



  // Action: Pay another user directly (ZK-proof note spending to their funding account)
  // Initiates direct send flow by triggering PIN verification
  const handleSendSubmit = (e) => {
    if (e) e.preventDefault();
    if (!sendAmount || !sendRecipient) {
      showFeedback("error", "Please enter a recipient and amount.");
      return;
    }
    setShowPinConfirm(true);
    setConfirmPinInput("");
  };

  // Verifies the user PIN and executes the shielded payment on success
  const handlePinConfirmSubmit = async (enteredPin) => {
    setLoading(true);
    setStatusMessage("Verifying PIN...");

    try {
      const derived = await deriveKeysFromEmailAndPin(email, enteredPin);
      if (derived.spendingKey !== userProfile.identity_commitment) {
        showFeedback("error", "Incorrect confirmation PIN.");
        setConfirmPinInput("");
        setLoading(false);
        return;
      }

      setShowPinConfirm(false);
      setConfirmPinInput("");

      if (walletAction === "out") {
        await executeWithdrawal(derived);
      } else {
        await executeSendPayment(derived);
      }
    } catch (err) {
      console.error(err);
      showFeedback("error", "Verification failed: " + err.message);
      setLoading(false);
    }
  };

  // Resolves keys, generates ZK proofs, and submits shielded transfer payload via Relayer
  const executeSendPayment = async (derivedKeys) => {
    setLoading(true);
    setStatusMessage("Resolving recipient details...");

    try {
      const amount = parseFloat(sendAmount);
      const tokenAddress = TOKENS[selectedAsset];

      if (sendRecipient.startsWith("G") && sendRecipient.length === 56) {
        showFeedback("error", "To send directly to a Stellar address (EOA), please use the 'Withdraw' action instead.");
        setLoading(false);
        return;
      }

      let recipientStellarAddress = "";
      let recipientUsernameResolved = sendRecipient;
      let recipientViewingKey = null;

      const lookupResponse = await fetch(`${BACKEND_URL}/api/users/lookup/${sendRecipient}`);
      if (lookupResponse.status === 404) {
        showFeedback("error", "Recipient username not found.");
        setLoading(false);
        return;
      }
      const lookupData = await lookupResponse.json();
      const recipientKeys = lookupData.user;

      if (!recipientKeys.stellar_address) {
        showFeedback("error", "Recipient has not registered their Stellar account.");
        setLoading(false);
        return;
      }
      recipientStellarAddress = recipientKeys.stellar_address;
      recipientViewingKey = recipientKeys.public_encryption_key;

      if (shieldedBalances[selectedAsset] < amount) {
        showFeedback("error", "Insufficient balance to execute payment.");
        setLoading(false);
        return;
      }

      const spentNotes = shieldedNotes.filter(n => n.tokenAddress === tokenAddress);
      if (spentNotes.length === 0) {
        showFeedback("error", "No available bills found for this asset.");
        setLoading(false);
        return;
      }

      // Sort notes descending (largest first) to find the best match
      const sortedNotes = [...spentNotes].sort((a, b) => b.amount - a.amount);

      let remainingAmount = amount;
      const txSteps = [];
      let currentInputNotes = [];
      let currentInputSum = 0;

      for (const note of sortedNotes) {
        currentInputNotes.push(note);
        currentInputSum += note.amount;

        if (currentInputNotes.length === 2 || currentInputSum >= remainingAmount) {
          const stepSpend = Math.min(currentInputSum, remainingAmount);
          txSteps.push({
            inputs: currentInputNotes,
            spendAmount: stepSpend,
            inputSum: currentInputSum
          });
          remainingAmount -= stepSpend;

          currentInputNotes = [];
          currentInputSum = 0;

          if (remainingAmount <= 0.0001) {
            break;
          }
        }
      }

      if (remainingAmount > 0.0001) {
        showFeedback("error", "Insufficient balance to execute payment.");
        setLoading(false);
        return;
      }

      setShowingZkLoader(true);

      const totalSteps = txSteps.length;
      let stepIndex = 0;
      let lastTxHash = "";

      for (const step of txSteps) {
        stepIndex++;
        const input1 = step.inputs[0];
        const input2 = step.inputs[1] || null;

        const spendAmount = step.spendAmount;
        const changeAmount = step.inputSum - spendAmount;

        const spendRoot = input1.root;
        if (!spendRoot) {
          throw new Error("No Merkle root found for one of the selected private notes.");
        }

        // Setup unique dummy note parameters if input2 is null (single note spend) to prevent nullifier collision
        let secret2Hex = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
        const dummyOwner = walletKeys.viewing.publicKey;
        let commitment2Hex = await calculateCommitment(0, dummyOwner, tokenAddress, secret2Hex);

        if (input2) {
          secret2Hex = input2.secret;
          commitment2Hex = input2.commitment;
        }

        if (recipientViewingKey) {
          setZkProgress(`Processing payment ${stepIndex}/${totalSteps}: Generating zero-knowledge transfer proof...`);

          const recipientSecret = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
          const recipientCommitmentHex = await calculateCommitment(spendAmount, recipientViewingKey, tokenAddress, recipientSecret);
          const recipientEncrypted = encryptNote(
            spendAmount,
            selectedAsset,
            recipientSecret,
            userProfile.username,
            recipientViewingKey
          );
          const recipientEncryptedHex = recipientEncrypted.ephemeralPublicKey + recipientEncrypted.nonce + recipientEncrypted.ciphertext;

          let changeCommitmentHex = "0000000000000000000000000000000000000000000000000000000000000000";
          let changeEncryptedHex = "00";
          let changeSecret = "";

          if (changeAmount > 0.0001) {
            changeSecret = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
            changeCommitmentHex = await calculateCommitment(changeAmount, walletKeys.viewing.publicKey, tokenAddress, changeSecret);
            const changeEncrypted = encryptNote(
              changeAmount,
              selectedAsset,
              changeSecret,
              userProfile.username,
              walletKeys.viewing.publicKey
            );
            changeEncryptedHex = changeEncrypted.ephemeralPublicKey + changeEncrypted.nonce + changeEncrypted.ciphertext;
          }

          // Generate 2-in-2 proof using zk.js
          const zkData = await generateShieldedPaymentProof(
            input1.secret,
            input1.commitment,
            secret2Hex,
            commitment2Hex,
            recipientStellarAddress,
            tokenAddress,
            spendAmount,
            changeAmount,
            (msg) => setZkProgress(`Payment ${stepIndex}/${totalSteps}: ${msg}`)
          );

          setZkProgress(`Payment ${stepIndex}/${totalSteps}: Submitting transfer through Relayer...`);

          const relayerRes = await fetch(`${BACKEND_URL}/api/relayer/transfer`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              proof: zkData.proofHex,
              nullifier_1: zkData.nullifier1Hex,
              nullifier_2: zkData.nullifier2Hex,
              output_commitment_1: recipientCommitmentHex,
              encrypted_note_1: recipientEncryptedHex,
              output_commitment_2: changeCommitmentHex,
              encrypted_note_2: changeEncryptedHex,
              root: spendRoot
            })
          });

          if (!relayerRes.ok) {
            const errData = await relayerRes.json();
            throw new Error(errData.error || `Relayer failed to process transfer step ${stepIndex}.`);
          }

          const relayerData = await relayerRes.json();
          lastTxHash = relayerData.hash;

          await fetch(`${BACKEND_URL}/api/notes/spend`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ commitment: input1.commitment })
          });

          if (input2) {
            await fetch(`${BACKEND_URL}/api/notes/spend`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ commitment: input2.commitment })
            });
          }

          await fetch(`${BACKEND_URL}/api/notes`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              commitment: recipientCommitmentHex,
              token_address: tokenAddress,
              amount: spendAmount,
              encrypted_note: recipientEncryptedHex,
              recipient_viewing_key: recipientViewingKey
            })
          });

          if (changeAmount > 0.0001) {
            await fetch(`${BACKEND_URL}/api/notes`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                commitment: changeCommitmentHex,
                token_address: tokenAddress,
                amount: changeAmount,
                encrypted_note: changeEncryptedHex,
                recipient_viewing_key: walletKeys.viewing.publicKey
              })
            });
          }

          await logTransaction("Sent", spendAmount, selectedAsset, recipientUsernameResolved, relayerData.hash, recipientCommitmentHex);
        } else {
          setZkProgress(`Processing payment ${stepIndex}/${totalSteps}: Generating zero-knowledge withdrawal proof...`);

          const zkData = await generateShieldedPaymentProof(
            input1.secret,
            input1.commitment,
            secret2Hex,
            commitment2Hex,
            walletKeys.stellar.publicKey,
            tokenAddress,
            spendAmount,
            changeAmount,
            (msg) => setZkProgress(`Payment ${stepIndex}/${totalSteps}: ${msg}`)
          );

          setZkProgress(`Payment ${stepIndex}/${totalSteps}: Withdrawing note through Relayer...`);

          const relayerRes = await fetch(`${BACKEND_URL}/api/relayer/withdraw`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              proof: zkData.proofHex,
              nullifier_1: zkData.nullifier1Hex,
              nullifier_2: zkData.nullifier2Hex,
              recipient: walletKeys.stellar.publicKey,
              token: tokenAddress,
              amount: spendAmount,
              root: spendRoot,
              change_commitment: changeCommitmentHex,
              encrypted_change_note: changeEncryptedHex
            })
          });

          if (!relayerRes.ok) {
            const errData = await relayerRes.json();
            throw new Error(errData.error || `Relayer failed to process withdrawal step ${stepIndex}.`);
          }

          const relayerData = await relayerRes.json();
          lastTxHash = relayerData.hash;

          await fetch(`${BACKEND_URL}/api/notes/spend`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ commitment: input1.commitment })
          });

          if (input2) {
            await fetch(`${BACKEND_URL}/api/notes/spend`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ commitment: input2.commitment })
            });
          }

          setZkProgress(`Payment ${stepIndex}/${totalSteps}: Transferring public payment to recipient address...`);

          await sendPublicPayment(
            walletKeys.stellar.keypair,
            recipientStellarAddress,
            spendAmount,
            selectedAsset,
            selectedAsset === "XLM" ? null : tokenAddress
          );

          await logTransaction("Sent", spendAmount, selectedAsset, recipientUsernameResolved, relayerData.hash);
        }

        remainingAmount -= spendAmount;
      }

      setReceiptData({
        recipient: recipientUsernameResolved,
        amount: amount,
        asset: selectedAsset,
        hash: lastTxHash,
        timestamp: new Date().toLocaleTimeString(),
        type: "Send"
      });
      setSendAmount("");
      setSendRecipient("");
      triggerFlares();
      setShowSuccessModal(true);
      await loadWalletData();
    } catch (error) {
      console.error(error);
      showFeedback("error", error.message || "Shielded payment failed.");
    } finally {
      setLoading(false);
      setShowingZkLoader(false);
    }
  };

  // Creates a database request record representing a pending payment link
  const handleCreatePaymentLink = async (e) => {
    if (e) e.preventDefault();
    if (!depositAmount || isNaN(depositAmount)) return;

    setLoading(true);
    setStatusMessage("Creating request payment link...");

    try {
      const amount = parseFloat(depositAmount);
      const commitment = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));

      const descriptionObj = {
        recipientAddress: DEPOSIT_GATEWAY_ADDRESS,
        recipientMemo: userProfile.deposit_memo,
        username: userProfile.username
      };

      const res = await fetch(`${BACKEND_URL}/api/payment-links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creator_id: userProfile.id,
          amount,
          asset: selectedAsset,
          commitment,
          description: JSON.stringify(descriptionObj)
        })
      });

      if (!res.ok) {
        throw new Error("Failed to register payment request link.");
      }

      const shareable = `${window.location.origin}/#/pay-request/${commitment}`;
      setGeneratedLink(shareable);
      setDepositAmount("");
      showFeedback("success", "Payment request link generated successfully!");
      await loadWalletData();
    } catch (err) {
      console.error(err);
      showFeedback("error", err.message || "Failed to create payment request link.");
    } finally {
      setLoading(false);
    }
  };




  // Connects external wallets via Stellar Wallets Kit and saves connection state
  const handleConnectWalletOnly = async () => {
    if (!payRequestDetails) return;

    setLoading(true);
    setStatusMessage("Opening wallet selector...");

    try {
      await connectWithWalletKit({
        onConnect: async (address, walletId, walletName) => {
          setConnectedWalletAddress(address);
          setConnectedWalletName(walletName);
          showFeedback("success", `Connected to ${walletName}!`);
          setLoading(false);
        },
        onError: (err) => {
          console.error("Stellar Wallets Kit connection error:", err);
          showFeedback("error", err.message || "Failed to connect wallet.");
          setLoading(false);
        }
      });
    } catch (error) {
      console.error("Stellar Wallets Kit error:", error);
      showFeedback("error", "Failed to open wallet selector: " + error.message);
      setLoading(false);
    }
  };

  // Signs the transaction XDR using the connected wallet and submits it to the Stellar network
  const handlePayInvoiceWithWallet = async () => {
    if (!payRequestDetails || !connectedWalletAddress) return;

    setLoading(true);
    setPayStep("loading");
    setStatusMessage("Verifying invoice...");

    try {
      // Check if the payment request is still valid and not expired
      const checkRes = await fetch(`${BACKEND_URL}/api/payment-links/${payRequestDetails.commitment}`);
      if (!checkRes.ok) {
        const checkData = await checkRes.json();
        throw new Error(checkData.error || "This payment request is no longer valid.");
      }

      setStatusMessage("Preparing payment transaction...");
      const xdr = await buildPublicPaymentTxXdr(
        connectedWalletAddress,
        payRequestDetails.recipientAddress,
        payRequestDetails.amount,
        payRequestDetails.asset,
        TOKENS[payRequestDetails.asset],
        payRequestDetails.recipientMemo
      );

      setStatusMessage(`Please sign the transaction in ${connectedWalletName || "your wallet"}...`);
      const signedXdr = await signWithWalletKit(xdr, connectedWalletAddress);
      if (!signedXdr) {
        throw new Error("User rejected or failed transaction signing.");
      }

      setStatusMessage("Submitting transaction to Stellar Network...");
      await submitSignedXdr(signedXdr);

      await supabase
        .from("payment_links")
        .update({ status: "claimed" })
        .eq("commitment", payRequestDetails.commitment);

      setPayStep("success");
      showFeedback("success", "Payment request paid successfully!");
    } catch (error) {
      console.error("Wallet payment error:", error);
      showFeedback("error", "Payment failed: " + error.message);
      setPayStep("details");
    } finally {
      setLoading(false);
    }
  };



  // Handles decimal and digit inputs from keypad
  const handleKeypadPress = (val) => {
    if (showPinConfirm) {
      setConfirmPinInput(prev => {
        if (val === "⌫") {
          return prev.slice(0, -1);
        }
        if (val === ".") return prev;
        if (prev.length >= 6) return prev;
        const next = prev + val;
        if (next.length === 6) {
          setTimeout(() => handlePinConfirmSubmit(next), 100);
        }
        return next;
      });
      return;
    }

    setSendAmount(prev => {
      if (val === "⌫") {
        return prev.slice(0, -1);
      }
      if (val === ".") {
        if (prev === "") return "0.";
        if (prev.includes(".")) return prev;
        return prev + ".";
      }
      if (prev === "0") {
        return val;
      }
      if (prev.includes(".")) {
        const parts = prev.split(".");
        if (parts[1] && parts[1].length >= 2) {
          return prev;
        }
      }
      return prev + val;
    });
  };

  // Helpers
  const showFeedback = (type, message) => {
    setFeedback({ type, message });
    setTimeout(() => setFeedback({ type: "", message: "" }), 5000);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    handleLogoutState();
  };


  // --- RENDERS ---



  if (currentTab === "pay-request") {
    return (
      <div className="container" style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "80vh" }}>
        {showingZkLoader && (
          <div className="proving-overlay">
            <div className="proving-card">
              <div className="spinner"></div>
              <h2 style={{ fontSize: "20px", fontWeight: "600", marginBottom: "12px" }}>Processing Payment</h2>
              <p style={{ fontFamily: "var(--font-mono)", fontSize: "14px", color: "var(--text-muted)" }}>{zkProgress}</p>
            </div>
          </div>
        )}



        <div className="glass-panel" style={{ position: "relative", width: "100%", maxWidth: "440px", padding: "32px" }}>
          {connectedWalletAddress && (
            <div style={{
              position: "absolute",
              top: "16px",
              left: "20px",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid var(--border-color)",
              padding: "4px 8px",
              borderRadius: "20px",
              fontSize: "12px",
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono)"
            }}>
              <span style={{ display: "inline-block", width: "6px", height: "6px", borderRadius: "50%", background: "#10B981" }} />
              {connectedWalletAddress.slice(0, 4)}...{connectedWalletAddress.slice(-4)}
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", marginBottom: "24px" }}>
            <img src={symbol} alt="Starlit Pay Logo" style={{ height: "36px", width: "auto" }} />
            <span style={{ fontSize: "24px", fontWeight: "800", color: "var(--text-primary)" }}>Starlit Pay</span>
          </div>
          {payStep === "loading" && (
            <div style={{ textAlign: "center" }}>
              <div className="spinner"></div>
              <p style={{ color: "var(--text-muted)" }}>Loading payment request details...</p>
            </div>
          )}

          {payStep === "error" && (
            <div style={{ textAlign: "center" }}>
              <AlertCircle size={48} style={{ color: "var(--error-color)", marginBottom: "16px" }} />
              <h2 style={{ fontSize: "20px", fontWeight: "600", marginBottom: "10px" }}>Invalid Request</h2>
              <p style={{ color: "var(--text-muted)", marginBottom: "24px", fontSize: "14px" }}>{statusMessage}</p>
              <button onClick={() => { window.location.hash = "dashboard"; setCurrentTab("home"); }} className="btn-secondary" style={{ width: "100%" }}>
                Go to Home
              </button>
            </div>
          )}

          {payStep === "success" && (
            <div style={{ textAlign: "center" }}>
              <CheckCircle size={48} style={{ color: "var(--primary-accent)", marginBottom: "16px" }} />
              <h2 style={{ fontSize: "20px", fontWeight: "600", marginBottom: "10px" }}>Payment Successful</h2>
              <p style={{ color: "var(--text-muted)", marginBottom: "24px", fontSize: "14px" }}>
                You have successfully paid @{payRequestDetails?.recipientUsername || "recipient"}.
              </p>
              <button onClick={() => { window.location.hash = "dashboard"; setCurrentTab("home"); }} className="btn-primary" style={{ width: "100%" }}>
                Go to Home
              </button>
            </div>
          )}

          {payStep === "details" && payRequestDetails && (
            <div>
              <div style={{ textAlign: "center", marginBottom: "24px" }}>
                <h2 style={{ fontSize: "20px", fontWeight: "600" }}>Pay Invoice Request</h2>
                <p style={{ color: "var(--text-muted)", fontSize: "14px", marginTop: "4px" }}>
                  Requested by <span style={{ color: "white", fontWeight: "600" }}>@{payRequestDetails.recipientUsername}</span>
                </p>
              </div>

              {secondsLeft !== null && (
                <div
                  className={secondsLeft < 60 ? "animate-pulse-red" : ""}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "8px",
                    marginBottom: "16px",
                    background: secondsLeft < 60 ? "rgba(255, 59, 48, 0.1)" : "rgba(255, 255, 255, 0.03)",
                    border: `1px solid ${secondsLeft < 60 ? "rgba(255, 59, 48, 0.3)" : "var(--border-color)"}`,
                    borderRadius: "12px",
                    padding: "10px",
                    color: secondsLeft < 60 ? "var(--error-color)" : "white"
                  }}
                >
                  <RefreshCw size={14} className={secondsLeft < 60 ? "" : "animate-spin"} />
                  <span style={{ fontSize: "13px", fontWeight: "500" }}>
                    Request expires in: <strong style={{ fontFamily: "var(--font-mono)", fontSize: "14px" }}>{formatTimeLeft(secondsLeft)}</strong>
                  </span>
                </div>
              )}

              <div className="glass-card" style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "24px", textAlign: "center", background: "#1C1C22" }}>
                <div>
                  <span style={{ fontSize: "12px", color: "var(--text-muted)", textTransform: "uppercase" }}>Amount Due</span>
                  <div style={{ fontSize: "32px", fontWeight: "700", color: "white", marginTop: "4px" }}>
                    {payRequestDetails.amount} <span style={{ color: "var(--primary-accent)" }}>{payRequestDetails.asset}</span>
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {!connectedWalletAddress ? (
                    <button
                      onClick={handleConnectWalletOnly}
                      className="btn-primary"
                      style={{
                        width: "100%",
                        fontSize: "14px",
                        padding: "12px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "8px"
                      }}
                    >
                      <Globe size={18} style={{ color: "white" }} />
                      Connect Wallet to Pay
                    </button>
                  ) : (
                    <button
                      onClick={handlePayInvoiceWithWallet}
                      className="btn-primary"
                      style={{
                        width: "100%",
                        fontSize: "14px",
                        padding: "12px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "8px"
                      }}
                    >
                      <Lock size={18} style={{ color: "white" }} />
                      Sign Transaction
                    </button>
                  )}
                </div>

                <button
                  onClick={() => { window.location.hash = "dashboard"; setCurrentTab("home"); }}
                  className="btn-secondary"
                  style={{ width: "100%", padding: "10px", fontSize: "14px" }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (authState === "landing") {
    return <Landing scrollY={scrollY} setAuthState={setAuthState} theme={theme} toggleTheme={toggleTheme} logo={logo} symbol={symbol} />;
  }

  if (authState !== "logged-in") {
    return (
      <Auth
        authState={authState}
        setAuthState={setAuthState}
        email={email}
        setEmail={setEmail}
        pin={pin}
        setPin={setPin}
        pinConfirm={pinConfirm}
        setPinConfirm={setPinConfirm}
        username={username}
        setUsername={setUsername}
        userProfile={userProfile}
        loading={loading}
        feedback={feedback}
        handleEmailSubmit={handleEmailSubmit}
        handleGoogleLogin={handleGoogleLogin}
        handlePinSetup={handlePinSetup}
        handleRegisterProfile={handleRegisterProfile}
        handlePinSubmit={handlePinSubmit}
        handleLogout={handleLogout}
        theme={theme}
        toggleTheme={toggleTheme}
        logo={logo}
        symbol={symbol}
      />
    );
  }

  return (
    <div className="app-fullscreen">
      {/* Global Floating Toast Feedback Banner */}
      {feedback.message && (
        <div style={{
          position: "fixed",
          top: "24px",
          right: "24px",
          display: "flex",
          alignItems: "center",
          gap: "12px",
          padding: "16px 24px",
          borderRadius: "16px",
          border: `1px solid ${feedback.type === "error" ? "var(--error-color)" : "var(--primary-accent)"}`,
          background: feedback.type === "error" ? "rgba(244, 63, 94, 0.95)" : "rgba(139, 92, 246, 0.95)",
          boxShadow: "0 20px 40px -15px rgba(0, 0, 0, 0.5), 0 10px 15px -10px rgba(0, 0, 0, 0.5)",
          color: "#ffffff",
          zIndex: 9999,
          backdropFilter: "blur(12px)",
          minWidth: "300px",
          maxWidth: "450px",
          animation: "slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1 }}>
            {feedback.type === "error" ? (
              <AlertCircle size={20} style={{ color: "#ffffff", flexShrink: 0 }} />
            ) : (
              <CheckCircle size={20} style={{ color: "#ffffff", flexShrink: 0 }} />
            )}
            <span style={{ fontSize: "14px", fontWeight: "600", lineHeight: "1.4" }}>
              {feedback.message}
            </span>
          </div>
          <button
            onClick={() => setFeedback({ type: "", message: "" })}
            style={{
              background: "none",
              border: "none",
              color: "rgba(255,255,255,0.7)",
              cursor: "pointer",
              fontSize: "16px",
              padding: "4px 0 4px 12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              alignSelf: "flex-start"
            }}
          >
            ✕
          </button>
        </div>
      )}
      {/* Renders the top sliding push notification toast banner when active */}
      {inAppNotification && (
        <div className="in-app-toast-container">
          <div className="in-app-toast">
            <div className="in-app-toast-icon">
              <Coins size={20} />
            </div>
            <div className="in-app-toast-body">
              <h4>Payment Received</h4>
              <p>@{inAppNotification.sender} sent you {inAppNotification.amount} {inAppNotification.asset}</p>
            </div>
            <button onClick={() => setInAppNotification(null)} className="in-app-toast-close">✕</button>
          </div>
        </div>
      )}

      {/* Proving overlay for ZK proving status updates */}
      {showingZkLoader && (
        <div className="proving-overlay">
          <div className="proving-card">
            <div className="spinner"></div>
            <h2 style={{ fontSize: "20px", fontWeight: "700", marginBottom: "20px", color: "#ffffff" }}>Transaction in Progress</h2>
            <div className="progress-bar-container">
              <div
                className="progress-bar-fill"
                style={{
                  width: zkProgress.toLowerCase().includes("proof") ? "65%" :
                    zkProgress.toLowerCase().includes("relayer") || zkProgress.toLowerCase().includes("submit") ? "85%" :
                      zkProgress.toLowerCase().includes("witness") ? "30%" : "15%",
                  transition: "width 0.5s cubic-bezier(0.4, 0, 0.2, 1)"
                }}
              ></div>
            </div>
          </div>
        </div>
      )}

      {/* Transaction validation confirmation overlay */}
      {showPinConfirm && (
        <div className="proving-overlay" style={{ zIndex: 1100 }}>
          <div className="proving-card" style={{ maxWidth: "400px" }}>
            <Lock size={32} style={{ color: "var(--primary-accent)", marginBottom: "16px", margin: "0 auto" }} />
            <h2 style={{ fontSize: "22px", fontWeight: "700", marginBottom: "8px", color: "#ffffff" }}>Confirm PIN</h2>
            <p style={{ color: "var(--text-muted)", fontSize: "14px", marginBottom: "24px" }}>
              Enter your 6-digit PIN to authorize sending {sendAmount} {selectedAsset} to @{sendRecipient}
            </p>

            <div className="pin-dots">
              {[0, 1, 2, 3, 4, 5].map((idx) => (
                <div
                  key={idx}
                  className={`pin-dot ${confirmPinInput.length > idx ? "active" : ""}`}
                />
              ))}
            </div>

            <input
              type="password"
              maxLength={6}
              placeholder="******"
              value={confirmPinInput}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, "");
                setConfirmPinInput(val);
              }}
              autoFocus
              style={{
                textAlign: "center",
                letterSpacing: "12px",
                fontSize: "28px",
                padding: "16px",
                background: "rgba(255, 255, 255, 0.03)",
                border: "1px solid var(--border-color)",
                borderRadius: "16px",
                color: "white",
                width: "100%",
                marginBottom: "24px",
                outline: "none"
              }}
            />

            <div style={{ display: "flex", gap: "12px", width: "100%" }}>
              <button
                onClick={() => handlePinConfirmSubmit(confirmPinInput)}
                className="btn-primary"
                disabled={confirmPinInput.length !== 6 || loading}
                style={{ flex: 1, padding: "14px" }}
              >
                {loading ? "Processing..." : "Confirm"}
              </button>
              <button
                onClick={() => { setShowPinConfirm(false); setConfirmPinInput(""); }}
                className="btn-secondary"
                style={{ flex: 1, padding: "14px" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success Animation & Flares Overlay */}
      {showSuccessModal && (
        <div className="proving-overlay" style={{ zIndex: 1200 }}>
          <div className="proving-card" style={{ maxWidth: "380px", padding: "32px", textAlign: "center", overflow: "hidden", position: "relative" }}>

            {/* Flare Animation Particles */}
            <div className="flare-container">
              {flareParticles.map(p => (
                <div
                  key={p.id}
                  className="flare-particle"
                  style={{
                    "--x": p.x,
                    "--y": p.y,
                    "--r": p.r,
                    backgroundColor: p.color,
                    width: p.size,
                    height: p.size,
                    borderRadius: p.borderRadius,
                    animationDelay: p.delay,
                    left: "-4px",
                    top: "-4px"
                  }}
                />
              ))}
            </div>

            <div style={{
              width: "72px",
              height: "72px",
              borderRadius: "50%",
              background: "rgba(16, 185, 129, 0.1)",
              border: "3px solid #10b981",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 24px",
              color: "#10b981",
              animation: "scaleUp 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)"
            }}>
              <Check size={40} />
            </div>

            <h2 style={{ fontSize: "24px", fontWeight: "800", color: "#ffffff", marginBottom: "12px" }}>Transaction Complete</h2>
            <p style={{ color: "var(--text-muted)", fontSize: "14px", marginBottom: "32px", lineHeight: "1.5" }}>
              Your transaction has been successfully validated and processed on the blockchain.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <button
                onClick={() => {
                  setShowSuccessModal(false);
                  setShowReceipt(true);
                }}
                className="btn-primary"
                style={{ width: "100%", padding: "14px", fontWeight: "600" }}
              >
                View Receipt
              </button>
              <button
                onClick={() => {
                  setShowSuccessModal(false);
                  setDashboardAction(null);
                  setWalletAction(null);
                  setCurrentTab("home");
                }}
                className="btn-secondary"
                style={{ width: "100%", padding: "12px", fontSize: "14px" }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transaction Receipt Modal */}
      {showReceipt && receiptData && (
        <div className="proving-overlay" style={{ zIndex: 1200 }}>
          <div className="proving-card" style={{ maxWidth: "400px", padding: "32px", textAlign: "center" }}>
            <div style={{
              width: "64px",
              height: "64px",
              borderRadius: "50%",
              background: "rgba(124, 58, 237, 0.1)",
              border: "2px solid var(--primary-accent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 20px",
              color: "var(--primary-accent)"
            }}>
              <Check size={36} />
            </div>

            <h2 style={{ fontSize: "22px", fontWeight: "800", color: "#ffffff", marginBottom: "8px" }}>
              {receiptData.type === "Withdrawal" ? "Withdrawal Complete" : "Payment Sent"}
            </h2>
            <p style={{ color: "var(--text-muted)", fontSize: "14px", marginBottom: "24px" }}>
              Your private transaction has been successfully processed
            </p>

            <div style={{
              background: "rgba(0, 0, 0, 0.2)",
              borderRadius: "16px",
              padding: "20px",
              border: "1px solid var(--border-color)",
              marginBottom: "24px",
              textAlign: "left"
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}>
                <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>
                  {receiptData.type === "Withdrawal" ? "To Address" : "To User"}
                </span>
                <span style={{
                  fontSize: "14px",
                  fontWeight: "700",
                  color: "#ffffff",
                  fontFamily: receiptData.type === "Withdrawal" ? "var(--font-mono)" : "inherit"
                }}>
                  {receiptData.type === "Withdrawal"
                    ? (receiptData.recipient.length > 20
                      ? `${receiptData.recipient.substring(0, 8)}...${receiptData.recipient.substring(receiptData.recipient.length - 8)}`
                      : receiptData.recipient)
                    : `@${receiptData.recipient}`}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}>
                <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>Amount</span>
                <span style={{ fontSize: "14px", fontWeight: "700", color: "#ffffff" }}>
                  {receiptData.amount} {receiptData.asset}
                </span>
              </div>
              {receiptData.asset === "XLM" && (
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}>
                  <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>Value</span>
                  <span style={{ fontSize: "13px", fontWeight: "600", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                    ≈ ${(receiptData.amount * prices.XLM).toFixed(2)} USDC
                  </span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}>
                <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>Date</span>
                <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>{receiptData.timestamp}</span>
              </div>
              <div style={{ borderTop: "1px solid rgba(255, 255, 255, 0.08)", paddingTop: "12px", marginTop: "12px" }}>
                <span style={{ fontSize: "11px", color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>Transaction Hash</span>
                <span style={{ fontSize: "11px", color: "var(--primary-accent)", fontFamily: "var(--font-mono)", wordBreak: "break-all" }}>
                  {receiptData.hash ? `${receiptData.hash.substring(0, 24)}...` : "Shielded Proof"}
                </span>
              </div>
            </div>

            <button
              onClick={() => {
                setShowReceipt(false);
                setDashboardAction(null);
                setWalletAction(null);
                setCurrentTab("home");
              }}
              className="btn-primary"
              style={{ width: "100%", padding: "14px" }}
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Mobile Profile Menu Modal */}
      {showProfileModal && (
        <div 
          className="proving-overlay" 
          style={{ zIndex: 2500 }}
          onClick={() => setShowProfileModal(false)}
        >
          <div 
            className="glass-card" 
            style={{ 
              width: "90%", 
              maxWidth: "380px", 
              background: theme === "light" ? "var(--card-bg)" : "rgba(20, 20, 30, 0.95)",
              border: "1px solid var(--border-color)",
              borderRadius: "24px",
              padding: "28px",
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              gap: "20px",
              position: "relative"
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button 
                onClick={() => setShowProfileModal(false)}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: "18px",
                  padding: 0
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
              <div
                onClick={() => {
                  setShowProfileModal(false);
                  triggerProfilePicSelect();
                }}
                style={{
                  width: "72px",
                  height: "72px",
                  borderRadius: "50%",
                  background: "var(--primary-accent)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#ffffff",
                  fontWeight: "700",
                  fontSize: "24px",
                  cursor: "pointer",
                  boxShadow: "0 8px 24px rgba(139, 92, 246, 0.25)",
                  position: "relative",
                  overflow: "hidden"
                }}
                title="Change Profile Picture"
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
                <div style={{
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  right: 0,
                  background: "rgba(0, 0, 0, 0.6)",
                  padding: "4px 0",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "9px",
                  color: "#ffffff"
                }}>
                  Change
                </div>
              </div>

              <div>
                <h3 style={{ fontSize: "18px", fontWeight: "700", color: "var(--text-primary)" }}>
                  {userProfile?.display_name || userProfile?.username}
                </h3>
                <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>
                  @{userProfile?.username}
                </span>
              </div>
            </div>

            <hr style={{ border: "none", borderTop: "1px solid var(--border-color)" }} />

            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(userProfile?.stellar_address || "");
                  showFeedback("success", "Stellar address copied!");
                  setShowProfileModal(false);
                }}
                className="btn-secondary"
                style={{ width: "100%", padding: "14px", fontSize: "14px", fontWeight: "600" }}
              >
                Copy Stellar Address
              </button>

              <button
                onClick={() => {
                  setShowProfileModal(false);
                  handleLogout();
                }}
                className="btn-primary"
                style={{ 
                  width: "100%", 
                  padding: "14px", 
                  fontSize: "14px", 
                  fontWeight: "600",
                  background: "linear-gradient(135deg, var(--error-color) 0%, #e11d48 100%)",
                  boxShadow: "0 4px 20px rgba(225, 29, 72, 0.25)"
                }}
              >
                Log Out
              </button>
            </div>
          </div>
        </div>
      )}

      {isMobile ? (
        <div className="mobile-viewport">
          <div className="mobile-content">
            {/* Header summary component displaying profile details */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <img src={symbol} alt="Starlit Pay Logo" style={{ height: "20px", width: "auto" }} />
                  <span style={{ fontSize: "14px", fontWeight: "700", color: "var(--text-primary)" }}>Starlit Pay</span>
                </div>
                <div 
                  onClick={() => setShowProfileModal(true)}
                  style={{ 
                    borderLeft: "1px solid var(--border-color)", 
                    height: "36px", 
                    paddingLeft: "12px", 
                    display: "flex", 
                    alignItems: "center", 
                    gap: "8px",
                    cursor: "pointer"
                  }}
                  title="View Profile Options"
                >
                  <div
                    className="mobile-avatar-container"
                    style={{
                      width: "32px",
                      height: "32px",
                      borderRadius: "50%",
                      background: "var(--primary-accent)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: "700",
                      fontSize: "12px",
                      color: "#FFFFFF",
                      position: "relative",
                      overflow: "hidden",
                      flexShrink: 0
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
                  </div>
                  <div>
                    <span style={{ fontSize: "9px", color: "var(--text-muted)", display: "block" }}>Welcome Back,</span>
                    <h3 style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-primary)", lineHeight: "1.2" }}>{userProfile?.display_name || userProfile?.username}</h3>
                  </div>
                </div>
              </div>
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
                  width: "36px",
                  height: "36px",
                  transition: "all 0.2s ease"
                }}
              >
                {theme === "light" ? <Sun size={18} /> : <Moon size={18} />}
              </button>
            </div>



            {/* Wallet tab displaying private asset balances */}
            {mobileTab === "wallet" && (
              <div className="tab-pane">
                {walletAction === null ? (
                  <div>
                    {/* Single balance card showing total equivalent and individual breakdown */}
                    {(() => {
                      const totalBalance = (shieldedBalances.USDC || 0) * prices.USDC + (shieldedBalances.XLM || 0) * prices.XLM;
                      return (
                        <div className="premium-card" style={{
                          minHeight: "180px",
                          background: "linear-gradient(135deg, #4c1d95 0%, #1e1b4b 100%)",
                          backgroundImage: "radial-gradient(circle at 20% 30%, rgba(139, 92, 246, 0.4), transparent 70%), radial-gradient(circle at 80% 70%, rgba(59, 130, 246, 0.35), transparent 70%), linear-gradient(135deg, #4c1d95 0%, #1e1b4b 100%)",
                          padding: "24px 28px",
                          borderRadius: "24px",
                          border: "1px solid rgba(255, 255, 255, 0.1)",
                          position: "relative",
                          overflow: "hidden",
                          marginBottom: "20px"
                        }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", width: "100%" }}>
                            <span style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "1px", color: "rgba(255, 255, 255, 0.5)", textTransform: "uppercase" }}>Your Balance</span>
                            <span className="pill-badge" style={{ background: "rgba(255, 255, 255, 0.1)", color: "#ffffff", fontSize: "9px", padding: "4px 8px", borderRadius: "8px", border: "1px solid rgba(255, 255, 255, 0.15)" }}>
                              SHIELDED
                            </span>
                          </div>
                          <div style={{ margin: "20px 0" }}>
                            <h2 style={{ fontSize: "36px", fontWeight: "800", fontFamily: "var(--font-sans)", color: "#ffffff", letterSpacing: "-1px" }}>
                              ${totalBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </h2>
                          </div>

                          {/* Bottom Drawer showing breakdown */}
                          <div style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            background: "rgba(0, 0, 0, 0.3)",
                            margin: "0 -28px -28px",
                            padding: "14px 28px",
                            borderTop: "1px solid rgba(255, 255, 255, 0.05)"
                          }}>
                            <div style={{ display: "flex", gap: "20px" }}>
                              <div>
                                <span style={{ fontSize: "9px", color: "rgba(255, 255, 255, 0.4)", textTransform: "uppercase", display: "block" }}>USDC</span>
                                <span style={{ fontSize: "13px", fontWeight: "700", fontFamily: "var(--font-mono)", color: "#ffffff" }}>
                                  ${(shieldedBalances.USDC || 0).toFixed(2)}
                                </span>
                              </div>
                              <div style={{ borderLeft: "1px solid rgba(255, 255, 255, 0.15)", paddingLeft: "20px" }}>
                                <span style={{ fontSize: "9px", color: "rgba(255, 255, 255, 0.4)", textTransform: "uppercase", display: "block" }}>XLM</span>
                                <span style={{ fontSize: "13px", fontWeight: "700", fontFamily: "var(--font-mono)", color: "#ffffff" }}>
                                  {(shieldedBalances.XLM || 0).toFixed(2)}
                                </span>
                              </div>
                            </div>
                            <div style={{ textAlign: "right" }}>
                              <span style={{ fontSize: "9px", color: "rgba(255, 255, 255, 0.4)", textTransform: "uppercase", display: "block" }}>Account</span>
                              <span style={{ fontSize: "11px", fontWeight: "600", color: "rgba(255, 255, 255, 0.8)", fontFamily: "var(--font-mono)" }}>
                                @{userProfile?.username}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Quick actions routing buttons */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px", marginTop: "20px", marginBottom: "24px" }}>
                      <button
                        onClick={() => { setMobileTab("pay"); setDashboardAction("send"); }}
                        className="btn-secondary"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "flex-start",
                          gap: "8px",
                          padding: "12px 10px",
                          borderRadius: "20px",
                          fontSize: "13px",
                          fontWeight: "600",
                          height: "auto",
                          border: "1px solid var(--border-color)",
                          background: "var(--card-bg)"
                        }}
                      >
                        <div style={{
                          width: "28px",
                          height: "28px",
                          borderRadius: "50%",
                          background: "var(--primary-accent)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "#ffffff",
                          flexShrink: 0
                        }}>
                          <ArrowRight size={14} style={{ transform: "rotate(-45deg)" }} />
                        </div>
                        <span>Send</span>
                      </button>
                      <button
                        onClick={() => { setDashboardAction("receive"); setWalletAction("receive-active"); }}
                        className="btn-secondary"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "flex-start",
                          gap: "8px",
                          padding: "12px 10px",
                          borderRadius: "20px",
                          fontSize: "13px",
                          fontWeight: "600",
                          height: "auto",
                          border: "1px solid var(--border-color)",
                          background: "var(--card-bg)"
                        }}
                      >
                        <div style={{
                          width: "28px",
                          height: "28px",
                          borderRadius: "50%",
                          background: "var(--primary-accent)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "#ffffff",
                          flexShrink: 0
                        }}>
                          <ArrowRight size={14} style={{ transform: "rotate(135deg)" }} />
                        </div>
                        <span>Request</span>
                      </button>
                      <button
                        onClick={() => setWalletAction("out")}
                        className="btn-secondary"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "flex-start",
                          gap: "8px",
                          padding: "12px 10px",
                          borderRadius: "20px",
                          fontSize: "13px",
                          fontWeight: "600",
                          height: "auto",
                          border: "1px solid var(--border-color)",
                          background: "var(--card-bg)"
                        }}
                      >
                        <div style={{
                          width: "28px",
                          height: "28px",
                          borderRadius: "50%",
                          background: "var(--primary-accent)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "#ffffff",
                          flexShrink: 0
                        }}>
                          <Coins size={14} />
                        </div>
                        <span>Withdrawal</span>
                      </button>
                    </div>

                    {/* Transaction History Section */}
                    <div style={{ marginTop: "28px", marginBottom: "28px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                        <h3 style={{ fontSize: "16px", fontWeight: "700", color: "var(--text-primary)" }}>Transaction History</h3>
                        <button
                          onClick={() => setMobileTab("activity")}
                          style={{
                            background: "none",
                            border: "none",
                            color: "var(--primary-accent)",
                            fontSize: "13px",
                            fontWeight: "600",
                            cursor: "pointer"
                          }}
                        >
                          View All
                        </button>
                      </div>

                      {transactions.length === 0 ? (
                        <div style={{ textAlign: "center", padding: "32px 0", color: "var(--text-muted)", background: "var(--card-bg)", border: "1px solid var(--border-color)", borderRadius: "16px" }}>
                          <p style={{ fontSize: "14px" }}>No payments yet</p>
                        </div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                          {transactions.slice(0, 3).map((tx, idx) => {
                            const isIncoming = tx.type === "Incoming" || tx.type === "Received" || tx.type === "Deposit" || tx.type === "Deposited";

                            let displayLabel = "";
                            if (tx.type === "Deposit") {
                              displayLabel = tx.party && tx.party.startsWith("G")
                                ? `Deposit: ${tx.party.slice(0, 6)}...`
                                : "Deposit";
                            } else if (tx.type === "Withdrawal") {
                              displayLabel = tx.party && tx.party.startsWith("G")
                                ? `Withdraw: ${tx.party.slice(0, 6)}...`
                                : "Withdrawal";
                            } else if (tx.type === "Incoming" || tx.type === "Received" || tx.type === "Deposited") {
                              displayLabel = tx.party && tx.party.startsWith("G")
                                ? `From: ${tx.party.slice(0, 6)}...`
                                : `@${tx.party}`;
                            } else {
                              displayLabel = tx.party && tx.party.startsWith("G")
                                ? `To: ${tx.party.slice(0, 6)}...`
                                : `@${tx.party}`;
                            }

                            return (
                              <div
                                key={idx}
                                className="glass-card"
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  alignItems: "center",
                                  padding: "12px 14px",
                                  background: "var(--card-bg)",
                                  border: "1px solid var(--border-color)",
                                  borderRadius: "16px"
                                }}
                              >
                                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                                  <div style={{
                                    width: "32px",
                                    height: "32px",
                                    background: isIncoming ? "rgba(16, 185, 129, 0.1)" : "rgba(124, 58, 237, 0.08)",
                                    borderRadius: "50%",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    color: isIncoming ? "#10b981" : "var(--primary-accent)",
                                    flexShrink: 0
                                  }}>
                                    {isIncoming ? <Download size={14} /> : <SendIcon size={14} />}
                                  </div>
                                  <div>
                                    <h4 style={{ fontSize: "13px", fontWeight: "600", color: "var(--text-primary)" }}>
                                      {displayLabel}
                                    </h4>
                                    <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                                      {new Date(tx.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                  </div>
                                </div>
                                <span className={isIncoming ? "badge-incoming" : "badge-outgoing"} style={{ fontSize: "13px", fontWeight: "700", display: "inline-flex", alignItems: "center", gap: "2px" }}>
                                  {isIncoming ? "+" : "-"}{tx.amount} <span style={{ fontSize: "9px", opacity: 0.7 }}>{tx.asset}</span>
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                ) : walletAction === "receive-active" ? (
                  <div className="glass-panel" style={{ padding: "24px", marginBottom: "20px" }}>
                    <Receive
                      userProfile={userProfile}
                      showFeedback={showFeedback}
                    />
                    <button
                      type="button"
                      onClick={() => setWalletAction(null)}
                      className="btn-secondary"
                      style={{ width: "100%", padding: "14px", marginTop: "16px" }}
                    >
                      Back to Wallet
                    </button>
                  </div>
                ) : walletAction === "out" ? (
                  <Withdraw
                    withdrawRecipient={withdrawRecipient}
                    setWithdrawRecipient={setWithdrawRecipient}
                    selectedAsset={selectedAsset}
                    setSelectedAsset={setSelectedAsset}
                    depositAmount={depositAmount}
                    setDepositAmount={setDepositAmount}
                    shieldedBalances={shieldedBalances}
                    handleCashOut={handleCashOut}
                    setWalletAction={setWalletAction}
                  />
                ) : null}
              </div>
            )}

            {/* Mobile Pay tab amount entry screen */}
            {mobileTab === "pay" && (
              <div className="tab-pane" style={{ display: "flex", flexDirection: "column", height: "100%", justifyContent: "space-between" }}>
                <div style={{ textAlign: "center", margin: "10px 0" }}>
                  <span style={{ fontSize: "12px", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: "600" }}>Enter Amount</span>

                  <div style={{ position: "relative", maxWidth: "220px", margin: "16px auto" }}>
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
                      style={{ padding: "18px 18px 18px 36px", fontSize: "26px", fontWeight: "700", textAlign: "center", width: "100%" }}
                    />
                  </div>
                  {(() => {
                    const amountNum = parseFloat(sendAmount) || 0;
                    let equiv = "";
                    if (amountNum > 0) {
                      if (selectedAsset === "XLM") {
                        equiv = `≈ $${(amountNum * prices.XLM).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`;
                      } else if (selectedAsset === "USDC") {
                        equiv = `≈ ${(amountNum / prices.XLM).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} XLM`;
                      }
                    }
                    return equiv ? (
                      <div style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "-10px", marginBottom: "14px", fontWeight: "600", fontFamily: "var(--font-mono)", textAlign: "center" }}>
                        {equiv}
                      </div>
                    ) : null;
                  })()}

                  <div className="asset-pills" style={{ margin: "8px auto" }}>
                    {Object.keys(TOKENS).map((asset) => (
                      <button
                        key={asset}
                        className={`asset-pill ${selectedAsset === asset ? "active" : ""}`}
                        onClick={() => setSelectedAsset(asset)}
                      >
                        {asset}
                      </button>
                    ))}
                  </div>

                  <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "8px", margin: "16px 0", width: "100%" }}>
                    <span style={{ fontSize: "14px", color: "var(--text-muted)", flexShrink: 0 }}>To:</span>
                    <input
                      type="text"
                      placeholder="Starlit username"
                      value={sendRecipient}
                      onChange={(e) => setSendRecipient(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ""))}
                      style={{ width: "100%", maxWidth: "200px", padding: "8px 12px", fontSize: "14px", borderRadius: "12px", border: "1px solid var(--border-color)", background: "var(--input-bg)", color: "var(--text-primary)" }}
                    />
                  </div>
                </div>

                <div style={{ padding: "0 10px", marginBottom: "20px" }}>
                  <button
                    onClick={handleSendSubmit}
                    className="btn-primary"
                    style={{ width: "100%", padding: "16px" }}
                    disabled={!sendRecipient || parseFloat(sendAmount || 0) <= 0 || (shieldedBalances[selectedAsset] || 0) < parseFloat(sendAmount)}
                  >
                    Send Money
                  </button>
                </div>

                <div>
                  <h4 style={{ fontSize: "13px", fontWeight: "600", color: "var(--text-muted)", marginBottom: "12px", paddingLeft: "4px" }}>Recently Contacted</h4>
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
            )}

            {/* Mobile transactions list page view */}
            {mobileTab === "activity" && (
              <div className="tab-pane">
                <Activity transactions={transactions} />
              </div>
            )}

            {/* Mobile links generator tab */}
            {mobileTab === "links" && (
              <div className="tab-pane">
                <div className="glass-panel" style={{ padding: "24px" }}>
                  <h3 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "8px" }}>Create Request Link</h3>
                  <p style={{ color: "var(--text-muted)", fontSize: "13px", marginBottom: "20px" }}>
                    Generate a payment request link. When someone opens this link, they can sign a transaction to pay you directly to your Starlit address.
                  </p>
                  <form onSubmit={handleCreatePaymentLink} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    <div>
                      <label style={{ display: "block", fontSize: "12px", color: "var(--text-muted)", marginBottom: "6px" }}>Asset</label>
                      <select value={selectedAsset} onChange={(e) => setSelectedAsset(e.target.value)} style={{ padding: "12px 14px", fontSize: "14px", borderRadius: "12px", border: "1px solid var(--border-color)", background: "var(--input-bg)", color: "var(--text-primary)" }}>
                        <option value="USDC">USDC</option>
                        <option value="XLM">XLM</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: "12px", color: "var(--text-muted)", marginBottom: "6px" }}>Amount</label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={depositAmount}
                        onChange={(e) => setDepositAmount(e.target.value)}
                        required
                        style={{ padding: "12px 14px", fontSize: "14px", borderRadius: "12px", border: "1px solid var(--border-color)", background: "var(--input-bg)", color: "var(--text-primary)" }}
                      />
                    </div>
                    <button type="submit" className="btn-primary" style={{ padding: "14px", fontSize: "14px", width: "100%" }}>
                      Generate Link
                    </button>
                  </form>
                  {generatedLink && (
                    <div className="glass-card" style={{ marginTop: "20px", padding: "16px", background: "rgba(139, 92, 246, 0.05)", border: "1px solid var(--primary-accent)", borderRadius: "16px" }}>
                      <span style={{ fontSize: "13px", fontWeight: "600", color: "#ffffff" }}>Link Ready:</span>
                      <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                        <input type="text" value={generatedLink} readOnly style={{ fontSize: "11px", padding: "10px", flexGrow: 1, borderRadius: "12px", border: "1px solid var(--border-color)", background: "var(--input-bg)", color: "var(--text-primary)" }} />
                        <button onClick={() => { navigator.clipboard.writeText(generatedLink); showFeedback("success", "Link copied!"); }} className="btn-primary" style={{ padding: "0 14px", fontSize: "12px" }}>Copy</button>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "12px", color: "var(--text-muted)", fontSize: "12px" }}>
                        <RefreshCw size={12} className="animate-spin" style={{ color: "var(--primary-accent)" }} />
                        <span>Expires in 30 minutes (one-time pay).</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Frosted rounded bottom navigation bar */}
          <nav className="mobile-nav">
            <button className={`mobile-nav-btn ${mobileTab === "wallet" ? "active" : ""}`} onClick={() => { setMobileTab("wallet"); setWalletAction(null); }}>
              <Coins size={20} />
              <span>Wallet</span>
              {mobileTab === "wallet" && <div style={{ width: "4px", height: "4px", borderRadius: "50%", background: "var(--primary-accent)", marginTop: "2px" }} />}
            </button>
            <button className={`mobile-nav-btn ${mobileTab === "links" ? "active" : ""}`} onClick={() => setMobileTab("links")}>
              <LinkIcon size={20} />
              <span>Links</span>
              {mobileTab === "links" && <div style={{ width: "4px", height: "4px", borderRadius: "50%", background: "var(--primary-accent)", marginTop: "2px" }} />}
            </button>
            <button className={`mobile-nav-btn ${mobileTab === "activity" ? "active" : ""}`} onClick={() => setMobileTab("activity")}>
              <FileText size={20} />
              <span>Activities</span>
              {mobileTab === "activity" && <div style={{ width: "4px", height: "4px", borderRadius: "50%", background: "var(--primary-accent)", marginTop: "2px" }} />}
            </button>
          </nav>
        </div>
      ) : (
        <div className="desktop-layout" style={{ display: "flex", width: "100%", height: "100%" }}>
          <Sidebar
            currentTab={currentTab}
            setCurrentTab={setCurrentTab}
            userProfile={userProfile}
            deferredPrompt={deferredPrompt}
            handleInstallApp={handleInstallApp}
            handleLogout={handleLogout}
            setMobileTab={setMobileTab}
            theme={theme}
            toggleTheme={toggleTheme}
            logo={logo}
            symbol={symbol}
            profilePic={profilePic}
            onProfilePicClick={triggerProfilePicSelect}
          />

          {/* Main content grid */}
          <main className="main-content">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "32px" }}>
              <h1 style={{ fontSize: "28px", fontWeight: "800", color: "var(--text-primary)", letterSpacing: "-0.5px" }}>
                {currentTab === "home" && "Dashboard"}
                {currentTab === "pay-links" && "Shareable Links"}
              </h1>
            </div>



            {currentTab === "home" && (
              <div className="dashboard-grid tab-pane">
                {/* Column 1: Wallet Balances & Actions */}
                <section className="grid-panel">
                  <h3 style={{ fontSize: "18px", fontWeight: "700", marginBottom: "20px", color: "var(--text-primary)" }}>Balances</h3>

                  {walletAction === null ? (
                    <Balances
                      shieldedBalances={shieldedBalances}
                      walletAction={walletAction}
                      setDashboardAction={setDashboardAction}
                      setWalletAction={setWalletAction}
                      prices={prices}
                      userProfile={userProfile}
                    />
                  ) : walletAction === "out" ? (
                    <Withdraw
                      withdrawRecipient={withdrawRecipient}
                      setWithdrawRecipient={setWithdrawRecipient}
                      selectedAsset={selectedAsset}
                      setSelectedAsset={setSelectedAsset}
                      depositAmount={depositAmount}
                      setDepositAmount={setDepositAmount}
                      shieldedBalances={shieldedBalances}
                      handleCashOut={handleCashOut}
                      setWalletAction={setWalletAction}
                    />
                  ) : null}
                </section>

                {/* Column 2: Send/Receive Form Panel */}
                <section className="grid-panel">
                  {dashboardAction === "send" ? (
                    <Send
                      sendRecipient={sendRecipient}
                      setSendRecipient={setSendRecipient}
                      sendAmount={sendAmount}
                      setSendAmount={setSendAmount}
                      selectedAsset={selectedAsset}
                      setSelectedAsset={setSelectedAsset}
                      loading={loading}
                      shieldedBalances={shieldedBalances}
                      contacts={contacts}
                      handleSendSubmit={handleSendSubmit}
                      prices={prices}
                    />
                  ) : dashboardAction === "receive" ? (
                    <Receive
                      userProfile={userProfile}
                      showFeedback={showFeedback}
                    />
                  ) : (
                    <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", textAlign: "center", padding: "24px", color: "var(--text-muted)" }}>
                      <Shield size={64} style={{ opacity: 0.15, marginBottom: "20px", color: "var(--primary-accent)" }} />
                      <h3 style={{ fontSize: "20px", fontWeight: "700", color: "var(--text-primary)", marginBottom: "12px" }}>Starlit Pay</h3>
                      <p style={{ fontSize: "14px", maxWidth: "260px", margin: "0 auto 28px", lineHeight: "1.5" }}>
                        Select Send or Receive to get started. All transaction details remain completely private by default.
                      </p>
                      <div style={{ display: "flex", gap: "12px", width: "100%", maxWidth: "260px" }}>
                        <button onClick={() => setDashboardAction("send")} className="btn-primary" style={{ flex: 1, padding: "14px" }}>Send</button>
                        <button onClick={() => setDashboardAction("receive")} className="btn-secondary" style={{ flex: 1, padding: "14px" }}>Receive</button>
                      </div>
                    </div>
                  )}
                </section>

                {/* Column 3: Recent Activity Feed */}
                <Activity transactions={transactions} theme={theme} />
              </div>
            )}

            {currentTab === "pay-links" && (
              <Links
                depositAmount={depositAmount}
                setDepositAmount={setDepositAmount}
                selectedAsset={selectedAsset}
                setSelectedAsset={setSelectedAsset}
                loading={loading}
                generatedLink={generatedLink}
                setGeneratedLink={setGeneratedLink}
                handleCreatePaymentLink={handleCreatePaymentLink}
                showFeedback={showFeedback}
              />
            )}


          </main>
        </div>
      )}
      {/* Hidden file input for client-side avatar upload */}
      <input
        type="file"
        ref={profilePicInputRef}
        onChange={handleProfilePicChange}
        accept="image/*"
        style={{ display: "none" }}
      />
    </div>
  );
}

