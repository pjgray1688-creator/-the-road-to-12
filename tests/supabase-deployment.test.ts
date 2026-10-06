import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import test from "node:test";

const manifestPath = "supabase/deployment/2026-11-22-madhouse-launch-migrations.txt";
const manifest = readFileSync(manifestPath, "utf8");
const migrations = manifest.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith("#"));
const runner = readFileSync("scripts/apply-madhouse-schema.sh", "utf8");
const profile = readFileSync("supabase/deployment/2026-11-22-r12-profile-foundation.sql", "utf8");
const manualBundlePath = "supabase/deployment/2026-11-22-madhouse-manual-reconciliation.sql";
const manualBundle = readFileSync(manualBundlePath, "utf8");
const finalBundlePath = "supabase/deployment/2026-11-22-madhouse-final-state-reconciliation.sql";
const finalBundle = readFileSync(finalBundlePath, "utf8");
const commerceFoundation = readFileSync("supabase/migrations/2026-09-08-club-commerce-payments-inventory.sql", "utf8");
const commerceBrand = readFileSync("supabase/migrations/2026-09-20-club-commerce-product-brand.sql", "utf8");

test("deployment manifest contains existing files in dependency order", () => {
  assert.ok(migrations.length > 70);
  for (const file of migrations) assert.equal(existsSync(file), true, file);
  assert.equal(new Set(migrations).size, migrations.length);
  const position = (name: string) => migrations.indexOf(name);
  assert.ok(position("supabase/migrations/2026-09-22-club-supplier-commerce.sql") < position("supabase/migrations/2026-10-13-club-supplier-catalogue-parent-variants.sql"));
  assert.ok(position("supabase/migrations/2026-10-13-club-supplier-catalogue-parent-variants.sql") < position("supabase/migrations/2026-09-15-shared-shop-supplier-catalogue.sql"));
  assert.ok(position("supabase/migrations/2026-10-13-glow-zone-transactional.sql") < position("supabase/migrations/2026-09-17-glow-age-status-read.sql"));
  assert.ok(position("supabase/migrations/2026-09-03-club-foundation.sql") < position("supabase/migrations/2026-09-03-club-branding.sql"));
  assert.ok(position("supabase/migrations/2026-09-13-club-staff-capabilities-audit.sql") < position("supabase/migrations/2026-09-06-club-staff-access-grants.sql"));
});

test("deployment runner is ledgered, deterministic and stops on unexpected SQL errors", () => {
  assert.match(runner, /ON_ERROR_STOP=1/);
  assert.match(runner, /r12_schema_migrations/);
  assert.match(runner, /manual-baseline/);
  assert.match(runner, /Checksum mismatch/);
  assert.match(runner, /exit 4/);
  assert.doesNotMatch(runner, /supabase db push/);
  assert.doesNotMatch(runner, /auth\.users|create user|insert into public\.club_members/i);
});

test("deployment package explicitly excludes destructive and data-seeding artifacts", () => {
  assert.doesNotMatch(manifest, /club-go-live-reset/);
  assert.doesNotMatch(manifest, /morning-stocktake|rotherham-stocktake|missing-seven/);
  assert.doesNotMatch(manifest, /reviewed-family-images|backfill-active-sports-generated-prices/);
});

test("profile foundation is additive and preserves existing accounts and rows", () => {
  assert.match(profile, /create table if not exists public\.profiles/);
  for (const field of ["email", "display_name", "first_name", "last_name", "timezone", "step_goal", "goals", "training_profile", "generated_programme", "active_programme_id", "updated_at"]) assert.match(profile, new RegExp(`add column if not exists ${field}`));
  assert.match(profile, /on delete cascade/);
  assert.doesNotMatch(profile, /insert into auth\.users/i);
});

test("manual reconciliation bundle is a single-paste schema contract", () => {
  assert.ok(existsSync(manualBundlePath));
  assert.match(manualBundle, /R12 MADHOUSE MANUAL SCHEMA RECONCILIATION/);
  assert.match(manualBundle, /2026-11-22-r12-profile-foundation\.sql/);
  assert.match(manualBundle, /2026-11-22-r12-deployment-ledger\.sql/);
  for (const required of [
    "2026-11-16-club-staff-permission-model.sql",
    "2026-11-17-club-staff-account-onboarding.sql",
    "2026-11-18-member-acquisition-onboarding.sql",
    "2026-11-19-madhouse-billing-and-tutorials.sql",
    "2026-11-20-club-venue-checks-maintenance.sql",
    "2026-11-21-notification-engine.sql",
    "2026-10-13-club-supplier-catalogue-parent-variants.sql",
  ]) assert.match(manualBundle, new RegExp(required.replaceAll(".", "\\.")));
  for (const baseline of [
    "2026-09-03-club-foundation.sql",
    "2026-09-06-club-staff-access-grants.sql",
    "2026-09-26-coach-safe-workflow.sql",
    "2026-10-05-coach-organisation-boundary.sql",
    "2026-10-05-coach-staff-access-management.sql",
  ]) assert.doesNotMatch(manualBundle, new RegExp(`APPLY supabase/migrations/${baseline}`));
  for (const excluded of [
    "club-go-live-reset.sql",
    "morning-stocktake.sql",
    "rotherham-stocktake.sql",
    "reviewed-family-images.sql",
    "backfill-active-sports-generated-prices.sql",
  ]) assert.doesNotMatch(manualBundle, new RegExp(excluded));
  assert.match(manualBundle, /create table if not exists public\.profiles/);
  assert.match(manualBundle, /READ-ONLY READINESS DIAGNOSTICS/);
  assert.match(manualBundle, /SCHEMA READY — RUN MADHOUSE BOOTSTRAP NEXT/);
  assert.doesNotMatch(manualBundle, /insert into auth\.users/i);
  assert.doesNotMatch(manualBundle, /insert into public\.club_organisations\s*\([^)]*\)\s*values/i);
  assert.match(manualBundle, /r12_schema_migrations/);
});

test("manual bundle contains the missing foundations before dependent historical patches", () => {
  const position = (value: string) => manualBundle.indexOf(value);
  assert.ok(position("-- === R12 WHOOP FOUNDATION ===") > 0);
  assert.ok(position("create table if not exists public.whoop_connections") < position("-- === APPLY supabase/migrations/2026-08-30-whoop-persistence.sql ==="));
  assert.ok(position("create table if not exists public.whoop_records") < position("-- === APPLY supabase/migrations/2026-08-30-whoop-persistence.sql ==="));
  for (const field of ["access_token_encrypted", "refresh_token_encrypted", "expires_at", "scopes", "connected_at", "last_sync_at"]) assert.match(manualBundle, new RegExp(`whoop_connections[\\s\\S]{0,1800}${field}`));
  for (const field of ["provider_id", "record_type", "provider_timestamp", "payload", "synced_at"]) assert.match(manualBundle, new RegExp(`whoop_records[\\s\\S]{0,1800}${field}`));
  assert.ok(position("-- === APPLY supabase/migrations/2026-08-31-workout-persistence.sql ===") < position("-- === APPLY supabase/migrations/2026-09-01-training-programmes.sql ==="));
  assert.ok(migrations.indexOf("supabase/migrations/2026-08-31-workout-persistence.sql") < migrations.indexOf("supabase/migrations/2026-09-26-coach-safe-workflow.sql"));
  assert.ok(position("-- === APPLY supabase/migrations/2026-10-13-club-supplier-catalogue-parent-variants.sql ===") < position("-- === APPLY supabase/migrations/2026-09-15-shared-shop-supplier-catalogue.sql ==="));
  assert.ok(position("-- === APPLY supabase/migrations/2026-10-13-glow-zone-transactional.sql ===") < position("-- === APPLY supabase/migrations/2026-09-17-glow-age-status-read.sql ==="));
  assert.ok(position("-- === APPLY supabase/migrations/2026-11-20-club-venue-checks-maintenance.sql ===") < position("-- === APPLY supabase/migrations/2026-11-21-notification-engine.sql ==="));
  assert.match(manualBundle, /create table if not exists public\.club_member_notification_intents/);
  assert.match(manualBundle, /create table if not exists public\.club_checklist_templates/);
});

test("supplier RPCs use the final commerce and supplier column contracts", () => {
  for (const column of ["id", "organisation_id", "sku", "barcode", "name", "description", "category", "active", "stock_tracked", "sell_price_minor", "cost_price_minor", "currency", "tax_code", "supplier_reference", "media"]) {
    assert.match(commerceFoundation, new RegExp(`\\b${column}\\b`));
  }
  assert.match(commerceBrand, /add column if not exists brand text/);
  const aliases: Record<string, string[]> = {
    cp: ["brand", "category", "id", "media", "name", "organisation_id", "sell_price_minor", "stock_tracked"],
    sp: ["active", "availability_checked_at", "availability_status", "barcode", "brand", "category", "club_product_id", "cost_source", "created_at", "description", "discontinued", "fulfilment_type", "id", "import_identity", "local_product_id", "manual_price", "member_orderable_unit", "name", "organisation_id", "pack_quantity", "parent_product_id", "retail_price_minor", "sellable", "size", "supplied_vat_rate", "supplier_availability", "supplier_id", "supplier_rrp_minor", "supplier_sku", "trade_cost_ex_vat_minor", "variant", "variant_image_url", "wholesale_cost_minor"],
    pp: ["active", "archived_at", "brand", "category", "description", "id", "name", "organisation_id", "parent_image_url", "parent_key", "source_url", "subcategory", "supplier_id"],
  };
  const supplierContract = manualBundle.slice(0, manualBundle.indexOf("-- === APPLY supabase/migrations/2026-11-16-club-staff-permission-model.sql ==="));
  for (const [alias, allowed] of Object.entries(aliases)) {
    const used = new Set([...supplierContract.matchAll(new RegExp(`\\b${alias}\\.([a-z_][a-z0-9_]*)`, "gi"))].map(match => match[1].toLowerCase()));
    for (const column of used) assert.ok(allowed.includes(column), `${alias}.${column} is not in the final table contract`);
  }
  const brandSection = manualBundle.indexOf("-- === APPLY supabase/migrations/2026-09-20-club-commerce-product-brand.sql ===");
  const supplierSection = manualBundle.indexOf("-- === APPLY supabase/migrations/2026-09-22-club-supplier-commerce.sql ===");
  const demandFunction = manualBundle.indexOf("create or replace function public.club_list_supplier_demand");
  assert.ok(brandSection < supplierSection);
  assert.ok(supplierSection < demandFunction);
  assert.match(manualBundle, /club_list_supplier_demand[\s\S]*'brand',coalesce\(cp\.brand,sp\.brand\)/);
  assert.match(manualBundle, /do \$constraint\$[\s\S]*club_commerce_products_brand_length/);
});

test("final-state reconciliation is the smaller canonical deployment package", () => {
  assert.ok(existsSync(finalBundlePath));
  assert.ok(finalBundle.split(/\r?\n/).length < manualBundle.split(/\r?\n/).length);
  assert.match(finalBundle, /R12 MADHOUSE FINAL-STATE RECONCILIATION/);
  assert.match(finalBundle, /Copy this entire file into Supabase SQL Editor and run once/);
  assert.match(finalBundle, /FINAL RECONCILIATION MARKER/);
  assert.match(finalBundle, /READ-ONLY FINAL CONTRACT DIAGNOSTICS/);
  assert.match(finalBundle, /SCHEMA READY — RUN MADHOUSE BOOTSTRAP NEXT/);
  assert.doesNotMatch(finalBundle, /pg_get_functiondef/i);
  assert.doesNotMatch(finalBundle, /Expected promotion alias was not found/i);
  assert.doesNotMatch(finalBundle, /Expected finalisation promotion alias was not found/i);
  assert.doesNotMatch(finalBundle, /historical function-definition string replacement/i);
  assert.doesNotMatch(finalBundle, /club-go-live-reset|morning-stocktake|rotherham-stocktake|backfill-active-sports-generated-prices/i);
  assert.doesNotMatch(finalBundle, /insert into auth\.users/i);
  assert.doesNotMatch(finalBundle, /insert into public\.club_organisations\s*\([^)]*\)\s*values/i);
});

test("final-state package contains the current launch contract and canonical repair-chain results", () => {
  for (const objectName of [
    "public.profiles",
    "public.whoop_connections",
    "public.whoop_records",
    "public.workout_sessions",
    "public.club_organisations",
    "public.club_locations",
    "public.club_members",
    "public.club_customers",
    "public.club_memberships",
    "public.club_orders",
    "public.club_commerce_products",
    "public.club_supplier_products",
    "public.club_supplier_parent_products",
    "public.club_supplier_variant_prices",
    "public.coach_permissions",
    "public.club_checklist_templates",
    "public.club_equipment_assets",
    "public.club_maintenance_issues",
    "public.club_member_notification_intents",
  ]) assert.match(finalBundle, new RegExp(objectName.replaceAll(".", "\\.")), objectName);

  for (const routineName of [
    "club_evaluate_commerce_promotions",
    "club_finalize_paid_order",
    "club_list_supplier_demand",
    "club_create_staff_access_grant",
    "club_claim_staff_access_grant",
    "club_start_membership_joining",
    "club_claim_existing_member",
    "club_submit_daily_check",
    "club_claim_notification_intents",
  ]) assert.match(finalBundle, new RegExp(`function public\\.${routineName}`), routineName);

  assert.match(finalBundle, /alter table public\.club_commerce_products add column if not exists brand text/);
  assert.match(finalBundle, /'brand',coalesce\(cp\.brand,sp\.brand\)/);
  assert.match(finalBundle, /applied_promotion\.promotion_id/);
  assert.match(finalBundle, /as applied_item/);
  assert.match(finalBundle, /club_stock_movements_idempotency_unique/);
  assert.match(finalBundle, /club_stock_movements[\s\S]*on conflict[\s\S]*where idempotency_key is not null/);
  assert.doesNotMatch(finalBundle, /FINAL CONTRACT: 2026-10-06-fix-commerce-promotion-alias\.sql/);
  assert.doesNotMatch(finalBundle, /FINAL CONTRACT: 2026-10-07-fix-finalise-promotion-alias\.sql/);
  assert.doesNotMatch(finalBundle, /FINAL CONTRACT: 2026-10-08-fix-stock-idempotency-constraint\.sql/);
  assert.doesNotMatch(finalBundle, /FINAL CONTRACT: 2026-10-09-fix-stock-conflict-target\.sql/);
});

test("final-state package has no historical string-repair blocks and keeps bootstrap separate", () => {
  assert.doesNotMatch(finalBundle, /declare\s+definition\s+text[\s\S]{0,600}execute\s+definition/i);
  assert.doesNotMatch(finalBundle, /madhouse-first-organisation-bootstrap\.sql/i);
  assert.match(finalBundle, /no Auth users, tenants, members, memberships, payments/);
  assert.match(finalBundle, /select count\(\*\) as organisations/);
  assert.match(finalBundle, /select count\(\*\) as coach_permissions/);
});

test("final-state package handles the staff-permission return-type transition", () => {
  const legacy = readFileSync("supabase/migrations/2026-09-13-club-staff-capabilities-audit.sql", "utf8");
  const current = readFileSync("supabase/migrations/2026-11-16-club-staff-permission-model.sql", "utf8");
  const returnType = (sql: string) => sql.match(/create(?: or replace)? function public\.club_save_staff_permission\([^)]*\)\s*returns\s+(\w+)/i)?.[1];

  assert.equal(returnType(legacy), "jsonb");
  assert.equal(returnType(current), "void");
  assert.equal((finalBundle.match(/drop function if exists public\.club_save_staff_permission\(uuid,uuid,text,text\);/g) ?? []).length, 1);
  assert.match(finalBundle, /drop function if exists public\.club_save_staff_permission\(uuid,uuid,text,text\);\s*create or replace function public\.club_save_staff_permission\([^)]*\)\s*returns void/i);
  assert.match(finalBundle, /revoke all on function public\.club_save_staff_permission\(uuid,uuid,text,text\)/i);
  assert.match(finalBundle, /grant execute on function public\.club_save_staff_permission\(uuid,uuid,text,text\) to authenticated/i);
});

test("final-state schema objects are replay-safe", () => {
  const lines = finalBundle.split(/\r?\n/);

  const rowtypeOrRecordVariables = new Set<string>();
  for (const match of finalBundle.matchAll(/\b([a-z_][a-z0-9_]*)\s+(?:public\.[a-z_][a-z0-9_]*%rowtype|record)\b/gi)) {
    rowtypeOrRecordVariables.add(match[1].toLowerCase());
  }
  for (const match of finalBundle.matchAll(/\binto\s+([a-z_][a-z0-9_]*(?:\s*,\s*[a-z_][a-z0-9_]*)+)\s*(?=from|;|\n)/gi)) {
    const firstTarget = match[1].split(",")[0].trim().toLowerCase();
    assert.equal(
      rowtypeOrRecordVariables.has(firstTarget),
      false,
      `record/rowtype variable cannot be part of a multi-target INTO list: ${match[0]}`,
    );
  }
  assert.match(finalBundle, /select p\.\* into v_product[\s\S]*?select slug into v_slug/i);

  assert.match(
    finalBundle,
    /create or replace function public\.club_import_supplier_catalogue\(p_organisation_id uuid,p_supplier_name text,p_file_name text,p_rows jsonb\)/i,
  );
  assert.match(
    finalBundle,
    /create or replace function public\.club_import_supplier_catalogue_v2\(p_organisation_id uuid,p_supplier_name text,p_file_name text,p_rows jsonb,p_reconcile boolean default false\)/i,
  );

  const bareFunctions = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^\s*create function\s+public\./i.test(line));
  for (const { line, index } of bareFunctions) {
    const name = line.match(/^\s*create function\s+public\.([a-z0-9_]+)/i)?.[1];
    assert.ok(name, `function declaration is parseable: ${line}`);
    const surrounding = lines.slice(Math.max(0, index - 12), index + 1).join("\n");
    assert.match(surrounding, new RegExp(`drop function if exists public\\.${name}`, "i"), line);
  }

  const policyCreations = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^\s*create policy\s+/i.test(line));
  assert.equal(policyCreations.length, 15);
  for (const { line, index } of policyCreations) {
    const name = line.match(/^\s*create policy\s+(?:"([^"]+)"|([a-z0-9_]+))/i)?.[1] ?? line.match(/^\s*create policy\s+(?:"([^"]+)"|([a-z0-9_]+))/i)?.[2];
    const table = line.match(/\bon\s+(public\.[a-z0-9_]+)/i)?.[1];
    assert.ok(name && table, `policy declaration is parseable: ${line}`);
    const preceding = lines.slice(Math.max(0, index - 8), index + 1).join("\n");
    const dropPattern = new RegExp(`drop policy if exists ["']?${name!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']? on ${table}`, "i");
    const guarded = /if\s+not\s+exists\s*\(\s*select\s+1\s+from\s+pg_policies/i.test(preceding);
    assert.ok(dropPattern.test(preceding) || guarded, `policy is not guarded or recreated: ${line}`);
  }

  const triggerCreations = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^\s*create trigger\s+/i.test(line));
  for (const { line, index } of triggerCreations) {
    const name = line.match(/^\s*create trigger\s+([a-z0-9_]+)/i)?.[1];
    assert.ok(name, `trigger declaration is parseable: ${line}`);
    const preceding = lines.slice(Math.max(0, index - 6), index + 1).join("\n");
    assert.match(preceding, new RegExp(`drop trigger if exists ${name}`, "i"), line);
  }

  for (const line of lines.filter(line => /^\s*create (?:unique )?index\s+/i.test(line))) {
    assert.match(line, /create (?:unique )?index if not exists /i, line);
  }

  for (const { line, index } of lines.map((line, index) => ({ line, index })).filter(({ line }) => /\badd constraint\s+([a-z0-9_]+)/i.test(line))) {
    const name = line.match(/\badd constraint\s+([a-z0-9_]+)/i)![1];
    const surrounding = lines.slice(Math.max(0, index - 20), index + 8).join("\n");
    const guarded = /if\s+not\s+exists\s*\(\s*select\s+1\s+from\s+pg_constraint/i.test(surrounding)
      || /exception\s+when\s+duplicate_object/i.test(surrounding);
    assert.ok(
      new RegExp(`drop constraint if exists ${name}`, "i").test(surrounding) || guarded,
      `constraint is not guarded or recreated: ${line}`,
    );
  }

  assert.doesNotMatch(finalBundle, /^\s*create (?:type|view|materialized view)\b/im);
});
