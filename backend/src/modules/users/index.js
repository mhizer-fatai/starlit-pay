import { supabase } from "../../config.js";
import { provenEmail, requireAuth } from "../../http/auth.js";
import { createUsersRepository } from "./repository.js";
import { createUsersService } from "./service.js";
import { createUsersRouter } from "./routes.js";

export const usersRouter = createUsersRouter({
  service: createUsersService({ repository: createUsersRepository(supabase), emailProofRequired: Boolean(provenEmail) }),
  requireAuth,
  provenEmail,
});
