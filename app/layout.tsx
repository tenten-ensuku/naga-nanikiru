import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

const title = "NAGA局面ドリル｜何切る復習問題集";
const description = "NAGAの局面を解き、復習予定・苦手分析・URLからの問題生成まで行える麻雀学習アプリ。";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "tenten-ensuku.github.io";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/og-v44.png`;
  return {
    title,
    description,
    openGraph: { title, description, type: "website", images: [{ url: image, width: 1730, height: 907, alt: "NAGA局面ドリル" }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

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
