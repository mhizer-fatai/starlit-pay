import { z } from "zod";
import { hex32, stellarAddress } from "../../http/validate.js";

// Emails and usernames are stored lowercased; "@alice" and "alice" are the same user.
const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
const username = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v) => v.replace(/^@/, ""))
  .pipe(z.string().regex(/^[a-z0-9_.-]{2,32}$/, "use 2-32 letters, numbers, dots, dashes or underscores"));
const displayName = z.string().trim().min(1, "cannot be empty").max(100, "is too long");

const MAX_AVATAR_BYTES = 1024 * 1024;
const avatarUrl = z
  .string()
  .refine((v) => /^https?:\/\/.+/i.test(v) || /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(v), "must be an https URL or image upload")
  .refine((v) => v.length <= MAX_AVATAR_BYTES, "image is too large (max 1MB)");

export const loginRequest = z.object({ email, identity_commitment: hex32.optional() });

export const registerRequest = z.object({
  email,
  username,
  display_name: displayName.optional(),
  identity_commitment: hex32,
  public_encryption_key: hex32,
  avatar_url: avatarUrl.optional(),
  stellar_address: stellarAddress.optional(),
  // Closed beta: required while sign-up is invite-only (checked by the service).
  invite_code: z.string().trim().max(32).optional(),
});

export const profileUpdateRequest = z
  .object({ display_name: displayName.optional(), avatar_url: avatarUrl.optional() })
  .refine((v) => v.display_name !== undefined || v.avatar_url !== undefined, "Nothing to update.");
