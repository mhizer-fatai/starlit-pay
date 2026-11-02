import { app, supabase } from "../../config.js";
import { requireAuth } from "../../auth.js";
import { createTransactionsRepository } from "./repository.js";
import { createTransactionsService } from "./service.js";
import { createTransactionsRouter } from "./routes.js";

const service = createTransactionsService({ repository: createTransactionsRepository(supabase) });
app.use(createTransactionsRouter({ service, requireAuth }));
