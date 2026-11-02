import { z } from "zod";
import { partialUpdate } from "@/lib/api/zod-partial";

export const paymentMethodCreateSchema = z.object({
  name: z.string().trim().min(2, "Nama metode minimal 2 karakter").max(120),
  code: z
    .string()
    .trim()
    .min(2, "Kode minimal 2 karakter")
    .max(64)
    .regex(/^[a-z0-9_-]+$/, "Kode hanya boleh huruf kecil, angka, dash (-), underscore (_)"),
  category: z.enum([
    "virtual_account",
    "qris",
    "ewallet",
    "retail",
    "card",
  ]),
  provider: z.enum(["doku", "tripay"]).default("doku"),
  dokuCode: z.string().trim().max(64).optional().nullable(),
  flowType: z.enum(["direct", "checkout"]).default("direct"),
  imagePath: z.string().trim().max(512).optional().nullable(),
  description: z.string().trim().max(255).optional().nullable(),
  instructions: z.string().optional().nullable(),
  minAmount: z.number().int().min(1000, "Minimal nominal Rp 1.000").default(1000),
  maxAmount: z.number().int().min(1000).optional().nullable(),
  feeType: z.enum(["none", "flat", "percent"]).default("none"),
  feeValue: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(9999).default(100),
});

export const paymentMethodUpdateSchema = partialUpdate(paymentMethodCreateSchema);

export const paymentTransactionManualStatusSchema = z.object({
  status: z.enum([
    "PENDING",
    "PAID",
    "EXPIRED",
    "FAILED",
    "CANCELLED",
    "REFUNDED",
  ]),
  notes: z
    .string()
    .trim()
    .min(3, "Catatan alasan minimal 3 karakter")
    .max(1000, "Catatan maksimal 1000 karakter"),
});

export type PaymentMethodCreateInput = z.infer<typeof paymentMethodCreateSchema>;
export type PaymentMethodUpdateInput = z.infer<typeof paymentMethodUpdateSchema>;
export type PaymentTransactionManualStatusInput = z.infer<
  typeof paymentTransactionManualStatusSchema
>;
