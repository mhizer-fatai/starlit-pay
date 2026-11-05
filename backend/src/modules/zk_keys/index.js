import { supabase } from "../../config.js";
import { requireAuth } from "../../http/auth.js";
import { createZkKeysRepository } from "./repository.js";
import { createZkKeysService } from "./service.js";
import { createZkKeysRouter } from "./routes.js";

export const zkKeysRouter = createZkKeysRouter({
  service: createZkKeysService({ repository: createZkKeysRepository(supabase) }),
  requireAuth,
});
