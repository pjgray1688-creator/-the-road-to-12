import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { APP_DOWNLOAD_LINKS, appOpenUrl, detectDownloadPlatform, isAppDownloadSlug } from "@/lib/app-download-links";
import styles from "./smart-download.module.css";

type Props = { params: Promise<{ app: string }> };

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props) {
  const { app: slug } = await params;
  if (!isAppDownloadSlug(slug)) return { title: "R12 Apps" };
  const app = APP_DOWNLOAD_LINKS[slug];
  return { title: `Get ${app.name} | R12`, description: `Download ${app.name} from the official app store.` };
}

export default async function SmartDownloadPage({ params }: Props) {
  const { app: slug } = await params;
  if (!isAppDownloadSlug(slug)) notFound();

  const app = APP_DOWNLOAD_LINKS[slug];
  const agent = (await headers()).get("user-agent");
  const platform = detectDownloadPlatform(agent);
  const appUrl = appOpenUrl(slug);
  const primaryLabel = platform === "ios" ? "View in the App Store" : platform === "android" ? "View in Google Play" : "Choose your app store";

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="download-title">
        <div className={styles.brandMark} aria-hidden="true">R12</div>
        <p className={styles.eyebrow}>R12 APPS</p>
        <h1 id="download-title">Get {app.name}</h1>
        <p className={styles.intro}>Choose your app store below. If you already have the app, you can also open its R12 link.</p>

        <div className={styles.actions}>
          {platform === "ios" && <a className={styles.primary} href={app.apple}>{primaryLabel}<span aria-hidden="true">↗</span></a>}
          {platform === "android" && <a className={styles.primary} href={app.googlePlay}>{primaryLabel}<span aria-hidden="true">↗</span></a>}
          {(platform === "desktop" || platform === "unknown") && <p className={styles.chooseLabel}>Download from your store</p>}
          <div className={styles.storeLinks}>
            <a className={platform === "ios" ? styles.secondary : styles.store} href={app.apple}>Apple App Store <span aria-hidden="true">↗</span></a>
            <a className={platform === "android" ? styles.secondary : styles.store} href={app.googlePlay}>Google Play <span aria-hidden="true">↗</span></a>
          </div>
          <a className={styles.openApp} href={appUrl}>Open {app.name}<span aria-hidden="true">→</span></a>
        </div>
        <p className={styles.note}>Store availability depends on your region and device. The Open App link may open the installed app or continue in your browser.</p>
      </section>
      <footer className={styles.footer}>R12 · Train with purpose</footer>
    </main>
  );
}
