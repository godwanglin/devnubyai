import { ProviderDetailPage } from "@/components/admin/provider-detail-page";

interface PageProps {
  params: Promise<{ providerId: string }>;
}

export default async function ProviderPage({ params }: PageProps) {
  const { providerId } = await params;
  return <ProviderDetailPage providerId={providerId} />;
}
