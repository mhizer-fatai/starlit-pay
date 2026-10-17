import { app, supabase } from "../config.js";
import { createAuthLayer } from "./index.js";
import { createSupabaseStore } from "./store_supabase.js";
import { createSupabaseIdentity } from "./identity.js";

export const authLayer = createAuthLayer({
  store: createSupabaseStore(supabase),
  identity: createSupabaseIdentity(supabase),
});

if (authLayer.settings.configured) {
  console.log(`Passkey auth layer enabled (RP ID: ${authLayer.settings.rpID}).`);
} else {
  console.warn(`Passkey auth layer disabled: ${authLayer.settings.errors.join(" ")}`);
}

app.use(authLayer.router);
