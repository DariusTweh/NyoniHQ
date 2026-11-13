alter table public.nyoni_agent_capabilities
  add column if not exists is_default boolean not null default true,
  add column if not exists exception_only boolean not null default false,
  add column if not exists routes_to_agent_id text references public.nyoni_agents(id) on delete set null;

alter table public.nyoni_handoffs
  add column if not exists handoff_key text not null default 'default',
  add column if not exists completed_at timestamptz;

create unique index if not exists nyoni_handoffs_assignment_key_idx
  on public.nyoni_handoffs(assignment_id,handoff_key);
create unique index if not exists nyoni_project_context_identity_idx
  on public.nyoni_project_context(owner_id,project_id,context_type,title);
create index if not exists nyoni_project_context_project_idx
  on public.nyoni_project_context(owner_id,project_id,updated_at desc);
create index if not exists nyoni_handoffs_assignment_idx
  on public.nyoni_handoffs(assignment_id,created_at);

with contracts(id,mission,department,specialty) as (values
  ('migo','Break requests into assignments, delegate, monitor progress, recover failures, and report studio status.','mission-control','orchestration'),
  ('scout','Find and verify references, trends, competitors, sources, and opportunities without presenting assumptions as facts.','intelligence','research'),
  ('vault','Capture, expand, rank, and archive ideas while preserving their project origin and experiment history.','intelligence','idea-development'),
  ('story','Own scripts, dialogue, narrative structure, character logic, and story continuity within the active project.','creative','writing'),
  ('creative','Define visual direction, campaign concepts, and creative standards; route default image production to Lumina or Reframe.','creative','art-direction'),
  ('motion','Design shots, camera, blocking, staging, timing, and production prompts; route generation to Nova or Kinetic.','creative','shot-design'),
  ('pulse','Check deliverables against requirements, run quality control, record issues, and analyze performance.','quality','quality-control'),
  ('lumina','Generate original images from approved text direction and return durable production assets.','photo','text-to-image'),
  ('reframe','Edit supplied images while preserving requested identity, product, composition, and continuity constraints.','photo','image-to-image'),
  ('nova','Generate video from text-based shot direction with controlled camera, action, staging, and timing.','video','text-to-video'),
  ('kinetic','Animate supplied images into video while preserving identity, framing, materials, and scene continuity.','video','image-to-video'),
  ('cutline','Perform supported video edits, revisions, extensions, reframing, and postproduction transformations.','video','video-editing'),
  ('sonora','Create original music, scores, and song productions matched to the active project and scene.','audio','music-production'),
  ('vox','Generate and direct dialogue and narration with consistent voice, delivery, pacing, and pronunciation.','audio','voice-production'),
  ('rally','Produce complete campaigns by coordinating research, direction, specialist assets, QA, and final packaging.','campaign','campaign-production'),
  ('hunter','Find prospects, verify businesses, and draft personalized outreach; external sending always remains approval-gated.','business','client-acquisition'),
  ('ledger','Track revenue, expenses, invoices, subscriptions, API spend, and reconciliations from available records.','finance','financial-control'),
  ('margin','Calculate production profitability, unit economics, forecasts, and bounded budget recommendations.','finance','planning-analysis'),
  ('treasury','Monitor receivables, cash flow, renewals, and failed payments; prepare but never execute money movement.','finance','cash-operations'),
  ('audit','Review discrepancies, risky actions, policy violations, missing records, and financial controls.','finance','risk-compliance')
)
update public.nyoni_agents a set
  mission=c.mission,
  metadata=a.metadata || jsonb_build_object(
    'department',c.department,
    'primary_specialty',c.specialty,
    'contract_version',1,
    'one_identity',true,
    'project_memory_required',true
  ),
  updated_at=now()
from contracts c where a.id=c.id;

update public.nyoni_agent_capabilities
set is_default=false, exception_only=true, routes_to_agent_id='lumina'
where agent_id in ('creative','rally') and capability in ('image_generation','text_to_image');

update public.nyoni_agent_capabilities
set routes_to_agent_id=case
  when agent_id='creative' and capability like '%image%' then 'lumina'
  when agent_id='motion' and capability like '%video%' then 'nova'
  else routes_to_agent_id end;

update public.nyoni_project_floors f set settings=f.settings || x.settings
from (values
  ('nyoni-commercials',jsonb_build_object('lead_agent_id','rally','ownership','client campaigns, commercial deliverables, and marketing packages','workplace_type','production')),
  ('colony-zero',jsonb_build_object('lead_agent_id','story','ownership','episode pipeline, scripts, storyboards, and continuity','workplace_type','production')),
  ('palava-231',jsonb_build_object('lead_agent_id','story','ownership','comedy scripts, episode segments, and character consistency','workplace_type','production')),
  ('sankofi',jsonb_build_object('lead_agent_id','vault','ownership','character concepts, visual development, and world-design references','workplace_type','production')),
  ('photo-department',jsonb_build_object('lead_agent_id','lumina','workplace_type','shared-service')),
  ('video-department',jsonb_build_object('lead_agent_id','nova','workplace_type','shared-service')),
  ('audio-department',jsonb_build_object('lead_agent_id','sonora','workplace_type','shared-service')),
  ('campaign-studio',jsonb_build_object('lead_agent_id','rally','workplace_type','shared-service'))
) as x(slug,settings)
where f.slug=x.slug;

do $$
declare studio_owner uuid;
begin
  select id into studio_owner from auth.users order by created_at asc limit 1;
  if studio_owner is null then return; end if;

  insert into public.nyoni_project_context(owner_id,project_id,context_type,title,content,metadata)
  select studio_owner,p.id,'project_bible','Operating charter',x.content,
    jsonb_build_object('status','foundation','canon_level','operational','requires_founder_sources',true,'memory_version',1)
  from (values
    ('Nyoni Commercials','Lead: Rally. Owns client campaigns, commercial deliverables, and marketing packages. MIGO orchestrates; Scout verifies evidence; Creative defines direction; Lumina/Reframe produce stills; Nova/Kinetic/Cutline produce video; Sonora/Vox produce audio; Pulse performs QA. Never claim outreach or publication occurred without an approved external action.'),
    ('Colony Zero','Lead: Story. Owns the episode pipeline, scripts, storyboards, and continuity. Treat this project as an isolated fictional universe. Load only Colony Zero scripts, character references, locked decisions, and continuity records. Missing canon must be marked as unknown rather than invented.'),
    ('Palava 231','Lead: Story. Owns comedy scripts, episode segments, character consistency, and continuity. Treat this project as isolated from Colony Zero and SANKOFI. Preserve established character voice only when supported by saved project sources.'),
    ('SANKOFI','Lead: Vault until reassigned. Owns character concepts, visual development, cultural research, and world-design references. Clearly separate verified cultural sources, approved canon, experiments, and open questions. Do not import characters or rules from other productions.')
  ) as x(project_name,content)
  join public.projects p on p.user_id=studio_owner and p.name=x.project_name
  on conflict(owner_id,project_id,context_type,title) do update set
    content=excluded.content,metadata=excluded.metadata,updated_at=now();

  update public.nyoni_budget_policies b set
    paid_actions_enabled=true,
    per_run_usd=greatest(b.per_run_usd,0.50),
    per_day_usd=greatest(b.per_day_usd,5.00),
    per_month_usd=greatest(b.per_month_usd,50.00),
    allowed_providers=(select array_agg(distinct provider) from unnest(b.allowed_providers || array['openai','kie']) provider),
    updated_at=now()
  from public.projects p
  where b.project_id=p.id and b.owner_id=studio_owner and p.name='Nyoni Commercials';
end $$;

drop policy if exists owner_all_nyoni_project_context on public.nyoni_project_context;
create policy owner_all_nyoni_project_context on public.nyoni_project_context
for all to authenticated
using (owner_id=(select auth.uid()))
with check (owner_id=(select auth.uid()));

drop policy if exists owner_all_nyoni_handoffs on public.nyoni_handoffs;
create policy owner_all_nyoni_handoffs on public.nyoni_handoffs
for all to authenticated
using (owner_id=(select auth.uid()))
with check (owner_id=(select auth.uid()));
