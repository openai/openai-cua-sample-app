import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DEFAULT_MODEL_DISPLAY_NAME } from "@cua-sample/contracts";

import "./globals.css";

export const metadata: Metadata = {
  title: `${DEFAULT_MODEL_DISPLAY_NAME} CUA Sample App`,
  description:
    `Scenario-driven sample app for ${DEFAULT_MODEL_DISPLAY_NAME} computer-use workflows.`,
};

type RootLayoutProps = {
  children: ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
