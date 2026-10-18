import { app, supabase } from "../config.js";
import { createAuthLayer } from "./index.js";
import { createSupabaseStore } from "./store_supabase.js";
import { createSupabaseIdentity } from "./identity.js";
import { startAuthMaintenance } from "./maintenance.js";

const store = createSupabaseStore(supabase);

export const authLayer = createAuthLayer({
  store,
  identity: createSupabaseIdentity(supabase),
});

if (authLayer.settings.configured) {
  console.log(`Passkey auth layer enabled (RP ID: ${authLayer.settings.rpID}).`);
  if (process.env.BACKGROUND_JOBS !== "off") startAuthMaintenance(store);
} else {
  console.warn(`Passkey auth layer disabled: ${authLayer.settings.errors.join(" ")}`);
}

app.use(authLayer.router);
