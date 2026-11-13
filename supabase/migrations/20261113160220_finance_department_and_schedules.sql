alter table public.nyoni_assignments drop constraint if exists nyoni_assignments_agent_id_check;
alter table public.nyoni_assignments add constraint nyoni_assignments_agent_id_check check (
  agent_id in ('migo','scout','creative','hunter','pulse','story','motion','vault','ledger','margin','treasury','audit')
);

insert into public.nyoni_agents(id,name,role,mission,default_approval_tier) values
 ('ledger','Ledger','Financial Controller','Reconcile revenue, invoices, refunds, subscriptions, and operating costs into a dependable financial record.','A'),
 ('margin','Margin','FP&A Analyst','Forecast revenue, analyze unit economics and project profitability, and recommend bounded budgets.','A'),
 ('treasury','Treasury','Cash Operations','Monitor cash flow, receivables, failed payments, renewals, and prepare financial actions for approval.','D'),
 ('audit','Audit','Risk & Compliance','Detect anomalies, missing records, policy violations, and financial actions that require founder review.','C')
on conflict(id) do update set name=excluded.name,role=excluded.role,mission=excluded.mission,default_approval_tier=excluded.default_approval_tier,updated_at=now();

insert into public.nyoni_agent_capabilities(agent_id,capability,tool_name,approval_tier) values
 ('ledger','reconciliation','stripe_read','A'),('ledger','financial_reporting','codex','A'),
 ('margin','forecasting','codex','A'),('margin','budget_analysis','usage_ledger','A'),
 ('treasury','receivables_monitoring','stripe_read','A'),('treasury','money_movement','stripe_write','D'),
 ('audit','anomaly_detection','stripe_read','A'),('audit','financial_control_review','approval_queue','C')
on conflict(agent_id,capability) do update set tool_name=excluded.tool_name,approval_tier=excluded.approval_tier;

create table if not exists public.nyoni_finance_snapshots (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
 snapshot_date date not null, currency text not null default 'usd', revenue_gross numeric(14,2) not null default 0,
 cash_collected numeric(14,2) not null default 0, outstanding_receivables numeric(14,2) not null default 0,
 refunds numeric(14,2) not null default 0, disputes numeric(14,2) not null default 0,
 operating_costs numeric(14,2) not null default 0, api_costs numeric(14,2) not null default 0,
 gross_margin numeric(8,4), source text not null default 'manual', metadata jsonb not null default '{}',
 created_at timestamptz not null default now(), unique(owner_id,snapshot_date,currency)
);

create table if not exists public.nyoni_finance_actions (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
 assignment_id uuid references public.nyoni_assignments(id) on delete set null, action_type text not null,
 status text not null default 'draft' check(status in ('draft','waiting_approval','approved','executing','completed','rejected','failed','cancelled')),
 amount numeric(14,2), currency text not null default 'usd', customer_ref text, stripe_object_ref text,
 payload jsonb not null default '{}', risk_summary text, requested_by_agent_id text references public.nyoni_agents(id),
 approved_by uuid references auth.users(id), approved_at timestamptz, executed_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.nyoni_schedules (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
 name text not null, agent_id text not null references public.nyoni_agents(id), project_name text not null,
 prompt text not null, cadence_minutes integer not null check(cadence_minutes between 15 and 43200),
 enabled boolean not null default true, next_run_at timestamptz not null default now(), last_run_at timestamptz,
 last_assignment_id uuid references public.nyoni_assignments(id) on delete set null,
 metadata jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(owner_id,name)
);

alter table public.nyoni_finance_snapshots enable row level security;
alter table public.nyoni_finance_actions enable row level security;
alter table public.nyoni_schedules enable row level security;

create policy owner_all_finance_snapshots on public.nyoni_finance_snapshots for all to authenticated
 using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
create policy owner_all_finance_actions on public.nyoni_finance_actions for all to authenticated
 using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
create policy owner_all_schedules on public.nyoni_schedules for all to authenticated
 using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);

do $$ declare studio_owner uuid; finance_project uuid; begin
 select id into studio_owner from auth.users order by created_at limit 1;
 if studio_owner is not null then
   select id into finance_project from public.projects where user_id=studio_owner and name='Finance Department' limit 1;
   if finance_project is null then
     insert into public.projects(user_id,name,type,description,status) values(studio_owner,'Finance Department','nyoni_hq','Revenue intelligence, forecasting, reconciliation, risk, and approved cash operations.','active') returning id into finance_project;
   end if;
   insert into public.nyoni_project_floors(owner_id,project_id,slug,display_name,floor_order,template_slug,agent_ids)
   values(studio_owner,finance_project,'finance-department','Finance Department',7,'mission-control',array['ledger','margin','treasury','audit'])
   on conflict(owner_id,slug) do update set project_id=excluded.project_id,display_name=excluded.display_name,floor_order=excluded.floor_order,template_slug=excluded.template_slug,agent_ids=excluded.agent_ids;

   insert into public.nyoni_budget_policies(owner_id,project_id,paid_actions_enabled,per_run_usd,per_day_usd,per_month_usd,allowed_providers)
   values(studio_owner,finance_project,false,0,0,0,array['stripe']) on conflict(owner_id,project_id) do nothing;

   insert into public.nyoni_schedules(owner_id,name,agent_id,project_name,prompt,cadence_minutes,next_run_at) values
   (studio_owner,'Daily trend radar','scout','Research & Ideas Lab','Find current trends, formats, cultural signals, and commercial opportunities relevant to Nyoni Studios. Cite sources, score opportunities, and hand the strongest ideas to Vault and MIGO.',1440,now()),
   (studio_owner,'Daily growth opportunity review','migo','Mission Control','Review current assignments, recent trend findings, content opportunities, sales pipeline work, blockers, and budgets. Prioritize the highest-value next work and delegate concrete assignments.',1440,now()+interval '30 minutes'),
   (studio_owner,'Weekly story and skit lab','story','SANKOFI','Develop original, producible skit and story concepts from current project context and recent research. Preserve canon, identify required assets, and hand production-ready concepts to Creative and Motion.',10080,now()+interval '1 hour'),
   (studio_owner,'Daily finance close','ledger','Finance Department','Reconcile available revenue, invoice, subscription, refund, dispute, and API-cost information. Clearly identify missing integrations or records and produce a finance close report without moving money.',1440,now()+interval '2 hours'),
   (studio_owner,'Weekly margin review','margin','Finance Department','Analyze revenue, operating costs, API spend, project margins, pipeline value, and forecast. Recommend bounded budget changes and the highest-leverage revenue actions.',10080,now()+interval '3 hours')
   on conflict(owner_id,name) do update set prompt=excluded.prompt,cadence_minutes=excluded.cadence_minutes,enabled=true,updated_at=now();
 end if;
end $$;

create index if not exists nyoni_schedules_due_idx on public.nyoni_schedules(enabled,next_run_at);
create index if not exists nyoni_finance_actions_status_idx on public.nyoni_finance_actions(owner_id,status,created_at desc);
