import { PaymentsTab } from "@/components/admin/payments/payments-tab";

export const metadata = {
  title: "Manajemen Pembayaran | Admin DevNuby",
  description: "Kelola metode pembayaran, logo R2, transaksi masuk, dan DOKU payment gateway",
};

export default function AdminPaymentsPage() {
  return <PaymentsTab />;
}
