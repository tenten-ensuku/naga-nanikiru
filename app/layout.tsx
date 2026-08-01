import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NAGA局面ドリル｜スクリーンショットベース",
  description: "NAGAの局面スクリーンショットを使った何切る問題のプロトタイプ。",
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
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
