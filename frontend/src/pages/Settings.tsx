import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Globe,
  Key,
  Lock,
  Mail,
  MessageSquare,
  Phone,
  Share2,
  Star,
  Users,
  Link2,
  Shield,
  Bell,
  DollarSign,
} from "lucide-react";

import { AppStoreButton, GalaxyStoreButton, GooglePlayButton } from "@/components/base/buttons/app-store-buttons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppTopbar } from "@/components/AppTopbar";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { PageTransition } from "@/components/PageTransition";
import { getUser } from "@/lib/auth";
import { useSidebar } from "@/lib/sidebar";

const languages = [
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "zh", label: "Chinese" },
];

const currencies = [
  { value: "USD", label: "USD — US Dollar" },
  { value: "EUR", label: "EUR — Euro" },
  { value: "GBP", label: "GBP — British Pound" },
  { value: "XLM", label: "XLM — Stellar Lumens" },
];

const notificationOptions = [
  { key: "email", label: "Email notifications", description: "Receive updates via email" },
  { key: "push", label: "Push notifications", description: "Browser push notifications" },
  { key: "sms", label: "SMS alerts", description: "Transaction alerts via SMS" },
  { key: "marketing", label: "Marketing emails", description: "Product updates and offers" },
] as const;

type NotificationKey = (typeof notificationOptions)[number]["key"];

const securityItems = [
  { key: "passkey", label: "Passkey", icon: Key, description: "Use biometric or hardware key" },
  { key: "google", label: "Google Authenticator", icon: Shield, description: "Two-factor authentication" },
  { key: "email", label: "Email", icon: Mail, description: "jane.doe@gmail.com" },
  { key: "phone", label: "Phone number", icon: Phone, description: "+1 (555) 000-0000" },
  { key: "password", label: "Password", icon: Lock, description: "Last changed 30 days ago" },
] as const;

type SecurityKey = (typeof securityItems)[number]["key"];

function Toggle({
  checked,
  onCheckedChange,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={`settings-toggle ${checked ? "settings-toggle-on" : "settings-toggle-off"}`}
    >
      <span className="settings-toggle-thumb" />
    </button>
  );
}

function SettingsSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const selected = options.find((option) => option.value === value);

  return (
    <div className="settings-select" ref={ref}>
      <button
        type="button"
        className="settings-select-trigger"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{selected?.label ?? placeholder ?? "Select"}</span>
        <ChevronDown className={open ? "settings-select-open" : ""} />
      </button>
      {open && (
        <ul className="settings-select-menu" role="listbox">
          {options.map((option) => (
            <li key={option.value}>
              <button
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={`settings-select-option ${option.value === value ? "settings-select-option-active" : ""}`}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                {option.label}
                {option.value === value && <Check className="settings-select-check" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SettingsPage() {
  const navigate = useNavigate();
  const { collapsed, toggleCollapsed, mobileOpen, setMobileOpen } = useSidebar();
  const [checking, setChecking] = useState(true);
  const [companyName, setCompanyName] = useState("Starlit Pay");
  const [referralCode, setReferralCode] = useState("STARLIT-2025");

  const [language, setLanguage] = useState(() => {
    try {
      const saved = localStorage.getItem("starlit_lang");
      return saved || "en";
    } catch {
      return "en";
    }
  });

  const [currency, setCurrency] = useState(() => {
    try {
      const saved = localStorage.getItem("starlit_curr");
      return saved || "USD";
    } catch {
      return "USD";
    }
  });

  const [notifications, setNotifications] = useState<Record<NotificationKey, boolean>>(() => {
    try {
      const saved = localStorage.getItem("starlit_notifications");
      return saved ? JSON.parse(saved) : { email: true, push: true, sms: false, marketing: false };
    } catch {
      return { email: true, push: true, sms: false, marketing: false };
    }
  });

  const [security, setSecurity] = useState<Record<SecurityKey, boolean>>(() => {
    try {
      const saved = localStorage.getItem("starlit_security");
      return saved ? JSON.parse(saved) : { passkey: true, google: true, email: true, phone: false, password: true };
    } catch {
      return { passkey: true, google: true, email: true, phone: false, password: true };
    }
  });

  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  useEffect(() => {
    document.title = "Settings — Starlit Pay";
    let cancelled = false;
    void getUser().then((user) => {
      if (cancelled) return;
      if (!user) {
        navigate("/auth", { replace: true });
        return;
      }
      setCompanyName(user.username ? `@${user.username}` : "Starlit Pay");
      if (user.username) setReferralCode(`STARLIT-${user.username.toUpperCase()}`);
      setChecking(false);
    });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  function toggleSection(key: string) {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleLanguageChange(val: string) {
    setLanguage(val);
    try {
      localStorage.setItem("starlit_lang", val);
    } catch {}
  }

  function handleCurrencyChange(val: string) {
    setCurrency(val);
    try {
      localStorage.setItem("starlit_curr", val);
    } catch {}
  }

  function toggleNotification(key: NotificationKey) {
    setNotifications((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem("starlit_notifications", JSON.stringify(next));
      } catch {}
      return next;
    });
  }

  function toggleSecurity(key: SecurityKey) {
    setSecurity((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem("starlit_security", JSON.stringify(next));
      } catch {}
      return next;
    });
  }


  if (checking) return null;

  return (
    <div className="dashboard-frame">
      <DashboardSidebar
        open={mobileOpen}
        collapsed={collapsed}
        onToggle={toggleCollapsed}
        onClose={() => setMobileOpen(false)}
        companyName={companyName}
      />
      {mobileOpen && (
        <button
          className="sidebar-backdrop"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
        />
      )}
      <div className="dashboard-main">
        <AppTopbar />
        <PageTransition>
          <main className="dashboard-content">
          <section className="dash-card settings-card">
            <h1 className="settings-title">Settings</h1>
            <p className="settings-subtitle">Manage your account preferences and security</p>

            <div className="settings-section">
              <button
                type="button"
                className="settings-section-header"
                onClick={() => toggleSection("language")}
                aria-expanded={!collapsedSections.has("language")}
              >
                <ChevronDown
                  className={`settings-section-chevron ${collapsedSections.has("language") ? "settings-section-chevron-collapsed" : ""}`}
                />
                <span className="settings-section-title">
                  <Globe /> Language & Currency
                </span>
              </button>
              <div className={`settings-section-body ${collapsedSections.has("language") ? "settings-section-body-collapsed" : ""}`}>
                <div className="settings-grid">
                  <label className="settings-field">
                    <span className="settings-field-label">Language</span>
                    <SettingsSelect value={language} onChange={handleLanguageChange} options={languages} />
                  </label>
                  <label className="settings-field">
                    <span className="settings-field-label">Currency</span>
                    <SettingsSelect value={currency} onChange={handleCurrencyChange} options={currencies} />
                  </label>
                </div>
              </div>
            </div>

            <div className="settings-section">
              <button
                type="button"
                className="settings-section-header"
                onClick={() => toggleSection("notifications")}
                aria-expanded={!collapsedSections.has("notifications")}
              >
                <ChevronDown
                  className={`settings-section-chevron ${collapsedSections.has("notifications") ? "settings-section-chevron-collapsed" : ""}`}
                />
                <span className="settings-section-title">
                  <Bell /> Notifications
                </span>
              </button>
              <div className={`settings-section-body ${collapsedSections.has("notifications") ? "settings-section-body-collapsed" : ""}`}>
                <div className="settings-list">
                  {notificationOptions.map((option) => (
                    <div key={option.key} className="settings-list-row">
                      <div className="settings-list-copy">
                        <b>{option.label}</b>
                        <small>{option.description}</small>
                      </div>
                      <Toggle
                        checked={notifications[option.key]}
                        onCheckedChange={() => toggleNotification(option.key)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="settings-section">
              <button
                type="button"
                className="settings-section-header"
                onClick={() => toggleSection("referral")}
                aria-expanded={!collapsedSections.has("referral")}
              >
                <ChevronDown
                  className={`settings-section-chevron ${collapsedSections.has("referral") ? "settings-section-chevron-collapsed" : ""}`}
                />
                <span className="settings-section-title">
                  <Link2 /> Referral Program
                </span>
              </button>
              <div className={`settings-section-body ${collapsedSections.has("referral") ? "settings-section-body-collapsed" : ""}`}>
                <p className="settings-section-desc">
                  Share your referral link and earn rewards for every new user.
                </p>
                <div className="settings-referral">
                  <Input readOnly value={referralCode} />
                  <Button
                    variant="secondary"
                    className="settings-referral-btn"
                    style={{ height: 44 }}
                    onClick={() => navigator.clipboard.writeText(referralCode)}
                  >
                    <Copy /> Copy Code
                  </Button>
                  <Button
                    variant="secondary"
                    className="settings-referral-btn"
                    style={{ height: 44 }}
                    onClick={() => navigator.clipboard.writeText(`https://starlitpay.com/ref/${referralCode}`)}
                  >
                    <Link2 /> Copy Link
                  </Button>
                </div>
              </div>
            </div>

            <div className="settings-section">
              <button
                type="button"
                className="settings-section-header"
                onClick={() => toggleSection("rating")}
                aria-expanded={!collapsedSections.has("rating")}
              >
                <ChevronDown
                  className={`settings-section-chevron ${collapsedSections.has("rating") ? "settings-section-chevron-collapsed" : ""}`}
                />
                <span className="settings-section-title">
                  <Star /> Rate Starlit
                </span>
              </button>
              <div className={`settings-section-body ${collapsedSections.has("rating") ? "settings-section-body-collapsed" : ""}`}>
                <p className="settings-section-desc">
                  Help us improve by sharing your experience.
                </p>
                <div className="settings-stores-row">
                  <span className="settings-store-wrap">
                    <AppStoreButton size="md" />
                    <span className="soon-badge">Soon</span>
                  </span>
                  <span className="settings-store-wrap">
                    <GooglePlayButton size="md" />
                    <span className="soon-badge">Soon</span>
                  </span>
                  <Button
                    variant="secondary"
                    className="settings-action-btn settings-trustpilot-btn"
                    onClick={() => window.open("https://github.com/mhizer-fatai/starlit-pay", "_blank")}
                  >
                    <ExternalLink /> Trustpilot
                  </Button>
                </div>
              </div>
            </div>

            <div className="settings-section">
              <button
                type="button"
                className="settings-section-header"
                onClick={() => toggleSection("feedback")}
                aria-expanded={!collapsedSections.has("feedback")}
              >
                <ChevronDown
                  className={`settings-section-chevron ${collapsedSections.has("feedback") ? "settings-section-chevron-collapsed" : ""}`}
                />
                <span className="settings-section-title">
                  <MessageSquare /> Feedback & Community
                </span>
              </button>
              <div className={`settings-section-body ${collapsedSections.has("feedback") ? "settings-section-body-collapsed" : ""}`}>
                <div className="settings-grid">
                  <Button
                    variant="secondary"
                    className="settings-action-btn"
                    onClick={() => window.open("https://github.com/mhizer-fatai/starlit-pay/issues", "_blank")}
                  >
                    <Share2 /> Share Feedback
                  </Button>
                  <Button
                    variant="secondary"
                    className="settings-action-btn"
                    onClick={() => window.open("https://discord.gg/stellar", "_blank")}
                  >
                    <Users /> Join Community
                  </Button>
                </div>
              </div>
            </div>

            <div className="settings-section">
              <button
                type="button"
                className="settings-section-header"
                onClick={() => toggleSection("security")}
                aria-expanded={!collapsedSections.has("security")}
              >
                <ChevronDown
                  className={`settings-section-chevron ${collapsedSections.has("security") ? "settings-section-chevron-collapsed" : ""}`}
                />
                <span className="settings-section-title">
                  <Shield /> Security
                </span>
              </button>
              <div className={`settings-section-body ${collapsedSections.has("security") ? "settings-section-body-collapsed" : ""}`}>
                <div className="settings-list">
                  {securityItems.map((item) => {
                    const Icon = item.icon;
                    return (
                      <div key={item.key} className="settings-list-row">
                        <div className="settings-list-copy">
                          <b>
                            <Icon /> {item.label}
                          </b>
                          <small>{item.description}</small>
                        </div>
                        <Toggle
                          checked={security[item.key]}
                          onCheckedChange={() => toggleSecurity(item.key)}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        </main>
        </PageTransition>
      </div>
    </div>
  );
}

export default SettingsPage;
