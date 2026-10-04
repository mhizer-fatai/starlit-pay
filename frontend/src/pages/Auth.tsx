import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getUser, signInWithGoogle } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-10 shrink-0" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.03 5.03 0 0 1-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.97 10.97 0 0 0 1 12c0 1.78.43 3.45 1.18 4.93l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function AuthPage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    document.title = "Sign in — Starlit Pay";
    void getUser().then((user) => {
      if (user) navigate("/dashboard", { replace: true });
    });
    // Returning from Google OAuth: bridge Supabase session -> backend JWT session.
    void (async () => {
      try {
        // PKCE flow returns ?code= — exchange it for a session first.
        const params = new URLSearchParams(window.location.search);
        if (params.has("code")) {
          await supabase.auth.exchangeCodeForSession(window.location.search);
          window.history.replaceState(null, "", "/auth");
        }
        const { data } = await supabase.auth.getSession();
        const email = data.session?.user.email;
        if (!email) return;
        setBusy(true);
        await signInWithGoogle(email, {
          displayName:
            (data.session?.user.user_metadata?.full_name as string | undefined) ||
            (data.session?.user.user_metadata?.name as string | undefined),
          avatarUrl:
            (data.session?.user.user_metadata?.avatar_url as string | undefined) ||
            (data.session?.user.user_metadata?.picture as string | undefined),
        });
        navigate("/dashboard", { replace: true });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Google sign-in failed.");
      } finally {
        setBusy(false);
      }
    })();
  }, [navigate]);

  useEffect(() => {
    document.documentElement.classList.remove("dark");
  }, []);

  async function handleGoogle() {
    setError("");
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth` },
      });
      if (error) throw error;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Google sign-in failed.");
      setBusy(false);
    }
  }

  return (
    <main className="auth-stage">
      <div className="auth-shell">
        <section className="auth-panel">
          <div className="auth-form-wrap">
            <div className="text-center">
              <h1 className="text-[32px] font-medium text-foreground">Welcome to Starlit Pay</h1>
              <p className="mt-3 text-[15px] leading-6 text-muted-foreground">
                Start your experience with Starlit Pay by signing in or
                <br className="hidden sm:block" /> signing up.
              </p>
            </div>

            <div className="mt-8 space-y-6">
              <Button
                type="button"
                onClick={handleGoogle}
                disabled={busy}
                className="h-16 w-full rounded-lg bg-background text-[18px] font-semibold text-foreground shadow-md shadow-primary/10 hover:bg-white/50"
              >
                <GoogleIcon /> {busy ? "Please wait…" : "Continue with Google"}
              </Button>

              {error && (
                <p className="text-sm text-red-500" role="alert">
                  {error}
                </p>
              )}

              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[15px] font-semibold text-foreground">Login with Email</span>
                  <span className="rounded-full bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-primary">
                    Coming Soon
                  </span>
                </div>
                <div className="auth-input" aria-disabled="true">
                  <Mail />
                  <Input type="email" placeholder="Enter your email address" disabled />
                </div>
              </div>

              <Button
                className="h-16 w-full rounded-lg bg-primary text-[16px] font-medium shadow-none"
                disabled
                type="button"
              >
                Sign In
              </Button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default AuthPage;
