// App-wide instances wired to the real backend, browser and Supabase session.
// Kept separate from the flows so tests can inject their own fetch/ceremonies.

import { BACKEND_URL } from "@/lib/backend";
import { supabase } from "@/lib/supabase";
import { createAuthApi } from "./api";
import { createPasskeyFlows } from "./flows";
import { browserCeremonies } from "./webauthn";

export const authApi = createAuthApi({ baseUrl: BACKEND_URL });
export const passkeyFlows = createPasskeyFlows({ api: authApi, ceremonies: browserCeremonies });

/**
 * The Supabase (Google) access token, which the backend verifies as proof
 * that the user controls their email. Null when not signed in with Google.
 */
export async function getEmailProof(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
