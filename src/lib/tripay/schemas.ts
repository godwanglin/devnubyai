import { z } from "zod";
import type { PaymentSettlementStatus } from "@/lib/payments/settlement";
import type { TripayTransactionStatus } from "./types";

export const tripayCheckoutRequestSchema = z.object({
  methodId: z.string().trim().min(1, "Payment method is required"),
  amount: z.number().int().positive("Amount must be positive integer in IDR"),
  metadata: z.record(z.string(), z.unknown()),
});

/** Tripay status → our transaction status (REFUND only follows a payment, so it ends the invoice) */
export function mapTripayStatus(status: TripayTransactionStatus | string): PaymentSettlementStatus {
  switch (status) {
    case "PAID":
      return "PAID";
    case "EXPIRED":
      return "EXPIRED";
    case "FAILED":
    case "REFUND":
      return "FAILED";
    default:
      return "PENDING";
  }
}
