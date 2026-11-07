import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { accessQrMatrix } from "../lib/qr-code.ts";
import { APP_DOWNLOAD_LINKS, PERMANENT_QR_DESTINATIONS } from "../lib/app-download-links.ts";

const require = createRequire(import.meta.url);
const sharp = require("sharp");
const output = new URL("../public/app-download-qr/", import.meta.url);
await mkdir(output, { recursive: true });
const moduleSize = 24;
const quietModules = 4;
const size = (33 + quietModules * 2) * moduleSize;

for (const [slug, app] of Object.entries(APP_DOWNLOAD_LINKS)) {
  const destination = PERMANENT_QR_DESTINATIONS[slug];
  const matrix = accessQrMatrix(destination);
  const paths = matrix.flatMap((row, y) => row.flatMap((dark, x) => dark ? [`M${(x + quietModules) * moduleSize},${(y + quietModules) * moduleSize}h${moduleSize}v${moduleSize}h-${moduleSize}z`] : [])).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${paths}" fill="#08090c"/></svg>`;
  await writeFile(new URL(`${slug}.svg`, output), svg);
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9, adaptiveFiltering: false }).toFile(fileURLToPath(new URL(`${slug}.png`, output)));
  console.log(`${app.name}: ${destination}`);
}
