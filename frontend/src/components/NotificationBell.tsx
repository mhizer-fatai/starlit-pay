import { useEffect, useRef, useState } from "react";
import { Bell, Check, X } from "lucide-react";

import { Button } from "@/components/ui/button";

type Notification = {
  id: string;
  title: string;
  message: string;
  time: string;
  read: boolean;
  type: "success" | "error" | "info";
};

const initialNotifications: Notification[] = [
  {
    id: "1",
    title: "Payment received",
    message: "You received $12,500.00 USDC from Acme Corp",
    time: "2 min ago",
    read: false,
    type: "success",
  },
  {
    id: "2",
    title: "Payment sent",
    message: "You sent $3,240.00 USDC to @jane_doe",
    time: "1 hour ago",
    read: false,
    type: "info",
  },
  {
    id: "3",
    title: "Invoice settled",
    message: "Invoice #1042 for $8,120.00 XLM has been settled",
    time: "3 hours ago",
    read: false,
    type: "success",
  },
  {
    id: "4",
    title: "Vault transfer failed",
    message: "Transfer to Operating vault could not be completed",
    time: "Yesterday",
    read: true,
    type: "error",
  },
  {
    id: "5",
    title: "Bill paid",
    message: "Electricity bill of $1,905.20 USDC was paid",
    time: "2 days ago",
    read: true,
    type: "info",
  },
];

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
  const [notifications, setNotifications] = useState<Notification[]>(initialNotifications);
  const [isOpen, setIsOpen] = useState(false);
  const bellRef = useRef<HTMLButtonElement>(null);

  const unreadCount = notifications.filter((n) => !n.read).length;

  function handleReadAll() {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
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
