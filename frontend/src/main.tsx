import { StrictMode, useEffect, useState, type ReactNode } from "react";
import { Buffer } from "buffer";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";

import { SidebarProvider } from "./lib/sidebar";

// stellar-sdk uses the Node `Buffer` global internally; polyfill it for browsers.
if (typeof globalThis.Buffer === "undefined") {
  globalThis.Buffer = Buffer;
}

import Faqs from "./pages/Faqs";
import Index from "./pages/Index";
import AuthPage from "./pages/Auth";
import DashboardPage from "./pages/Dashboard";
import FaucetPage from "./pages/Faucet";
import PaymentLinksPage from "./pages/PaymentLinks";
import ProfilePage from "./pages/Profile";
import ReceivePage from "./pages/Receive";
import SendPage from "./pages/Send";
import SettingsPage from "./pages/Settings";
import TransactionsPage from "./pages/Transactions";
import PayRequestPage from "./pages/PayRequest";
import { getUser, isUnlocked } from "./lib/auth";
import "./styles.css";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

/**
 * App-wide session gate: no JWT → /auth; JWT from a previous page load but
 * no PIN entered since (tab refresh) → /auth?mode=unlock for PIN re-entry.
 * The unlock flag lives only in memory, so a refresh always locks.
 */
function RequireUnlock({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void getUser().then((user) => {
      if (cancelled) return;
      if (!user) {
        navigate("/auth", { replace: true });
        return;
      }
      if (!isUnlocked()) {
        navigate("/auth?mode=unlock", { replace: true });
        return;
      }
      setOk(true);
    });
    return () => {
      cancelled = true;
    };
  }, [navigate]);
  if (!ok) return null;
  return <>{children}</>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <SidebarProvider>
        <ScrollToTop />
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/faqs" element={<Faqs />} />
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/dashboard" element={<RequireUnlock><DashboardPage /></RequireUnlock>} />
          <Route path="/profile" element={<RequireUnlock><ProfilePage /></RequireUnlock>} />
          <Route path="/transactions" element={<RequireUnlock><TransactionsPage /></RequireUnlock>} />
          <Route path="/send" element={<RequireUnlock><SendPage /></RequireUnlock>} />
          <Route path="/receive" element={<RequireUnlock><ReceivePage /></RequireUnlock>} />
          <Route path="/payment-links" element={<RequireUnlock><PaymentLinksPage /></RequireUnlock>} />
          <Route path="/faucet" element={<RequireUnlock><FaucetPage /></RequireUnlock>} />
          <Route path="/pay/:commitment" element={<PayRequestPage />} />
          <Route path="/settings" element={<RequireUnlock><SettingsPage /></RequireUnlock>} />
        </Routes>
      </SidebarProvider>
    </BrowserRouter>
  </StrictMode>,
);
