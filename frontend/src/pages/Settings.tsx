import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Check,
  ChevronDown,
  Globe,
  Shield,
  DollarSign,
} from "lucide-react";

import { AppTopbar } from "@/components/AppTopbar";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { PageTransition } from "@/components/PageTransition";
import { PasskeySettings } from "@/components/PasskeySettings";
import { getUser } from "@/lib/auth";
import { fetchSettings, updateSettings, type SettingsUpdate } from "@/lib/backend";
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
  const [language, setLanguage] = useState("en");
  const [currency, setCurrency] = useState("USD");
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [settingsReady, setSettingsReady] = useState(false);
  const [settingsError, setSettingsError] = useState("");

  useEffect(() => {
    document.title = "Settings — Starlit Pay";
    let cancelled = false;
    void getUser().then((user) => {
      if (cancelled) return;
      if (!user) {
        navigate("/auth", { replace: true });
        return;
      }
      setChecking(false);
      // Per-account settings follow the user across devices.
      void fetchSettings()
        .then(({ settings }) => {
          if (cancelled) return;
          setLanguage(settings.language);
          setCurrency(settings.currency);
          setSettingsReady(true);
        })
        .catch(() => {
          if (!cancelled)
            setSettingsError("Couldn't load your settings — changes won't be saved yet.");
        });
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

  function changeLanguage(value: string) {
    const prev = language;
    setLanguage(value);
    void persistSetting({ language: value }, () => setLanguage(prev));
  }

  function changeCurrency(value: string) {
    const prev = currency;
    setCurrency(value);
    void persistSetting({ currency: value }, () => setCurrency(prev));
  }

  async function persistSetting(patch: SettingsUpdate, revert: () => void) {
    if (!settingsReady) {
      revert();
      setSettingsError("Settings are still loading — try again in a moment.");
      return;
    }
    try {
      await updateSettings(patch);
      setSettingsError("");
    } catch {
      revert();
      setSettingsError("Couldn't save settings — check your connection.");
    }
  }

  if (checking) return null;

  return (
    <div className="dashboard-frame">
      <DashboardSidebar
        open={mobileOpen}
        collapsed={collapsed}
        onToggle={toggleCollapsed}
        onClose={() => setMobileOpen(false)}
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
            {settingsError && (
              <p className="text-sm text-red-500" role="alert" style={{ marginTop: 8 }}>
                {settingsError}
              </p>
            )}

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
                    <SettingsSelect value={language} onChange={changeLanguage} options={languages} />
                  </label>
                  <label className="settings-field">
                    <span className="settings-field-label">Currency</span>
                    <SettingsSelect value={currency} onChange={changeCurrency} options={currencies} />
                  </label>
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
                <PasskeySettings />
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
