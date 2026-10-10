import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || "https://tmzmnpiiuxikfnaheugm.supabase.co";
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRtem1ucGlpdXhpa2ZuYWhldWdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwNzIxNzUsImV4cCI6MjA5NzY0ODE3NX0.sAjHasXvfK8V-iosNHocHRppQVS8-1QEGt1j7Zls694";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
