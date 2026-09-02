import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./theme.css";
import "./presentation.css";
import "./adaptive-controls.css";
import "./legal.css";
import "./training-polish.css";
import { brand } from "@/lib/brand";

export const metadata: Metadata = {
  title: brand.name,
  description: "Focused training, intelligently progressed.",
  manifest: "/manifest.webmanifest",
  icons: { icon: [{ url: "/favicon-32.png", sizes: "32x32", type: "image/png" }, { url: "/favicon-48.png", sizes: "48x48", type: "image/png" }], apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: brand.name },
};
export const viewport: Viewport = { themeColor: "#070a0d", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
