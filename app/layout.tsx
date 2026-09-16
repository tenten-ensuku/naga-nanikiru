import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { APP_BASE_PATH, APP_VERSION } from "./lib/appIdentity";

const title = "みん切る｜みんなの何切る問題集";
const description = "みん切るは、NAGA URLから問題をつくり、解いて、仲間と共有できる麻雀学習アプリです。";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "tenten-ensuku.github.io";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/og-v266.png`;
  return {
    title,
    description,
    manifest: `${APP_BASE_PATH}manifest.webmanifest?v=${APP_VERSION}`,
    icons: {
      icon: `${APP_BASE_PATH}icons/favicon-32.png?v=${APP_VERSION}`,
      shortcut: `${APP_BASE_PATH}icons/favicon-32.png?v=${APP_VERSION}`,
      apple: `${APP_BASE_PATH}icons/apple-touch-icon-180.png?v=${APP_VERSION}`,
    },
    openGraph: { title, description, type: "website", images: [{ url: image, width: 1200, height: 630, alt: "みん切る｜みんなの何切る問題集" }] },
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
