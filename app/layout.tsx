import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Customer-Care Message Classifier",
  description:
    "Demo interface for a multi-head classifier predicting Issue, Sentiment and Urgency for customer-care messages.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 font-sans text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
