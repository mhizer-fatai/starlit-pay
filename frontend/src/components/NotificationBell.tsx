import { useEffect, useRef, useState } from "react";
import { Bell, Check, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getUser } from "@/lib/auth";
import {
  buildActivityFeed,
  loadPrivateBalances,
  loadUserTransactions,
  partyLabel,
  type ActivityItem,
} from "@/lib/wallet";

type Notification = {
  id: string;
  title: string;
  message: string;
  time: string;
  read: boolean;
  type: "success" | "error" | "info";
};

function timeAgo(timestamp: number): string {
  if (!timestamp) return "Recently";
  const diffMs = Date.now() - timestamp;
  if (diffMs < 0) return "Just now";
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return days === 1 ? "Yesterday" : `${days} days ago`;
  return new Date(timestamp).toLocaleDateString();
}

function getReadIds(userId: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(`starlit_notif_read_${userId}`) || "[]") as string[];
  } catch {
    return [];
  }
}

function toNotification(item: ActivityItem, read: boolean): Notification {
  const label = partyLabel(item.party);
  const incoming = item.direction === "in";
  return {
    id: item.key,
    title: incoming ? "Payment received" : "Payment sent",
    message: incoming
      ? `You received ${item.amount} ${item.asset}${label ? ` from ${label}` : ""}`
      : `You sent ${item.amount} ${item.asset}${label ? ` to ${label}` : ""}`,
    time: timeAgo(item.date),
    read,
    type: incoming ? "success" : "info",
  };
}

function NotificationModal({
  notifications,
  onClose,
  onReadAll,
  anchorRef,
}: {
  notifications: Notification[];
  onClose: () => void;
  onReadAll: () => void;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const modalRef = useRef<HTMLDivElement>(null);
  const unreadCount = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        modalRef.current &&
        !modalRef.current.contains(target) &&
        anchorRef.current &&
        !anchorRef.current.contains(target)
      ) {
        onClose();
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose, anchorRef]);

  const iconFor = (type: Notification["type"]) => {
    switch (type) {
      case "success":
        return <span className="notification-dot notification-dot-success" />;
      case "error":
        return <span className="notification-dot notification-dot-error" />;
      default:
        return <span className="notification-dot notification-dot-info" />;
    }
  };

  return (
    <div className="notification-modal-backdrop">
      <div
        ref={modalRef}
        className="notification-modal"
        style={{
          position: "fixed",
          top: "72px",
          right: "24px",
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Notifications"
      >
        <div className="notification-modal-header">
          <h3 className="notification-modal-title">Notifications</h3>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="notification-read-all"
              onClick={onReadAll}
            >
              <Check className="size-3" />
              Read all
            </Button>
          )}
        </div>
        <div className="notification-modal-body">
          {notifications.length === 0 ? (
            <p className="notification-empty">No notifications</p>
          ) : (
            notifications.map((notification) => (
              <div
                key={notification.id}
                className={`notification-item ${notification.read ? "notification-item-read" : ""}`}
              >
                <div className="notification-item-icon">
                  {iconFor(notification.type)}
                </div>
                <div className="notification-item-copy">
                  <b>{notification.title}</b>
                  <p>{notification.message}</p>
                  <small>{notification.time}</small>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const bellRef = useRef<HTMLButtonElement>(null);

  const unreadCount = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    let cancelled = false;
    void getUser().then((user) => {
      if (cancelled || !user) return;
      setUserId(user.id);
      void Promise.all([loadUserTransactions(user.id), loadPrivateBalances(user)])
        .then(([txs, balances]) => {
          if (cancelled) return;
          const readIds = new Set(getReadIds(user.id));
          const feed = buildActivityFeed(balances?.notes ?? [], txs).slice(0, 10);
          setNotifications(feed.map((item) => toNotification(item, readIds.has(item.key))));
        })
        .catch(() => {});
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleReadAll() {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    if (userId) {
      try {
        localStorage.setItem(
          `starlit_notif_read_${userId}`,
          JSON.stringify(notifications.map((n) => n.id)),
        );
      } catch {
        /* ignore */
      }
    }
  }

  return (
    <>
      <Button
        ref={bellRef}
        variant="ghost"
        size="icon"
        className="notification"
        aria-label="Notifications"
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <Bell />
        {unreadCount > 0 && (
          <span className="notification-badge">{unreadCount}</span>
        )}
      </Button>
      {isOpen && (
        <NotificationModal
          notifications={notifications}
          onClose={() => setIsOpen(false)}
          onReadAll={handleReadAll}
          anchorRef={bellRef}
        />
      )}
    </>
  );
}
