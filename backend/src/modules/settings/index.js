import { Router } from "express";
import { z } from "zod";
import { supabase } from "../../config.js";
import { requireAuth } from "../../http/auth.js";
import { asyncHandler } from "../../http/errors.js";
import { validateBody } from "../../http/validate.js";
import { createSettingsService } from "./service.js";

const toggle = z.boolean();
export const settingsUpdate = z
  .object({
    language: z.enum(["en", "es", "fr", "de", "zh"]).optional(),
    currency: z.enum(["USD", "EUR", "GBP", "XLM"]).optional(),
    notif_email: toggle.optional(),
    notif_push: toggle.optional(),
    notif_sms: toggle.optional(),
    notif_marketing: toggle.optional(),
    sec_passkey: toggle.optional(),
    sec_google: toggle.optional(),
    sec_email: toggle.optional(),
    sec_phone: toggle.optional(),
    sec_password: toggle.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to update.");

const repository = {
  async find(userId) {
    const { data, error } = await supabase.from("user_settings").select("*").eq("user_id", userId).maybeSingle();
    if (error) throw error;
    return data;
  },
  async save(row) {
    const { data, error } = await supabase.from("user_settings").upsert(row, { onConflict: "user_id" }).select().single();
    if (error) throw error;
    return data;
  },
};

const service = createSettingsService({ repository });

export const settingsRouter = Router();
settingsRouter.get(
  "/api/users/me/settings",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.status(200).json({ settings: await service.get(req.user.id) });
  })
);
settingsRouter.patch(
  "/api/users/me/settings",
  requireAuth,
  validateBody(settingsUpdate),
  asyncHandler(async (req, res) => {
    res.status(200).json({ settings: await service.update(req.user.id, req.body) });
  })
);
