import { Buffer } from "buffer";
if (typeof window !== "undefined") {
  window.Buffer = Buffer;
  // @ts-ignore
  globalThis.Buffer = Buffer;

  // Enforce official custom domain: bounce any visitor away from the default Netlify subdomain
  if (window.location.hostname.endsWith(".netlify.app")) {
    window.location.replace(
      `https://starlitpay.xyz${window.location.pathname}${window.location.search}${window.location.hash}`
    );
  }
}

import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";

import { SidebarProvider } from "./lib/sidebar";

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
import "./styles.css";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
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
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/send" element={<SendPage />} />
          <Route path="/receive" element={<ReceivePage />} />
          <Route path="/payment-links" element={<PaymentLinksPage />} />
          <Route path="/faucet" element={<FaucetPage />} />
          <Route path="/pay/:commitment" element={<PayRequestPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </SidebarProvider>
    </BrowserRouter>
  </StrictMode>,
);
