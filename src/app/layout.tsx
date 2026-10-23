import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "cyrillic"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin", "cyrillic"],
});

export const metadata: Metadata = {
  title: "Доска — совместная белая доска",
  description:
    "Совместная онлайн-доска в стиле Miro: рисуйте, добавляйте стикеры и работайте одновременно с друзьями. Оптимизирована для iPad и Apple Pencil.",
  keywords: ["доска", "whiteboard", "стикеры", "совместная работа", "iPad", "Miro"],
  icons: {
    icon: "/logo.svg",
  },
  openGraph: {
    title: "Доска — совместная белая доска",
    description: "Рисуйте и работайте вместе в реальном времени",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#fafafa",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
