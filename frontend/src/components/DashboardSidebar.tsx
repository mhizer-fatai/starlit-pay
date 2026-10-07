import { useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ChevronRight,
  Download,
  Droplets,
  Home,
  Link2,
  LogOut,
  Moon,
  PanelLeft,
  Receipt,
  Send,
  Settings,
  Sun,
  User,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/sidebar";
import { signOut } from "@/lib/auth";
import { Tooltip } from "@/components/Tooltip";

const navItems = [
  { label: "Home", icon: Home, to: "/dashboard" },
  { label: "Send", icon: Send, to: "/send" },
  { label: "Receive", icon: ArrowDownLeft, to: "/receive" },
  { label: "Swap", icon: ArrowLeftRight, soon: true },
  { label: "Transactions", icon: Receipt, to: "/transactions" },
  { label: "Payments Links", icon: Link2, to: "/payment-links" },
  { label: "Faucet", icon: Droplets, to: "/faucet" },
  { label: "Profile", icon: User, to: "/profile" },
];
const othersItems = [
  { label: "Settings", icon: Settings, to: "/settings" },
  { label: "Dark Mode", icon: Moon, to: "/settings" },
  { label: "Install App", icon: Download },
  { label: "Log Out", icon: LogOut },
];

function NavItem({
  label,
  icon: Icon,
  to,
  soon,
  count,
  expand,
  collapsed,
}: {
  label: string;
  icon: typeof Home;
  to?: string;
  soon?: boolean;
  count?: string;
  expand?: boolean;
  collapsed?: boolean;
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const active = to !== undefined && pathname === to;
  const content = (
    <button
      className={`nav-item ${active ? "active" : ""}`}
      onClick={to && !soon ? () => navigate(to) : undefined}
      disabled={soon}
    >
      <Icon />
      <span>{label}</span>
      {soon && <span className="soon-badge">Soon</span>}
      {count && <b>{count}</b>}
      {expand && <ChevronRight className="ml-auto" />}
    </button>
  );

  if (collapsed) {
    return <Tooltip text={label}>{content}</Tooltip>;
  }
  return content;
}

export function DashboardSidebar({
  open,
  collapsed,
  onToggle,
  onClose,
}: {
  open: boolean;
  collapsed: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const { mode, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const themeLabel = mode === "light" ? "Dark Mode" : "Light Mode";
  const ThemeIcon = mode === "light" ? Moon : Sun;

  useEffect(() => {
    const root = document.documentElement;
    if (mode === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [mode]);

  const otherActions = [
    { label: "Settings", icon: Settings, to: "/settings" as string | undefined },
    { label: themeLabel, icon: ThemeIcon, action: toggleTheme },
    { label: "Install App", icon: Download, soon: true },
    { label: "Log Out", icon: LogOut, action: async () => { await signOut(); navigate("/auth", { replace: true }); } },
  ];

  return (
    <aside className={`dashboard-sidebar ${open ? "open" : ""} ${collapsed ? "collapsed" : ""}`}>
      <div className="company-switcher">
        <img src="/logo.png" alt="Starlit Pay" className="h-7 w-auto" />
        <strong>Starlit Pay</strong>
      </div>
      <nav aria-label="Main navigation">
        {navItems.map((item) => (
          <NavItem key={item.label} {...item} collapsed={collapsed} />
        ))}
        <p className="nav-section">Others</p>
        {otherActions.map((item) => {
          const Icon = item.icon;
          const isActive = item.to !== undefined && pathname === item.to;
          const content = (
            <button
              key={item.label}
              className={`nav-item ${isActive ? "active" : ""}`}
              onClick={item.action ? item.action : item.to ? () => navigate(item.to as string) : undefined}
              disabled={item.soon}
            >
              <Icon />
              <span>{item.label}</span>
              {item.soon && <span className="soon-badge">Soon</span>}
            </button>
          );
          if (collapsed) {
            return <Tooltip key={item.label} text={item.label}>{content}</Tooltip>;
          }
          return content;
        })}
      </nav>
      <Button
        variant="ghost"
        size="icon"
        className="sidebar-close"
        onClick={onClose}
        aria-label="Close navigation"
      >
        <X />
      </Button>
    </aside>
  );
}
