import type { Metadata } from "next";
import { PRODUCT_DESCRIPTION } from "@/lib/terminology";
import "../../app/globals.css";
import "../../app/encounter.css";
import "../../app/configuration.css";
import "../../app/engines.css";
import "../../app/review-workspace.css";
import "../../app/future.css";
import "../../app/redesign.css";
import "../../app/redesign-dashboard.css";
import "../../app/redesign-workflows.css";
import "../../app/redesign-forms.css";
import "../../app/redesign-treatment.css";
import "../../app/redesign-clinical.css";
import "../../app/redesign-patient.css";
import "../../app/patient-visit.css";
import "../../app/feedback-previsit.css";
import "../../app/feedback-twin.css";
import "../../app/feedback-foundation.css";
import "../../app/clinician-foundation.css";
import "../../app/clinician-companion.css";
import "../../app/clinician-workflows.css";
import "../../app/tablet.css";

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
      <body className="antialiased">{children}</body>
    </html>
  );
}
