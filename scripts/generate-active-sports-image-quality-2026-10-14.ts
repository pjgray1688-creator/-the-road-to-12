import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseCsvRecords } from "../lib/club-csv";

type Row = Record<string, string>;

type ImageMap = {
  brand: string;
  parent: string;
  image: string;
  sourcePage: string;
  reason: string;
  format: string;
};

const inputPath = resolve("data/active-sports/reviewed-pack/catalogue.csv");
const outputDir = resolve("data/active-sports/image-quality-2026-10-14");

const maps: ImageMap[] = [
  {
    brand: "Animal", parent: "Cuts",
    image: "https://cdn.shopify.com/s/files/1/0586/9712/2121/products/animalcuts1.webp?v=1679589462",
    sourcePage: "https://www.animaleurope.com/en-pl/products/animal-cuts",
    reason: "Replaced missing/poor family tile with the official 42-pack canister; distinct from powdered Cuts.",
    format: "42 single-dose packs in canister",
  },
  {
    brand: "Animal", parent: "Cuts Powder",
    image: "https://www.animaleurope.com/cdn/shop/files/CutsPowder_BlueIcePop_1.webp?v=1682781032&width=1946",
    sourcePage: "https://www.animaleurope.com/en/products/animal-cuts-powder",
    reason: "Replaced missing/poor tile with the official 248g powdered product pack; kept separate from 42-pack Animal Cuts.",
    format: "248g powder tub",
  },
  {
    brand: "Apex Formulas", parent: "Apex Pump",
    image: "https://apexformulas.co.uk/cdn/shop/files/Apex_Pump_-_Raspberry_Rush_-_Front_Render1.png?v=1788948888&width=1445",
    sourcePage: "https://apexformulas.co.uk/products/apex-pump",
    reason: "Replaced poor tile with a clean official front render; tub format matches the 25-serving product.",
    format: "25-serving tub",
  },
  {
    brand: "Apex Formulas", parent: "Cream Of Oats",
    image: "https://apexformulas.co.uk/cdn/shop/files/Cream_of_Oats_-_Vanilla_-_Product_Image.png?v=1772174330&width=1445",
    sourcePage: "https://apexformulas.co.uk/products/cream-of-oats",
    reason: "Replaced poor tile with an official clear pouch render; correct bulk powdered-oats format.",
    format: "2kg pouch",
  },
  {
    brand: "Apex Formulas", parent: "Joint Support",
    image: "https://apexformulas.co.uk/cdn/shop/files/ApexFormulas-JointSupport-BlackCherry-MainImage.png?v=1757691210&width=1445",
    sourcePage: "https://apexformulas.co.uk/products/joint-support",
    reason: "Replaced poor tile with the official clean tub render.",
    format: "30-serving tub",
  },
  {
    brand: "Apex Formulas", parent: "Morning Ritual",
    image: "https://apexformulas.co.uk/cdn/shop/files/Morning_Ritual_-_Citrus_Punch_-_Website_Image1_8f21fe1d-0571-4416-b935-a5bcc51bee15.png?v=1783684964&width=1445",
    sourcePage: "https://apexformulas.co.uk/products/morning-ritual",
    reason: "Replaced poor tile with an official clean tub render; image is a product flavour variant within the same family.",
    format: "30-serving tub",
  },
  {
    brand: "Apex Formulas", parent: "Stress Recovery",
    image: "https://apexformulas.co.uk/cdn/shop/files/878785EB-E841-4317-B265-E0CAF7B1C064.png?v=1764062794&width=1445",
    sourcePage: "https://apexformulas.co.uk/products/stress-recovery",
    reason: "Replaced poor tile with the official product pack shot.",
    format: "30-serving tub",
  },
  {
    brand: "Applied Nutrition", parent: "Critical Oats",
    image: "https://vnmshop.nl/cdn/shop/files/2383301666_max.jpg?v=1773068810&width=1214",
    sourcePage: "https://vnmshop.nl/products/applied-nutrition-critical-oats-protein-porridge",
    reason: "Replaced missing bulk-family tile with a clear resealable Critical Oats pouch; kept bulk sizes separate from pots.",
    format: "600g/3kg bulk pouch family",
  },
  {
    brand: "Applied Nutrition", parent: "Critical Oats Pots",
    image: "https://yakkastrength.co.uk/cdn/shop/files/1_bbb0f0c4-e6e0-417e-a26e-75dc976a8046_2400x.webp?v=1725373743",
    sourcePage: "https://yakkastrength.co.uk/",
    reason: "Split the 12 x 60g pot case from bulk Critical Oats and assigned a case-of-pots pack shot; source rows distinguish format/category/description.",
    format: "12 x 60g pots / case display",
  },
  {
    brand: "CNP Professional", parent: "Ashwagandha KSM-66",
    image: "https://cnpprofessional.co.uk/cdn/shop/files/Caps_TabsRendersAshwaghanda.png?v=1752096053",
    sourcePage: "https://cnpprofessional.co.uk/products/ashwagandha",
    reason: "Replaced missing/poor image with the CNP official 60-capsule bottle render.",
    format: "60-capsule bottle",
  },
  {
    brand: "CNP Professional", parent: "Creatine Monohydrate",
    image: "https://proteinsuperstore.co.uk/cdn/shop/files/IMG-2312_1024x1024.webp?v=1749211903",
    sourcePage: "https://proteinsuperstore.co.uk/products/copy-cnp-creatine-monohydrate-500g",
    reason: "Replaced missing/poor image with a clear CNP 500g creatine tub; product family has 250g and 500g sizes of the same powder.",
    format: "500g powder tub (same product family as 250g)",
  },
  {
    brand: "CNP Professional", parent: "Mass XL",
    image: "https://cnpprofessional.co.uk/cdn/shop/files/MassXLChocRender_7601f424-644a-46c7-a133-e479c2c69919.png?v=1752096048",
    sourcePage: "https://cnpprofessional.co.uk/products/mass-xl-4-8kg-chocolate",
    reason: "Replaced missing/poor tile with the CNP official 4.8kg Mass XL tub render.",
    format: "4.8kg tub",
  },
  {
    brand: "CNP Professional", parent: "Milk Thistle",
    image: "https://cdn.prod.website-files.com/69e756e41441f35e08959d17/6a84a2d39a287322be4d85a7_CNP-Professional_Capsules_34G_MilkThistle_1.png",
    sourcePage: "https://www.proteindepot.co.uk/catagory/vitamins-and-health",
    reason: "Replaced missing/poor image with the current CNP 60-capsule official-partner product render.",
    format: "60-capsule bottle",
  },
  {
    brand: "CNP Professional", parent: "Pro Hydrate",
    image: "https://www.thesupplementstore.co.uk/cdn/shop/files/cnp-pro-hydrate-blue-raspberry.jpg?v=1785961018&width=1920",
    sourcePage: "https://www.thesupplementstore.co.uk/collections/intra-post-workout/products/cnp-pro-hydrate",
    reason: "Replaced missing/poor tile with a crisp, exact 300g Pro Hydrate pack shot.",
    format: "300g powder tub",
  },
  {
    brand: "CNP Professional", parent: "Pro Mass",
    image: "https://cnpprofessional.co.uk/cdn/shop/files/CNP_images_1080x1080-15.png?v=1785504810&width=2000",
    sourcePage: "https://cnpprofessional.co.uk/products/pro-mass",
    reason: "Replaced missing/poor tile using the current official CNP Pro Mass product-page image.",
    format: "4.8kg powder tub",
  },
  {
    brand: "CNP Professional", parent: "Pro Recover",
    image: "https://proteinbargainwholesale.co.uk/cdn/shop/files/CNP-Recover5kgChocolateRender.webp?v=1765447525&width=3840",
    sourcePage: "https://proteinbargainwholesale.co.uk/products/cnp-pro-recover-5-04kg",
    reason: "Replaced missing/poor tile with a high-resolution Pro Recover 5kg tub render, matching the 5.04kg family.",
    format: "5.04kg recovery tub",
  },
  {
    brand: "CNP Professional", parent: "Vitamin D3 + K2",
    image: "https://cdn.prod.website-files.com/69e756e41441f35e08959d17/6a84a2da165fa1b5bf5811bd_CNP-Professional_Capsules_16G_VitaminD3_K2_1.png",
    sourcePage: "https://www.proteindepot.co.uk/catagory/vitamins-and-health",
    reason: "Replaced missing/poor image with the current CNP 30-capsule official-partner product render.",
    format: "30-capsule bottle",
  },
  {
    brand: "Dorian Yates - DY Nutrition - Shadow Line", parent: "Blood and Guts",
    image: "https://dynutrition.com/cdn/shop/products/DY_SHAD_BLOODANDGUTS_PEAR-KIWI_05.jpg?v=1680615685",
    sourcePage: "https://dynutrition.com/products/pre-workout-blood-and-guts-380g-20-servings",
    reason: "Replaced missing/poor tile with an official DY Nutrition 380g Blood & Guts tub shot.",
    format: "380g pre-workout tub",
  },
  {
    brand: "Dorian Yates - DY Nutrition - Shadow Line", parent: "Shadowhey",
    image: "https://b2b.dynutrition.com/cdn/shop/files/DY_WPC_SHADOWHEY_CONCENTRATED_vanilla_0010000.jpg?v=1774965041&width=1445",
    sourcePage: "https://b2b.dynutrition.com/products/whey-protein-shadowhey-2kg-66-servings",
    reason: "Replaced missing/poor tile with an official DY Nutrition 2kg Shadowhey pack shot; distinct from Shadowhey Isolate.",
    format: "2kg whey concentrate tub",
  },
  {
    brand: "Naughty Boy Lifestyle", parent: "Beef Zero Clear Beef Protein Isolate",
    image: "https://naughtyboylifestyle.com/cdn/shop/files/Beef-Zero-FP-1.jpg?v=1759570378&width=1946",
    sourcePage: "https://naughtyboylifestyle.com/products/naughty-boy%C2%AE-beef-zero-1800g",
    reason: "Replaced missing/poor tile with an official Beef Zero 1800g tub pack shot.",
    format: "1800g clear-beef-protein tub",
  },
  {
    brand: "Naughty Boy Lifestyle", parent: "Esco Bar",
    image: "https://images.activesportsnutrition.co.uk/products/2974/naughty-boy-esco-bar.jpg",
    sourcePage: "https://www.activesportsnutrition.co.uk/naughty-boy-esco-bar",
    reason: "Replaced missing/poor tile with the Active Sports partner case image showing the 12-bar display, not a single bar.",
    format: "12-bar display box",
  },
  {
    brand: "Naughty Boy Lifestyle", parent: "HydraMind",
    image: "https://naughtyboylifestyle.com/cdn/shop/files/Hydramind-CB.jpg?v=1709385198&width=1946",
    sourcePage: "https://naughtyboylifestyle.com/products/naughty-boy-hydramind-30-servings",
    reason: "Replaced missing/poor tile with the official 30-serving Hydramind tub image.",
    format: "30-serving tub",
  },
  {
    brand: "Naughty Boy Lifestyle", parent: "Menace V2 Pre Workout",
    image: "https://naughtyboylifestyle.com/cdn/shop/files/Menace-V2-PL.jpg?v=1738230169&width=1946",
    sourcePage: "https://naughtyboylifestyle.com/products/naughty-boy-menace%C2%AE-v2-pre-workout",
    reason: "Replaced missing/poor tile with the official Menace V2 tub render; used as one family image across serving-size/flavour variants.",
    format: "30/60-serving pre-workout tub",
  },
];

const absentRequests = [
  ["Sci-MX", "Protein Shake", "Not present in either current catalogue CSV; exact product/format cannot be matched safely."],
  ["Sci-MX", "Ultra Mass XL", "Not present in either current catalogue CSV; no row to update without inventing/importing a product."],
  ["Sci-MX", "Ultra Muscle All In One", "Not present in either current catalogue CSV; no row to update without inventing/importing a product."],
  ["Vitamin Well", "ZERO Drinks", "Not present in either current catalogue CSV; no row to update without inventing/importing a product."],
];

const csvEscape = (value: string) => /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
const csv = (headers: string[], rows: Row[]) => `${headers.join(",")}\n${rows.map(row => headers.map(header => csvEscape(row[header.toLowerCase()] ?? "")).join(",")).join("\n")}\n`;

async function main() {
  const sourceText = await readFile(inputPath, "utf8");
  const sourceRows = parseCsvRecords(sourceText, true);
  if (sourceRows.length !== 3531) throw new Error(`Expected 3,531 source variants, got ${sourceRows.length}`);
  const headers = [...new Set(sourceText.split(/\r?\n/, 1)[0].replace(/^\uFEFF/, "").split(",").map(value => value.trim().replace(/^"|"$/g, "")))];
  const byFamily = new Map<string, ImageMap>();
  for (const map of maps) {
    const key = `${map.brand.toLowerCase()}|${map.parent.toLowerCase()}`;
    if (byFamily.has(key)) throw new Error(`Duplicate image mapping for ${key}`);
    byFamily.set(key, map);
  }

  const changedFamilies = new Map<string, { map: ImageMap; oldImage: string; rowCount: number }>();
  const outputRows = sourceRows.map(row => {
    const next = { ...row };
    const brand = row.brand ?? "";
    const currentParent = row["parent product"] ?? "";
    const isCriticalOatsPots = brand.toLowerCase() === "applied nutrition"
      && currentParent.toLowerCase() === "critical oats"
      && /pots/i.test(row["size / format"] ?? "");
    const parent = isCriticalOatsPots ? "Critical Oats Pots" : currentParent;
    if (isCriticalOatsPots) next["parent product"] = parent;

    const map = byFamily.get(`${brand.toLowerCase()}|${parent.toLowerCase()}`);
    if (map) {
      const familyKey = `${map.brand}|${map.parent}`;
      const before = next["parent image url"] || next["variant image url"] || "";
      if (next["parent image url"] !== map.image) {
        next["parent image url"] = map.image;
        next["image status"] = "Verified pack shot - 2026-10-14";
        const existing = changedFamilies.get(familyKey);
        changedFamilies.set(familyKey, { map, oldImage: existing?.oldImage ?? before, rowCount: (existing?.rowCount ?? 0) + 1 });
      } else {
        const existing = changedFamilies.get(familyKey);
        changedFamilies.set(familyKey, { map, oldImage: existing?.oldImage ?? before, rowCount: (existing?.rowCount ?? 0) + 1 });
      }
    }
    return next;
  });

  const allowedChangedFields = new Set(["parent product", "parent image url", "image status"]);
  for (let index = 0; index < sourceRows.length; index += 1) {
    const before = sourceRows[index];
    const after = outputRows[index];
    for (const field of Object.keys(before)) {
      if (before[field] === after[field]) continue;
      if (!allowedChangedFields.has(field)) throw new Error(`Unexpected non-image data change on source row ${index + 2}: ${field}`);
      if (field === "parent product" && !(before.brand === "Applied Nutrition" && before[field] === "Critical Oats" && /pots/i.test(before["size / format"] ?? "") && after[field] === "Critical Oats Pots")) {
        throw new Error(`Unexpected family-name change on source row ${index + 2}`);
      }
    }
    if (before["variant image url"] !== after["variant image url"]) throw new Error(`Variant image unexpectedly changed on source row ${index + 2}`);
  }
  for (const row of outputRows) {
    for (const field of ["parent image url", "variant image url"]) {
      const value = row[field];
      if (value && !/^https?:\/\//i.test(value)) throw new Error(`Non-HTTP image URL on ${row.brand} ${row["parent product"]}`);
    }
  }

  const outFamilies = new Map<string, Row>();
  for (const row of outputRows) outFamilies.set(`${row.brand}|${row["parent product"]}`, row);
  for (const key of byFamily.keys()) {
    const [brand, parent] = key.split("|");
    if (![...outFamilies.keys()].some(family => family.toLowerCase() === `${brand}|${parent}`)) {
      throw new Error(`Mapped family not found in output: ${brand} ${parent}`);
    }
  }
  if (changedFamilies.size !== maps.length) throw new Error(`Expected ${maps.length} changed families, got ${changedFamilies.size}`);

  const changedKeys = new Set([...changedFamilies.keys()].map(key => key.toLowerCase()));
  const auditRows: Row[] = [...changedFamilies.values()].map(({ map, oldImage, rowCount }) => ({
    "parent/family name": map.parent,
    brand: map.brand,
    "old image": oldImage,
    "new image": map.image,
    "reason for change": map.reason,
    "source used": map.sourcePage,
    "source image URL": map.image,
    "format verified": map.format,
    "variant rows updated": String(rowCount),
  }));

  const reviewRows: Row[] = [];
  for (const [familyKey, row] of outFamilies) {
    if (row["parent image url"] || row["variant image url"]) continue;
    if (changedKeys.has(familyKey.toLowerCase())) continue;
    reviewRows.push({
      brand: row.brand,
      "parent/family name": row["parent product"],
      "size / format examples": row["size / format"],
      "current parent image": row["parent image url"],
      "current variant image": row["variant image url"],
      severity: "Critical - missing image",
      "review reason": "No parent or variant image URL exists in the reviewed import source; no verified pack shot was established in this pass.",
      "suggested next action": "Obtain or approve a supplier/official pack shot before publishing this family tile.",
      "source rows": String(outputRows.filter(candidate => candidate.brand === row.brand && candidate["parent product"] === row["parent product"]).length),
    });
  }
  for (const [brand, parent, reason] of absentRequests) reviewRows.push({
    brand,
    "parent/family name": parent,
    "size / format examples": "",
    "current parent image": "",
    "current variant image": "",
    severity: "Requested product absent from source",
    "review reason": reason,
    "suggested next action": "Confirm current sellable SKU and exact pack format in the supplier source, then add through the normal catalogue workflow in a separate approved data pass.",
    "source rows": "0",
  });

  const fullHeaders = Object.keys(sourceRows[0] ?? {});
  const fullCsvHeaders = headers;
  const patchRows = outputRows.filter((row, index) => {
    const old = sourceRows[index];
    return row["parent product"] !== old["parent product"]
      || row["parent image url"] !== old["parent image url"]
      || row["image status"] !== old["image status"];
  });

  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, "active-sports-catalogue-image-quality-2026-10-14.csv"), csv(fullCsvHeaders, outputRows));
  await writeFile(resolve(outputDir, "active-sports-image-patch-2026-10-14.csv"), csv(fullCsvHeaders, patchRows));
  await writeFile(resolve(outputDir, "active-sports-image-audit-2026-10-14.csv"), csv([
    "parent/family name", "brand", "old image", "new image", "reason for change", "source used", "source image URL", "format verified", "variant rows updated",
  ], auditRows));
  await writeFile(resolve(outputDir, "active-sports-image-review-2026-10-14.csv"), csv([
    "brand", "parent/family name", "size / format examples", "current parent image", "current variant image", "severity", "review reason", "suggested next action", "source rows",
  ], reviewRows));

  const initialFamilies = new Set(sourceRows.map(row => `${row.brand}|${row["parent product"]}`));
  const imageFamilies = new Set(outputRows.filter(row => row["parent image url"] || row["variant image url"]).map(row => `${row.brand}|${row["parent product"]}`));
  console.log(JSON.stringify({
    sourceVariants: sourceRows.length,
    sourceParentFamilies: initialFamilies.size,
    outputParentFamilies: outFamilies.size,
    changedParentFamilies: changedFamilies.size,
    changedVariantRows: patchRows.length,
    outputFamiliesWithImages: imageFamilies.size,
    unresolvedMissingImageFamilies: reviewRows.filter(row => row.severity === "Critical - missing image").length,
    requestedButAbsentFamilies: absentRequests.length,
    fullHeaders: fullHeaders.length,
    outputDir,
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
