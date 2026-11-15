-- Production Core is additive. Movie Studio canon remains in studio_documents/assets.
create table if not exists public.nyoni_production_packets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  workspace_id text not null default 'nyoni-studios',
  project_id uuid not null references public.projects(id) on delete cascade,
  assignment_id uuid not null references public.nyoni_assignments(id) on delete cascade,
  series_document_id text,
  production_document_id text,
  episode_id text, scene_id text, shot_id text,
  schema_version integer not null,
  packet_version integer not null default 1,
  status text not null default 'draft' check (status in ('draft','ready','blocked','superseded')),
  packet jsonb not null,
  blockers jsonb not null default '[]',
  source_versions jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(assignment_id, packet_version)
);

create table if not exists public.nyoni_production_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  assignment_id uuid not null references public.nyoni_assignments(id) on delete cascade,
  packet_id uuid not null references public.nyoni_production_packets(id) on delete cascade,
  step_id uuid references public.nyoni_workflow_steps(id) on delete set null,
  agent_id text not null references public.nyoni_agents(id),
  job_kind text not null,
  state text not null default 'queued' check (state in ('queued','running','waiting_generation','generating','blocked','needs_repair','ready_finishing','completed','failed','cancelled')),
  dependency_ids uuid[] not null default '{}',
  idempotency_key text not null,
  input jsonb not null default '{}', output jsonb,
  provider text, provider_job_id text,
  attempt integer not null default 0, max_attempts integer not null default 2,
  error jsonb, estimated_cost_usd numeric(12,6) not null default 0,
  actual_cost_usd numeric(12,6),
  started_at timestamptz, completed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(owner_id,idempotency_key)
);

create table if not exists public.nyoni_quality_reviews (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  assignment_id uuid not null references public.nyoni_assignments(id) on delete cascade,
  packet_id uuid not null references public.nyoni_production_packets(id) on delete cascade,
  asset_id uuid references public.assets(id) on delete set null,
  stage text not null check (stage in ('preliminary','final_technical')),
  disposition text not null check (disposition in ('PASS','FIX','ESCALATE')),
  observations jsonb not null default '[]',
  measurements jsonb not null default '{}',
  reviewer_agent_id text not null default 'pulse' references public.nyoni_agents(id),
  created_at timestamptz not null default now()
);

create table if not exists public.nyoni_budget_reservations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  assignment_id uuid not null references public.nyoni_assignments(id) on delete cascade,
  production_job_id uuid references public.nyoni_production_jobs(id) on delete cascade,
  provider text not null, model text not null,
  amount_usd numeric(12,6) not null check (amount_usd >= 0),
  state text not null default 'reserved' check (state in ('reserved','captured','released','expired')),
  idempotency_key text not null,
  actual_cost_usd numeric(12,6),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(owner_id,idempotency_key)
);

alter table public.nyoni_assignments add column if not exists production_state text;
alter table public.nyoni_assignments drop constraint if exists nyoni_assignments_production_state_check;
alter table public.nyoni_assignments add constraint nyoni_assignments_production_state_check check (
  production_state is null or production_state in (
    'creative_planning','waiting_generation','media_generating','media_blocked','needs_qa_repair',
    'ready_finishing','ready_founder_review','approved_release_slate','changes_requested','rejected','failed'
  )
);

create index if not exists nyoni_production_packets_assignment_idx on public.nyoni_production_packets(assignment_id,packet_version desc);
create index if not exists nyoni_production_jobs_assignment_idx on public.nyoni_production_jobs(assignment_id,created_at);
create index if not exists nyoni_production_jobs_dependencies_idx on public.nyoni_production_jobs using gin(dependency_ids);
create index if not exists nyoni_quality_reviews_packet_idx on public.nyoni_quality_reviews(packet_id,created_at);
create index if not exists nyoni_budget_reservations_active_idx on public.nyoni_budget_reservations(owner_id,project_id,state,expires_at);

create or replace function public.nyoni_reserve_generation_budget(
  p_owner_id uuid, p_project_id uuid, p_assignment_id uuid, p_production_job_id uuid,
  p_provider text, p_model text, p_amount_usd numeric, p_idempotency_key text
) returns public.nyoni_budget_reservations
language plpgsql security definer set search_path=public as $$
declare
  v_policy public.nyoni_budget_policies%rowtype;
  v_existing public.nyoni_budget_reservations%rowtype;
  v_day_start timestamptz := date_trunc('day',now() at time zone 'utc') at time zone 'utc';
  v_month_start timestamptz := date_trunc('month',now() at time zone 'utc') at time zone 'utc';
  v_day_spend numeric := 0; v_month_spend numeric := 0;
  v_day_reserved numeric := 0; v_month_reserved numeric := 0;
begin
  if p_amount_usd < 0 then raise exception 'Budget reservation cannot be negative.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text || ':' || p_project_id::text,0));

  select * into v_existing from public.nyoni_budget_reservations
  where owner_id=p_owner_id and idempotency_key=p_idempotency_key;
  if found then return v_existing; end if;

  select * into v_policy from public.nyoni_budget_policies
  where owner_id=p_owner_id and project_id=p_project_id for update;
  if not found or not v_policy.paid_actions_enabled then raise exception 'Paid media generation is disabled for this project.'; end if;
  if cardinality(v_policy.allowed_providers)>0 and not (p_provider=any(v_policy.allowed_providers)) then raise exception 'Provider % is not allowed for this project.',p_provider; end if;
  if p_amount_usd>v_policy.per_run_usd then raise exception 'Generation estimate exceeds the per-run limit.'; end if;

  update public.nyoni_budget_reservations set state='expired',updated_at=now()
  where owner_id=p_owner_id and project_id=p_project_id and state='reserved' and expires_at<=now();
  select coalesce(sum(cost_usd),0) into v_day_spend from public.nyoni_usage_ledger where owner_id=p_owner_id and project_id=p_project_id and created_at>=v_day_start;
  select coalesce(sum(cost_usd),0) into v_month_spend from public.nyoni_usage_ledger where owner_id=p_owner_id and project_id=p_project_id and created_at>=v_month_start;
  select coalesce(sum(amount_usd),0) into v_day_reserved from public.nyoni_budget_reservations where owner_id=p_owner_id and project_id=p_project_id and state='reserved' and created_at>=v_day_start;
  select coalesce(sum(amount_usd),0) into v_month_reserved from public.nyoni_budget_reservations where owner_id=p_owner_id and project_id=p_project_id and state='reserved' and created_at>=v_month_start;
  if v_day_spend+v_day_reserved+p_amount_usd>v_policy.per_day_usd then raise exception 'Generation would exceed the project daily budget.'; end if;
  if v_month_spend+v_month_reserved+p_amount_usd>v_policy.per_month_usd then raise exception 'Generation would exceed the project monthly budget.'; end if;

  insert into public.nyoni_budget_reservations(owner_id,project_id,assignment_id,production_job_id,provider,model,amount_usd,idempotency_key)
  values(p_owner_id,p_project_id,p_assignment_id,p_production_job_id,p_provider,p_model,p_amount_usd,p_idempotency_key)
  returning * into v_existing;
  return v_existing;
end $$;

revoke all on function public.nyoni_reserve_generation_budget(uuid,uuid,uuid,uuid,text,text,numeric,text) from public;
grant execute on function public.nyoni_reserve_generation_budget(uuid,uuid,uuid,uuid,text,text,numeric,text) to service_role;

alter table public.nyoni_production_packets enable row level security;
alter table public.nyoni_production_jobs enable row level security;
alter table public.nyoni_quality_reviews enable row level security;
alter table public.nyoni_budget_reservations enable row level security;

do $$ declare t text; begin
  foreach t in array array['nyoni_production_packets','nyoni_production_jobs','nyoni_quality_reviews','nyoni_budget_reservations'] loop
    execute format('drop policy if exists %I on public.%I','owner_all_'||t,t);
    execute format('create policy %I on public.%I for all to authenticated using (owner_id=(select auth.uid())) with check (owner_id=(select auth.uid()))','owner_all_'||t,t);
  end loop;
end $$;

-- Colony Zero is a verified mapping. The detective series is deliberately not mapped to Palava 231.
insert into public.nyoni_project_context(owner_id,project_id,context_type,title,content,metadata)
select p.user_id,p.id,'series_mapping','Movie Studio series mapping','Explicit read-only mapping to the canonical Movie Studio series document.',
       jsonb_build_object('series_document_id','colony-zero','mapping_version',1,'read_only',true)
from public.projects p where p.name='Colony Zero'
on conflict(owner_id,project_id,context_type,title) do update set metadata=excluded.metadata,content=excluded.content,updated_at=now();

insert into public.nyoni_agent_capabilities(agent_id,capability,tool_name,approval_tier,is_default,exception_only)
values('cutline','prism_finishing','wavespeed_video_upscaler','B',false,false)
on conflict(agent_id,capability) do update set tool_name=excluded.tool_name,approval_tier=excluded.approval_tier,is_default=excluded.is_default,exception_only=excluded.exception_only;

