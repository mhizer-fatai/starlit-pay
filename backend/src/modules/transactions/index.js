import { supabase } from "../../config.js";
import { requireAuth } from "../../http/auth.js";
import { createTransactionsRepository } from "./repository.js";
import { createTransactionsService } from "./service.js";
import { createTransactionsRouter } from "./routes.js";

const service = createTransactionsService({ repository: createTransactionsRepository(supabase) });
export const transactionsRouter = createTransactionsRouter({ service, requireAuth });
