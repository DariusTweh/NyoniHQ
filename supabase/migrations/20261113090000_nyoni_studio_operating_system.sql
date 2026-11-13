alter table public.nyoni_assignments
  add column if not exists workflow_kind text not null default 'general',
  add column if not exists approval_tier text not null default 'A',
  add column if not exists workflow_run_id text,
  add column if not exists source_url text,
  add column if not exists total_cost_usd numeric(12,6) not null default 0,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.nyoni_assignments drop constraint if exists nyoni_assignments_approval_tier_check;
alter table public.nyoni_assignments add constraint nyoni_assignments_approval_tier_check check (approval_tier in ('A','B','C','D'));

create table if not exists public.nyoni_project_floors (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade, slug text not null,
  display_name text not null, floor_order integer not null, template_slug text not null,
  agent_ids text[] not null default '{}', settings jsonb not null default '{}', created_at timestamptz not null default now(),
  unique(owner_id, slug), unique(project_id)
);
create table if not exists public.nyoni_project_context (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade, context_type text not null,
  title text not null, content text not null, source_url text, metadata jsonb not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.nyoni_agents (
  id text primary key, name text not null, role text not null, mission text not null,
  default_approval_tier text not null default 'A' check(default_approval_tier in ('A','B','C','D')),
  enabled boolean not null default true, metadata jsonb not null default '{}', updated_at timestamptz not null default now()
);
create table if not exists public.nyoni_agent_capabilities (
  agent_id text not null references public.nyoni_agents(id) on delete cascade, capability text not null,
  tool_name text, approval_tier text not null default 'A' check(approval_tier in ('A','B','C','D')),
  primary key(agent_id, capability)
);
create table if not exists public.nyoni_workflow_steps (
  id uuid primary key default gen_random_uuid(), assignment_id uuid not null references public.nyoni_assignments(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade, step_key text not null, agent_id text references public.nyoni_agents(id),
  position integer not null, title text not null, status text not null default 'queued' check(status in ('queued','running','waiting_approval','done','failed','cancelled','skipped')),
  attempt integer not null default 0, max_attempts integer not null default 3, input jsonb not null default '{}', output jsonb,
  error text, started_at timestamptz, completed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(assignment_id, step_key)
);
create table if not exists public.nyoni_tool_runs (
  id uuid primary key default gen_random_uuid(), assignment_id uuid not null references public.nyoni_assignments(id) on delete cascade,
  step_id uuid references public.nyoni_workflow_steps(id) on delete set null, owner_id uuid not null references auth.users(id) on delete cascade,
  tool_name text not null, provider text, status text not null default 'running', idempotency_key text,
  input jsonb not null default '{}', output jsonb, error text, cost_usd numeric(12,6) not null default 0,
  started_at timestamptz not null default now(), completed_at timestamptz, unique(owner_id, idempotency_key)
);
create table if not exists public.nyoni_handoffs (
  id uuid primary key default gen_random_uuid(), assignment_id uuid not null references public.nyoni_assignments(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade, from_agent_id text references public.nyoni_agents(id),
  to_agent_id text not null references public.nyoni_agents(id), status text not null default 'pending',
  context jsonb not null default '{}', created_at timestamptz not null default now(), accepted_at timestamptz
);
create table if not exists public.nyoni_artifacts (
  id uuid primary key default gen_random_uuid(), assignment_id uuid not null references public.nyoni_assignments(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade, owner_id uuid not null references auth.users(id) on delete cascade,
  artifact_type text not null, title text not null, status text not null default 'draft', current_version integer not null default 1,
  asset_id uuid references public.assets(id) on delete set null, metadata jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.nyoni_artifact_versions (
  id uuid primary key default gen_random_uuid(), artifact_id uuid not null references public.nyoni_artifacts(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade, version integer not null, content jsonb not null default '{}',
  storage_path text, public_url text, created_by_agent_id text references public.nyoni_agents(id), created_at timestamptz not null default now(),
  unique(artifact_id, version)
);
create table if not exists public.nyoni_ideas (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null, title text not null, body text not null default '',
  tags text[] not null default '{}', status text not null default 'saved', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.nyoni_connected_integrations (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null, capability text not null, status text not null default 'required',
  config jsonb not null default '{}', last_checked_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(owner_id, provider, capability)
);
create table if not exists public.nyoni_budget_policies (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade, paid_actions_enabled boolean not null default false,
  per_run_usd numeric(12,2) not null default 0, per_day_usd numeric(12,2) not null default 0, per_month_usd numeric(12,2) not null default 0,
  allowed_providers text[] not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(owner_id, project_id)
);
create table if not exists public.nyoni_usage_ledger (
  id bigint generated always as identity primary key, owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null, assignment_id uuid references public.nyoni_assignments(id) on delete set null,
  tool_run_id uuid references public.nyoni_tool_runs(id) on delete set null, provider text not null, model text,
  units jsonb not null default '{}', cost_usd numeric(12,6) not null default 0, created_at timestamptz not null default now()
);

insert into public.nyoni_agents(id,name,role,mission,default_approval_tier) values
 ('migo','MIGO','Studio Director','Plan, delegate, monitor, recover, and report across the studio.','A'),
 ('scout','Scout','Research & Discovery','Retrieve evidence and produce source-linked discovery briefs.','A'),
 ('creative','Creative','Art Director','Develop concepts, art direction, prompts, and production-ready creative.','A'),
 ('hunter','Hunter','Client Acquisition','Draft ethical prospecting and outreach for explicit approval.','D'),
 ('pulse','Pulse','Analytics & QA','Validate outputs, measure quality, and record performance.','A'),
 ('story','Story','Screenwriting','Develop narrative structure, scenes, dialogue, and continuity.','A'),
 ('motion','Motion','Production Designer','Create shot, staging, camera, lighting, and motion plans.','A'),
 ('vault','Vault','Ideas & Experiments','Capture ideas, compare experiments, and preserve learnings.','A')
on conflict(id) do update set name=excluded.name, role=excluded.role, mission=excluded.mission, default_approval_tier=excluded.default_approval_tier, updated_at=now();

insert into public.nyoni_agent_capabilities(agent_id,capability,tool_name,approval_tier) values
 ('migo','planning','codex','A'),('migo','delegation','nyoni_queue','A'),('scout','retrieval','web_search','A'),
 ('creative','image_generation','openai_images','B'),('hunter','outreach_draft','codex','A'),('hunter','external_send','email','D'),
 ('pulse','visual_qa','openai_vision','A'),('story','writing','codex','A'),('motion','motion_design','codex','A'),('vault','ideation','codex','A')
on conflict(agent_id,capability) do update set tool_name=excluded.tool_name, approval_tier=excluded.approval_tier;

do $$
declare studio_owner uuid;
begin
  select id into studio_owner from auth.users order by created_at asc limit 1;
  if studio_owner is not null then
    insert into public.projects(user_id,name,type,description,status)
    select studio_owner, v.name, 'nyoni_hq', v.description, 'active'
    from (values
      ('Nyoni Commercials','Commercial campaigns and branded content.'),('Colony Zero','Original science-fiction world and production.'),
      ('Palava 231','Entertainment development and production.'),('SANKOFI','Culture-led stories and creative production.'),
      ('Research & Ideas Lab','Studio research, reference, and experimentation.'),('Mission Control','Cross-project studio operations and reporting.')
    ) as v(name,description)
    where not exists (select 1 from public.projects p where p.user_id=studio_owner and p.name=v.name);

    insert into public.nyoni_project_floors(owner_id,project_id,slug,display_name,floor_order,template_slug,agent_ids)
    select studio_owner,p.id,x.slug,p.name,x.ord,x.template,x.agents
    from (values
      ('Nyoni Commercials','nyoni-commercials',1,'commercials',array['scout','creative','hunter','pulse']),
      ('Colony Zero','colony-zero',2,'entertainment',array['story','motion','creative']),
      ('Palava 231','palava-231',3,'entertainment',array['story','motion','creative']),
      ('SANKOFI','sankofi',4,'research',array['vault','scout','story']),
      ('Research & Ideas Lab','research-ideas-lab',5,'research',array['vault','scout']),
      ('Mission Control','mission-control',6,'mission-control',array['migo','pulse'])
    ) as x(project_name,slug,ord,template,agents)
    join public.projects p on p.user_id=studio_owner and p.name=x.project_name
    on conflict(owner_id,slug) do update set project_id=excluded.project_id, display_name=excluded.display_name,
      floor_order=excluded.floor_order, template_slug=excluded.template_slug, agent_ids=excluded.agent_ids;

    insert into public.nyoni_budget_policies(owner_id,project_id,paid_actions_enabled,allowed_providers)
    select studio_owner,p.id,false,array['openai'] from public.projects p
    where p.user_id=studio_owner and p.type='nyoni_hq'
    on conflict(owner_id,project_id) do nothing;
  end if;
end $$;

do $$ declare t text; begin
  foreach t in array array['nyoni_project_floors','nyoni_project_context','nyoni_workflow_steps','nyoni_tool_runs','nyoni_handoffs','nyoni_artifacts','nyoni_artifact_versions','nyoni_ideas','nyoni_connected_integrations','nyoni_budget_policies','nyoni_usage_ledger'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('drop policy if exists %I on public.%I','owner_all_'||t,t);
    execute format('create policy %I on public.%I for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())','owner_all_'||t,t);
  end loop;
end $$;

create index if not exists nyoni_assignments_queue_idx on public.nyoni_assignments(status,available_at,priority desc);
create index if not exists nyoni_workflow_steps_assignment_idx on public.nyoni_workflow_steps(assignment_id,position);
create index if not exists nyoni_artifacts_assignment_idx on public.nyoni_artifacts(assignment_id,created_at);
create index if not exists nyoni_usage_owner_created_idx on public.nyoni_usage_ledger(owner_id,created_at desc);
