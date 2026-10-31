-- Run this once in Supabase > SQL Editor > New query > Run.
create table if not exists public.players (
  id              uuid primary key default gen_random_uuid(),
  username        text not null,
  username_lower  text not null unique,
  pass_salt       text not null,
  pass_hash       text not null,
  level           int  not null default 0,        -- number of levels solved
  started_at      timestamptz,
  last_solve_at   timestamptz,
  finished_at     timestamptz,
  hints_used      int  not null default 0,
  level_hints     int  not null default 0,        -- hints opened on the current level
  attempts        int  not null default 0,
  wrong_attempts  int  not null default 0,
  last_attempt_at timestamptz,
  solve_times     jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now()
);

create table if not exists public.settings (
  id           int primary key default 1 check (id = 1),
  hunt_open    boolean not null default true,
  announcement text not null default ''
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

-- Lock the tables: the public "anon" key can read/write nothing.
-- Only the server (service_role key) can touch them.
alter table public.players  enable row level security;
alter table public.settings enable row level security;
