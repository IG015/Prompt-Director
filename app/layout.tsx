import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PromptDirector — Produção de vídeo",
  description: "Produção simples de vídeos por IA com continuidade cinematográfica automática.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt">
      <body className="antialiased">{children}</body>
    </html>
  );
}
