import type { Metadata, Viewport } from "next";
import { PwaBootstrap } from "@/components/PwaBootstrap";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "StrayNet Feeder",
    template: "%s · StrayNet Feeder",
  },
  description: "Log feeds, view dog profiles and raise SOS for Mumbai's stray dogs.",
  manifest: "/manifest.webmanifest",
  applicationName: "StrayNet Feeder",
  appleWebApp: {
    capable: true,
    title: "StrayNet Feeder",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b7a3b",
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
        <main>{children}</main>
      </body>
    </html>
  );
}
