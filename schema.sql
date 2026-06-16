-- Morning Briefing — Supabase schema.
-- Paste this once into the Supabase SQL editor (Project → SQL Editor → New query).
-- Safe to re-run: every statement is IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.

-- gen_random_uuid() comes from pgcrypto, which Supabase enables by default.
create extension if not exists pgcrypto;

-- People who signed up via the /signup landing page.
create table if not exists signups (
  id              bigint generated always as identity primary key,
  name            text not null,
  email           text not null,
  company         text,
  token           uuid not null default gen_random_uuid(),  -- per-row unsubscribe token
  unsubscribed_at timestamptz,                              -- null = active subscriber
  created_at      timestamptz not null default now()
);

-- If you created `signups` before adding unsubscribe support, backfill the columns:
alter table signups add column if not exists token uuid not null default gen_random_uuid();
alter table signups add column if not exists unsubscribed_at timestamptz;

-- Small key/value store. Used for the personal-mode recipient ("briefing_recipient").
create table if not exists settings (
  key   text primary key,
  value text
);
