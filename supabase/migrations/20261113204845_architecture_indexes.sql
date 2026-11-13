create index if not exists nyoni_agent_capabilities_routes_to_idx
  on public.nyoni_agent_capabilities(routes_to_agent_id)
  where routes_to_agent_id is not null;

create index if not exists nyoni_handoffs_owner_idx on public.nyoni_handoffs(owner_id);
create index if not exists nyoni_handoffs_from_agent_idx on public.nyoni_handoffs(from_agent_id) where from_agent_id is not null;
create index if not exists nyoni_handoffs_to_agent_idx on public.nyoni_handoffs(to_agent_id);

drop policy if exists owner_all_nyoni_handoffs on public.nyoni_handoffs;
create policy owner_all_nyoni_handoffs on public.nyoni_handoffs
for all to authenticated
using (owner_id=(select auth.uid()))
with check (owner_id=(select auth.uid()));
