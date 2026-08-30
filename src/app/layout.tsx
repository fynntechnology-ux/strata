import type { Metadata, Viewport } from "next";
import { Space_Grotesk, Inter, JetBrains_Mono } from "next/font/google";
import { ChainProvider } from "@/onchain/ChainProvider";
import "./globals.css";

const display = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
});

const sans = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const mono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
});

const SITE = "STRATA";
const TAGLINE = "A voxel mining city, dug one block at a time.";

export const metadata: Metadata = {
  metadataBase: new URL("https://strata-game.vercel.app"),
  title: {
    default: `${SITE} — ${TAGLINE}`,
    template: `%s · ${SITE}`,
  },
  description:
    "Claim a plot of layered rock, sink a shaft, and grow a working mining city. " +
    "Mine ore, refine it, build extractors, open supply crates and trade gear on an open marketplace.",
  keywords: ["voxel game", "mining game", "city builder", "three.js", "browser game", "solana"],
  authors: [{ name: "STRATA" }],
  openGraph: {
    type: "website",
    title: `${SITE} — ${TAGLINE}`,
    description:
      "Mine layered strata, refine ore, build extractors and trade gear. A browser voxel mining city sim.",
    siteName: SITE,
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE} — ${TAGLINE}`,
    description: "Mine layered strata, refine ore, build extractors and trade gear.",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#06080d",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${display.variable} ${sans.variable} ${mono.variable} antialiased`}
      >
        <ChainProvider>{children}</ChainProvider>
      </body>
    </html>
  );
}
