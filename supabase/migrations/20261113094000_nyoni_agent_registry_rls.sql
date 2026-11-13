alter table public.nyoni_agents enable row level security;
alter table public.nyoni_agent_capabilities enable row level security;

drop policy if exists authenticated_read_nyoni_agents on public.nyoni_agents;
create policy authenticated_read_nyoni_agents on public.nyoni_agents for select to authenticated using (true);

drop policy if exists authenticated_read_nyoni_agent_capabilities on public.nyoni_agent_capabilities;
create policy authenticated_read_nyoni_agent_capabilities on public.nyoni_agent_capabilities for select to authenticated using (true);
