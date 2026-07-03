import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AppShell } from "@/components/AppShell";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

const BASE_URL = "https://bio-authn.letsinvent.co.uk";

export const metadata: Metadata = {
  title: "Face Value — Biometric Eval Harness",
  description:
    "An eval-first harness for selfie biometric authentication. ArcFace AUC 0.999, Claude VLM as second opinion (87% in-band accuracy), liveness detection, and fairness measurement — all on synthetic faces with every number reproducible.",
  metadataBase: new URL(BASE_URL),
  openGraph: {
    type: "website",
    url: BASE_URL,
    siteName: "Face Value",
    title: "Face Value — Biometric Eval Harness",
    description:
      "An eval-first harness for selfie biometric authentication. Measures accuracy, fairness, calibration, cost, and latency across ArcFace, InsightFace, and Claude VLM.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 627,
        alt: "Face Value — Biometric Eval Harness",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Face Value — Biometric Eval Harness",
    description:
      "An eval-first harness for selfie biometric authentication. Measures accuracy, fairness, calibration, cost, and latency across ArcFace, InsightFace, and Claude VLM.",
    images: ["/og-image.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} h-full`} data-brand="face-value" suppressHydrationWarning>
      <head>
        {/* Inline script sets data-brand before first paint — no FOUC */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){if(window.location.pathname.startsWith('/hardcopy')){document.documentElement.setAttribute('data-brand','hard-copy');}})();` }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="h-full antialiased">
        <ThemeProvider>
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
