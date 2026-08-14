import type { Metadata, Viewport } from "next";
import { PwaBootstrap } from "@/components/PwaBootstrap";
import { ChromeShell } from "@/components/ChromeShell";
import { WebVitalsReporter } from "@/components/WebVitalsReporter";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hetja — Every street has a hero",
  description:
    "Every street has a hero. Scan a collar, log a feed, and join the feeders, vets, and neighbours who show up for Mumbai's stray dogs.",
  manifest: "/manifest.webmanifest",
  applicationName: "Hetja",
  appleWebApp: {
    capable: true,
    title: "Hetja",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): React.JSX.Element {
  return (
    <html lang="en">
      <body>
        <PwaBootstrap />
        <WebVitalsReporter />
        <ChromeShell>{children}</ChromeShell>
      </body>
    </html>
  );
}
