import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./theme.css";
import "./presentation.css";
import "./adaptive-controls.css";
import "./legal.css";
import "./training-polish.css";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "The Road to 12%",
  description: "Focused training, intelligently progressed.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Road to 12%" },
};
export const viewport: Viewport = { themeColor: "#070a0d", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}<SiteFooter /></body></html>;
}
