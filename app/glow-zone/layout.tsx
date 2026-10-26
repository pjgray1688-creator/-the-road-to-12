import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata:Metadata={
  applicationName:"Glow Zone",
  title:{default:"Glow Zone",template:"%s · Glow Zone"},
  description:"Glow Zone Carlton customer app.",
  manifest:"/glow-zone/manifest.webmanifest",
  icons:{
    icon:[{url:"/r12-app-assets/glow-zone-icon.svg",type:"image/svg+xml"},{url:"/r12-app-assets/glow-zone-icon-192.png",sizes:"192x192",type:"image/png"}],
    apple:"/r12-app-assets/glow-zone-icon-192.png",
    shortcut:"/r12-app-assets/glow-zone-icon-192.png",
  },
  appleWebApp:{capable:true,statusBarStyle:"black-translucent",title:"Glow Zone"},
};

export default function GlowZoneLayout({children}:{children:ReactNode}){return children;}
