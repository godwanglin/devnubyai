export type Role = "user" | "assistant" | "system";

export interface Message {
  id: string;
  role: Role;
  content: string;
  createdAt: string;
}

export interface Session {
  id: string;
  slug: string;
  title: string;
  updatedAt: string;
  group: "today" | "yesterday" | "week" | "earlier";
  model: string;
  messages: Message[];
}

export interface ModelOption {
  id: string;
  shortName: string;
  fullName: string;
  meta: string;
  description: string;
  category: "Powerful" | "Fast";
  badge?: string | null;
}

export interface QuickPrompt {
  id: string;
  label: string;
  prompt: string;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  initials: string;
  plan: string;
  planLabel: string;
  avatarUrl: string | null;
  quota: {
    usedPercent: number;
    resetInDays: number;
  };
}

export type Locale = "id" | "en";
export type Theme = "light" | "dark";
export type ReasoningLevel = "0" | "1" | "2" | "3" | "4";
