-- Reviewed follow-up for Club organisation co-branding. Not executed.
alter table if exists public.club_organisations add column if not exists branding jsonb not null default '{"coBranding":"r12"}'::jsonb;
comment on column public.club_organisations.branding is 'Validated R12-controlled organisation theme references and accent tokens; never arbitrary CSS.';
