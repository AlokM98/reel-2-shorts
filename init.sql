create extension if not exists pgcrypto;

create table if not exists users (
id uuid primary key default gen_random_uuid(),
telegram_chat_id text unique not null,
created_at timestamptz default now()
);

create table if not exists connections (
id uuid primary key default gen_random_uuid(),
user_id uuid not null references users(id) on delete cascade,
provider text not null check (provider in ('instagram','youtube')),
provider_user_id text,
access_token_enc text not null,
refresh_token_enc text,
expires_at timestamptz,
created_at timestamptz default now(),
updated_at timestamptz default now(),
unique(user_id, provider)
);

create table if not exists sync_jobs (
id uuid primary key default gen_random_uuid(),
user_id uuid not null references users(id) on delete cascade,
ig_media_id text not null,
yt_video_id text,
status text not null check (status in ('pending','uploaded','failed')),
error text,
created_at timestamptz default now(),
updated_at timestamptz default now(),
unique(user_id, ig_media_id)
);

alter table users
add column if not exists sync_enabled boolean not null default true;