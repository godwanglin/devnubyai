import { z } from "zod";

export const dokuSettingsPatchSchema = z.object({
  isEnabled: z.boolean().optional(),
  environment: z.enum(["sandbox", "production"]).optional(),
  clientId: z.string().trim().min(1, "Client ID cannot be empty").optional(),
  secretKey: z.string().trim().min(1, "Secret Key cannot be empty").optional(),
  notificationUrl: z
    .string()
    .trim()
    .url("Invalid notification URL")
    .or(z.literal(""))
    .optional(),
  callbackUrl: z
    .string()
    .trim()
    .url("Invalid callback URL")
    .or(z.literal(""))
    .optional(),
});

export type DokuSettingsPatch = z.infer<typeof dokuSettingsPatchSchema>;

export const DEFAULT_CUSTOMER_PHONE = "088220783426";

export const dokuCheckoutCustomerSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "Customer name is required"),
  email: z.string().trim().email("Invalid customer email"),
  phone: z
    .string()
    .trim()
    .optional()
    .transform((val) => (val && val.length > 0 ? val : DEFAULT_CUSTOMER_PHONE)),
});

export const dokuCheckoutItemSchema = z.object({
  name: z.string().trim().min(1, "Item name is required"),
  price: z.number().int().positive("Item price must be positive integer in IDR"),
  quantity: z.number().int().positive("Item quantity must be positive"),
});

export const dokuCheckoutRequestSchema = z.object({
  invoiceNumber: z.string().trim().min(1, "Invoice number is required"),
  amount: z.number().int().positive("Amount must be positive integer in IDR"),
  currency: z.literal("IDR").default("IDR"),
  customer: dokuCheckoutCustomerSchema,
  items: z.array(dokuCheckoutItemSchema).optional(),
  callbackUrl: z.string().url().optional(),
  callbackUrlCancel: z.string().url().optional(),
  lineItemsDescription: z.string().optional(),
  paymentMethodTypes: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const dokuDirectVaRequestSchema = z.object({
  invoiceNumber: z.string().trim().min(1, "Invoice number is required"),
  amount: z.number().int().min(1000, "Amount must be at least Rp 1.000"),
  bank: z.enum([
    "bri",
    "bca",
    "mandiri",
    "bni",
    "permata",
    "cimb",
    "danamon",
    "bsi",
    "doku",
  ]),
  customer: dokuCheckoutCustomerSchema,
  expiredTimeMinutes: z.number().int().min(5).max(10080).default(60),
  reusableStatus: z.boolean().default(false),
  info1: z.string().max(50).optional(),
  info2: z.string().max(50).optional(),
  info3: z.string().max(50).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type DokuDirectVaRequestInput = z.infer<typeof dokuDirectVaRequestSchema>;
