import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MemoryClubRepository } from "../lib/club-repository";

const migration = readFileSync(new URL("../supabase/migrations/2026-09-11-club-induction.sql", import.meta.url), "utf8");

test("induction migration is additive, disabled by default and organisation scoped", () => {
  assert.match(migration, /create table if not exists public\.club_induction_policies/i);
  assert.match(migration, /requirement in \('none','online_or_in_person','in_person'\)/i);
  assert.match(migration, /grace_days integer not null default 0 check \(grace_days >= 0\)/i);
  assert.match(migration, /active boolean not null default true/i);
  assert.match(migration, /alter table public\.club_induction_policies enable row level security/i);
  assert.match(migration, /revoke all on public\.club_induction_policies[^;]+from public, anon, authenticated/i);
  assert.match(migration, /appointment_extension_enabled/i);
  assert.match(migration, /requires_reacknowledgement/i);
});

test("induction state and access integration use authoritative RPC boundaries", () => {
  for (const name of ["club_get_member_induction_state", "club_check_member_location_access", "club_complete_online_induction", "club_book_induction", "club_reconcile_induction_booking"]) assert.equal((migration.match(new RegExp(`create or replace function public\\.${name}\\(`, "gi")) ?? []).length, 1);
  assert.match(migration, /create or replace function public\.club_get_member_induction_state/i);
  assert.match(migration, /create or replace function public\.club_check_member_location_access/i);
  assert.match(migration, /club_check_member_location_access_base/i);
  assert.match(migration, /auth\.uid\(\) is null or \(auth\.uid\(\)<>p_user_id/i);
  assert.match(migration, /'induction_overdue'/i);
  assert.match(migration, /'access_effect',case when v_state='overdue' and v_policy\.overdue_access='hold' then 'hold'/i);
  assert.match(migration, /club_complete_online_induction/i);
  assert.match(migration, /club_reconcile_induction_booking/i);
  assert.match(migration, /club_save_induction_policy/i);
  assert.match(migration, /club_save_induction_version/i);
  assert.match(migration, /club_has_active_role\(p_organisation_id,array\['gym_admin','owner'\]\)/i);
  assert.match(migration, /set search_path=pg_catalog,public/i);
  assert.match(migration, /revoke all on function public\.club_get_member_induction_state/i);
  assert.match(migration, /grant execute on function public\.club_get_member_induction_state[^;]+to authenticated/i);
});

test("induction lifecycle keeps completion and appointment state auditable", () => {
  assert.match(migration, /club_member_induction_completions[\s\S]*acknowledgement_version/i);
  assert.match(migration, /route text not null check \(route in \('online','in_person'\)\)/i);
  assert.match(migration, /status text not null default 'booked' check \(status in \('booked','completed','cancelled','no_show'\)\)/i);
  assert.match(migration, /unique index if not exists club_induction_bookings_one_active_idx/i);
  assert.match(migration, /verified_by uuid references auth\.users/i);
  assert.match(migration, /p_status not in \('completed','cancelled','no_show'\)/i);
});

test("memory repository keeps induction disabled until configured", async () => {
  const repository = new MemoryClubRepository();
  const state = await repository.getMemberInduction("org", "user");
  assert.equal(state.state.state, "not_required");
  assert.equal(state.state.required, false);
});
