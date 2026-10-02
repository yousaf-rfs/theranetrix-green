import type { Metadata } from "next";
import Script from "next/script";
import { PRODUCT_DESCRIPTION } from "@/lib/terminology";
import "./globals.css";
import "./encounter.css";
import "./configuration.css";
import "./engines.css";
import "./review-workspace.css";
import "./future.css";
import "./redesign.css";
import "./redesign-dashboard.css";
import "./redesign-workflows.css";
import "./redesign-forms.css";
import "./redesign-treatment.css";
import "./redesign-clinical.css";
import "./redesign-patient.css";
import "./patient-visit.css";
import "./feedback-previsit.css";
import "./feedback-twin.css";
import "./feedback-foundation.css";
import "./clinician-foundation.css";
import "./clinician-companion.css";
import "./clinician-workflows.css";
import "./tablet.css";

export const metadata: Metadata = {
  title: "TheraNetrix | Clinical Workspace",
  description: PRODUCT_DESCRIPTION,
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}<Script src="/feedback-pin/loader.js" strategy="afterInteractive"/></body>
    </html>
  );
}
