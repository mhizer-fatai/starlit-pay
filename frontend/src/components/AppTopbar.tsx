import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Menu, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NotificationBell } from "@/components/NotificationBell";
import { getUser } from "@/lib/auth";
import { getAvatarUrl } from "@/lib/avatar";
import { useSidebar } from "@/lib/sidebar";

export function AppTopbar() {
  const navigate = useNavigate();
  const { collapsed, toggleCollapsed, setMobileOpen } = useSidebar();
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    void getUser().then((user) => {
      if (user) setDisplayName(user.display_name || user.username);
    });
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function handleMenuToggle() {
    if (window.innerWidth <= 900) setMobileOpen(true);
    else toggleCollapsed();
  }

  const avatarUrl = displayName ? getAvatarUrl(displayName, 64) : null;
  const initial = (displayName || "U").slice(0, 1).toUpperCase();

  return (
    <header
      className={`app-topbar ${scrolled ? "bg-background/80 backdrop-blur-md" : "bg-transparent"}`}
    >
      <div className="app-topbar-inner">
        <button
          type="button"
          className="app-menu-toggle"
          onClick={handleMenuToggle}
          aria-label="Toggle sidebar"
        >
          <Menu />
        </button>
        <div className="search-box">
          <Search />
          <input type="text" placeholder="Search or jump to" aria-label="Search" />
        </div>
        <div className="topbar-actions">
          <NotificationBell />
          {displayName && (
            <button
              className="avatar-button"
              onClick={() => navigate("/profile")}
              aria-label="Open profile"
              title="Profile"
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt="" className="avatar-button-img" />
              ) : (
                initial
              )}
            </button>
          )}
          {!displayName && (
            <Button asChild variant="secondary" className="h-9 rounded-md px-3 text-xs font-medium">
              <a href="/auth">Sign In</a>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
