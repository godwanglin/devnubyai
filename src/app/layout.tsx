import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Fira_Code } from "next/font/google";
import { AccountProvider } from "@/providers/account-provider";
import { I18nProvider } from "@/providers/i18n-provider";
import { ThemeProvider } from "@/providers/theme-provider";
import { ToastProvider } from "@/providers/toast-provider";
import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
});

const firaCode = Fira_Code({
  variable: "--font-fira-code",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DevNuby AI — Ruang kerja AI pribadi",
  description: "Chat dengan AI, fokus pada hal yang penting.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="id"
      data-theme="dark"
      suppressHydrationWarning
      className={`${plusJakartaSans.variable} ${firaCode.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <I18nProvider>
            <ToastProvider>
              <AccountProvider>{children}</AccountProvider>
            </ToastProvider>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
