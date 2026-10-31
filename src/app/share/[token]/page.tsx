import type { Metadata } from "next";
import { getPublicSharedChat } from "@/lib/chat/share";
import { SharedChatView } from "@/components/chat/shared-chat-view";

export const dynamic = "force-dynamic";

interface SharePageProps {
  params: Promise<{ token: string }>;
}

export async function generateMetadata({ params }: SharePageProps): Promise<Metadata> {
  const { token } = await params;
  const chat = await getPublicSharedChat(token).catch(() => null);

  if (!chat) {
    return {
      title: "Percakapan Dibagikan — DevNuby AI",
    };
  }

  return {
    title: `${chat.title} — DevNuby AI`,
    description: "Percakapan publik baca-saja di DevNuby AI.",
  };
}

export default async function SharedChatPage({ params }: SharePageProps) {
  const { token } = await params;
  const sharedChat = await getPublicSharedChat(token).catch(() => null);

  return <SharedChatView sharedChat={sharedChat} />;
}
