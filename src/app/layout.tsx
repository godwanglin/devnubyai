import type { Metadata } from "next";
import {
  Plus_Jakarta_Sans,
  Inter,
  Outfit,
  Roboto,
  Lora,
  Merriweather,
  Fira_Code,
  JetBrains_Mono,
} from "next/font/google";
import { AccountProvider } from "@/providers/account-provider";
import { I18nProvider } from "@/providers/i18n-provider";
import { ThemeProvider } from "@/providers/theme-provider";
import { ToastProvider } from "@/providers/toast-provider";
import { SettingsModal } from "@/components/settings/settings-modal";
import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
});

const roboto = Roboto({
  variable: "--font-roboto",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

const lora = Lora({
  variable: "--font-lora",
  subsets: ["latin"],
});

const merriweather = Merriweather({
  variable: "--font-merriweather",
  subsets: ["latin"],
  weight: ["300", "400", "700"],
});

const firaCode = Fira_Code({
  variable: "--font-fira-code",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DevNuby AI — Ruang kerja AI pribadi",
  description: "Chat dengan AI, fokus pada hal yang penting.",
};

const fontVariables = `${plusJakartaSans.variable} ${inter.variable} ${outfit.variable} ${roboto.variable} ${lora.variable} ${merriweather.variable} ${firaCode.variable} ${jetbrainsMono.variable}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="id"
      data-theme="dark"
      suppressHydrationWarning
      className={`${fontVariables} h-full antialiased`}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                var d = document.documentElement;
                var fUi = localStorage.getItem("devnuby_pref_ui_font");
                if (fUi) d.dataset.fontUi = fUi;
                var fResp = localStorage.getItem("devnuby_pref_resp_font");
                if (fResp) d.dataset.fontResponse = fResp;
                var cSize = localStorage.getItem("devnuby_pref_chat_size");
                if (cSize) d.dataset.chatSize = cSize;
                var tWidth = localStorage.getItem("devnuby_pref_transcript_width");
                if (tWidth) d.dataset.transcriptWidth = tWidth;
                var mot = localStorage.getItem("devnuby_pref_motion");
                if (mot) d.dataset.motion = mot;
              } catch(e) {}
            `,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <I18nProvider>
            <ToastProvider>
              <AccountProvider>
                {children}
                <SettingsModal />
              </AccountProvider>
            </ToastProvider>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
