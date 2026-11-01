import { z } from "zod";

export const createAdminUserSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(320),
  password: z.string().min(6).optional().nullable(),
  role: z.enum(["user", "admin"]).default("user"),
  status: z.enum(["active", "deactivated", "suspended"]).default("active"),
  statusReason: z.string().trim().max(500).optional().nullable(),
  planId: z.string().optional().nullable(),
});

export const updateAdminUserSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().email().max(320).optional(),
  role: z.enum(["user", "admin"]).optional(),
  status: z.enum(["active", "deactivated", "suspended"]).optional(),
  statusReason: z.string().trim().max(500).optional().nullable(),
  planId: z.string().optional().nullable(),
  newPassword: z.string().min(6).optional().nullable(),
  resetChatPin: z.boolean().optional(),
});

export type CreateAdminUserInput = z.infer<typeof createAdminUserSchema>;
export type UpdateAdminUserInput = z.infer<typeof updateAdminUserSchema>;

export function parseUserId(idOrPublicId: string): { id?: bigint; publicId?: string } {
  if (/^\d+$/.test(idOrPublicId)) {
    return { id: BigInt(idOrPublicId) };
  }
  return { publicId: idOrPublicId };
}
