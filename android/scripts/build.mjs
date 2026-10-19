import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const app = process.argv[2];
const signed = process.argv.includes("--signed");
if (!app || !["r12", "club", "coach", "glow-zone"].includes(app)) throw new Error("Usage: node android/scripts/build.mjs <r12|club|coach|glow-zone> [--signed]");
const cwd = resolve(import.meta.dirname, `../apps/${app}`);
const config = JSON.parse(readFileSync(resolve(cwd, "twa-manifest.json"), "utf8"));
if (signed) {
  if (!existsSync(resolve(cwd, config.signingKey.path))) throw new Error(`Missing external upload keystore: ${config.signingKey.path}`);
  if (!process.env.BUBBLEWRAP_KEYSTORE_PASSWORD || !process.env.BUBBLEWRAP_KEY_PASSWORD) throw new Error("Set BUBBLEWRAP_KEYSTORE_PASSWORD and BUBBLEWRAP_KEY_PASSWORD from your secure vault before a signed build.");
}
for (const args of [["update", "--skipVersionUpgrade"], ["build", ...(signed ? [] : ["--skipSigning"])]]) {
  const result = spawnSync("bubblewrap", args, { cwd, stdio: "inherit" });
  if (result.error?.code === "ENOENT") throw new Error("Bubblewrap CLI is not installed. Follow android/README.md.");
  if (result.status !== 0) process.exit(result.status ?? 1);
  if (args[0] === "update") {
    const gradlePath = resolve(cwd, "app/build.gradle");
    if (!existsSync(gradlePath) || !/targetSdkVersion\s+36\b/.test(readFileSync(gradlePath, "utf8"))) throw new Error(`${app}: generated Gradle project must target API 36 before an AAB can be built. Update Bubblewrap and try again.`);
  } else {
    const bundle = resolve(cwd, "app-release-bundle.aab");
    const gradleBundle = resolve(cwd, "app/build/outputs/bundle/release/app-release.aab");
    if (!existsSync(bundle) && !existsSync(gradleBundle)) throw new Error(`${app}: Bubblewrap completed without producing an AAB.`);
    console.log(`AAB ready: ${existsSync(bundle) ? bundle : gradleBundle}`);
  }
}
