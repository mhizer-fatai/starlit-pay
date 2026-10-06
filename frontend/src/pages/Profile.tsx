import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Camera, Check, Pencil, X, LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { AppTopbar } from "@/components/AppTopbar";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { Input } from "@/components/ui/input";
import { getUser, updateUserProfile, signOut, type SessionUser } from "@/lib/auth";
import { getAvatarUrl } from "@/lib/avatar";
import { useSidebar } from "@/lib/sidebar";

function ProfilePage() {
  const navigate = useNavigate();
  const { collapsed, toggleCollapsed, mobileOpen, setMobileOpen } = useSidebar();
  const [checking, setChecking] = useState(true);
  const [companyName, setCompanyName] = useState("Starlit Pay");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = "Profile — Starlit Pay";
    let cancelled = false;
    void getUser().then((current) => {
      if (cancelled) return;
      if (!current) {
        navigate("/auth", { replace: true });
        return;
      }
      setUser(current);
      setCompanyName(current.username ? `@${current.username}` : "Starlit Pay");
      setChecking(false);
    });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  async function handleSave() {
    if (!user) return;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      await updateUserProfile(user.id, {
        display_name: user.display_name || undefined,
        email: user.email,
        avatar_url: user.avatar_url || undefined,
      });
      setMessage("Profile updated successfully");
      setEditing(false);
    } catch {
      setMessage("Failed to update profile");
    } finally {
      setSaving(false);
    }
  }

  async function handleLogout() {
    await signOut();
    window.location.href = "/auth";
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !user) return;
    setError("");
    if (file.size > 1 * 1024 * 1024) {
      setError("Image must be smaller than 1MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setUser((prev) => prev ? { ...prev, avatar_url: reader.result as string } : prev);
    };
    reader.readAsDataURL(file);
  }

  if (checking) return null;

  const initial = (user?.display_name || user?.username || "U").slice(0, 1).toUpperCase();

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
        <main className="dashboard-content">
          <section className="dash-card profile-card">
            <div className="profile-header">
              <div>
                <h1 className="profile-title">Profile</h1>
                <p className="profile-subtitle">Manage your account details</p>
              </div>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                {!editing && (
                  <Button className="profile-edit-btn" onClick={() => setEditing(true)}>
                    <Pencil className="size-4" />
                    Edit profile
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={handleLogout}
                  style={{
                    color: "#ef4444",
                    borderColor: "rgba(239, 68, 68, 0.3)",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <LogOut className="size-4" />
                  Log out
                </Button>
              </div>
            </div>

            <div className="profile-body">
              <div className="profile-avatar">
                {user?.avatar_url ? (
                  <img src={user.avatar_url} alt="Avatar" />
                ) : (
                  <img src={getAvatarUrl(user?.display_name || user?.username || user?.email || "user", 256)} alt="Avatar" />
                )}
                {editing && (
                  <button
                    type="button"
                    className="profile-avatar-camera"
                    onClick={() => fileRef.current?.click()}
                    aria-label="Change avatar"
                  >
                    <Camera className="size-4" />
                  </button>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </div>
              <div className="profile-info">
                {editing ? (
                  <form className="profile-form" onSubmit={(event) => { event.preventDefault(); handleSave(); }}>
                    <label className="settings-field">
                      <span className="settings-field-label">Display Name</span>
                      <Input
                        value={user?.display_name ?? ""}
                        onChange={(event) => setUser((prev) => prev ? { ...prev, display_name: event.target.value } : prev)}
                        placeholder="Your display name"
                      />
                    </label>
                    <label className="settings-field">
                      <span className="settings-field-label">Username</span>
                      <Input value={user?.username ? `@${user.username}` : ""} disabled readOnly />
                    </label>
                    <label className="settings-field">
                      <span className="settings-field-label">Deposit Memo</span>
                      <Input value={user?.deposit_memo ?? ""} disabled readOnly />
                    </label>
                    {(message || error) && (
                      <p className={`profile-message ${error ? "profile-message-error" : "profile-message-success"}`}>
                        {error || message}
                      </p>
                    )}
                    <div className="profile-actions">
                      <Button type="submit" disabled={saving}>
                        {saving ? "Saving..." : "Save Changes"}
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => { setEditing(false); setMessage(""); setError(""); }}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="profile-name">{user?.display_name || user?.username}</div>
                    <div className="profile-email">{user?.email}</div>
                    {user?.username && <div className="profile-email">@{user.username}</div>}
                    {user?.deposit_memo && <div className="profile-email">Memo: {user.deposit_memo}</div>}
                  </>
                )}
              </div>
            </div>

            <div
              style={{
                marginTop: "32px",
                paddingTop: "24px",
                borderTop: "1px solid var(--border-color, #27272a)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "16px",
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: "14px", color: "var(--text-color, #fff)" }}>
                  Account Session
                </div>
                <div style={{ fontSize: "12px", color: "var(--text-muted, #a1a1aa)" }}>
                  Sign out of this session and clear active wallet credentials on this device
                </div>
              </div>
              <Button
                variant="destructive"
                onClick={handleLogout}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <LogOut className="size-4" />
                Sign Out
              </Button>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

export default ProfilePage;

