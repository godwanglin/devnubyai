import { ChatShell } from "@/components/chat/chat-shell";

/**
 * Shared layout for `/` and `/c/[id]`: the shell (sidebar + chat area) stays mounted
 * across chat switches, so only the conversation content reloads, not the sidebar.
 * Guests may browse the home page; sending a message sends them to login with the
 * draft preserved (see chat-shell).
 */
export default function ChatLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <ChatShell />
      {children}
    </>
  );
}
