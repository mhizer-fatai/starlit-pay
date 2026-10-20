// Proof that the caller controls an email address, taken from the Supabase
// (Google OAuth) access token the frontend already holds. The backend verifies
// the token with Supabase rather than trusting an email in the request body.

export const EMAIL_PROOF_HEADER = "x-supabase-auth";

export function createSupabaseIdentity(supabase) {
  return {
    async verifyEmail(accessToken) {
      if (!accessToken) return null;
      try {
        const { data, error } = await supabase.auth.getUser(accessToken);
        const user = data?.user;
        if (error || !user?.email) return null;
        if (!user.email_confirmed_at && !user.confirmed_at) return null;
        return user.email.toLowerCase();
      } catch {
        return null;
      }
    },
  };
}

/** Returns the proven, lowercased email for this request, or null. */
export async function provenEmail(identity, req) {
  const token = req.headers[EMAIL_PROOF_HEADER];
  if (typeof token !== "string" || token.length > 4096) return null;
  return identity.verifyEmail(token);
}

/** User fields safe to return to the account owner (never the login commitment). */
export function safeUser(user) {
  if (!user) return null;
  const { identity_commitment: _secret, ...rest } = user;
  return rest;
}
