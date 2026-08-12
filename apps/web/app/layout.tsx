import type { Metadata, Viewport } from "next";
import { Fraunces, Nunito_Sans } from "next/font/google";
import { PwaBootstrap } from "@/components/PwaBootstrap";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { BottomNav } from "@/components/BottomNav";
import { InstallBanner } from "@/components/InstallBanner";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--h-font-display",
  display: "swap",
});

const nunitoSans = Nunito_Sans({
  subsets: ["latin"],
  weight: ["400", "600", "800"],
  variable: "--h-font-body",
  display: "swap",
});

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
  themeColor: "#1b3a2f",
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
    <html
      lang="en"
      className={`${fraunces.variable} ${nunitoSans.variable}`}
    >
      <body>
        <PwaBootstrap />
        <Header />
        <main className="h-main">{children}</main>
        <InstallBanner />
        <BottomNav />
        <Footer />
      </body>
    </html>
  );
}
