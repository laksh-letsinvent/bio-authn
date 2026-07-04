import type { Metadata } from "next";

const BASE_URL = "https://bio-idv.letsinvent.co.uk";

export const metadata: Metadata = {
  title: {
    default: "Hard Copy — Document IDV Eval Harness",
    template: "%s · Hard Copy",
  },
  description:
    "An eval-first harness for document identity verification. VLM vs specialist baselines across classification, field extraction (98.3% accuracy), forgery detection (AUC 1.000 on SIDTD), and cross-domain face matching — all reproducible.",
  metadataBase: new URL(BASE_URL),
  openGraph: {
    type: "website",
    url: `${BASE_URL}/hardcopy/`,
    siteName: "Hard Copy",
    title: "Hard Copy — Document IDV Eval Harness",
    description:
      "How well can a vision model classify, read, and authenticate identity documents? Measured end-to-end: 98.3% field extraction, AUC 1.000 forgery detection on real SIDTD documents, face match EER ~3%.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Hard Copy — Document IDV Eval Harness",
    description:
      "How well can a vision model classify, read, and authenticate identity documents? Measured end-to-end: 98.3% field extraction, AUC 1.000 forgery detection on real SIDTD documents, face match EER ~3%.",
  },
};

export default function HardCopyLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
