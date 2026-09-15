import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Source_Serif_4 } from "next/font/google";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jakarta",
});

const source = Source_Serif_4({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-source",
});

export const metadata: Metadata = {
  title: "Customer-Care Message Classifier",
  description:
    "Demo interface for a multi-head classifier predicting Issue, Sentiment and Urgency for telecom customer-care messages.",
};

export const viewport: Viewport = {
  themeColor: "#070b14",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${jakarta.variable} ${source.variable}`}>
      <body className="min-h-screen bg-canvas font-sans text-ink antialiased">
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
