import rateLimit from "express-rate-limit";
import { supabase } from "../../config.js";
import { requireAuth, sessionUser } from "../../http/auth.js";
import { logger } from "../../http/logger.js";
import { createNotesRepository } from "./repository.js";
import { createNotesService } from "./service.js";
import { createNotesRouter } from "./routes.js";

export const notesRouter = createNotesRouter({
  service: createNotesService({ repository: createNotesRepository(supabase), logger }),
  requireAuth,
  currentUser: sessionUser,
  postLimiter: rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false, message: { error: "Too many notes. Try again later." } }),
});
