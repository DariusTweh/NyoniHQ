alter table public.nyoni_assignments drop constraint if exists nyoni_assignments_agent_id_check;
alter table public.nyoni_assignments add constraint nyoni_assignments_agent_id_check check (
  agent_id in (
    'migo','scout','creative','hunter','pulse','story','motion','vault',
    'ledger','margin','treasury','audit',
    'lumina','reframe','nova','kinetic','cutline','sonora','vox','rally'
  )
);

insert into public.nyoni_agents(id,name,role,mission,default_approval_tier) values
 ('lumina','Lumina','Text-to-Image Artist','Turn approved creative direction into production-ready still images with intentional composition, lighting, and format.','B'),
 ('reframe','Reframe','Image-to-Image Artist','Transform supplied images while preserving the requested identity, product, composition, and continuity constraints.','B'),
 ('nova','Nova','Text-to-Video Director','Turn written creative direction into short cinematic video generations with clear motion, camera, staging, and timing.','B'),
 ('kinetic','Kinetic','Image-to-Video Animator','Animate approved stills into controlled video while preserving identity, framing, materials, and scene continuity.','B'),
 ('cutline','Cutline','AI Video Editor','Edit and extend supplied video with precise change instructions while protecting the source performance and camera intent.','B'),
 ('sonora','Sonora','Music Composer','Create original scores, songs, lyrics, and musical variations through the Studio music pipeline.','B'),
 ('vox','Vox','Voice Director','Direct and synthesize dialogue with ElevenLabs, including delivery, voice selection, timing, and performance continuity.','B'),
 ('rally','Rally','Campaign Producer','Turn products, references, actors, and commercial strategy into coherent multi-asset campaign packages.','B')
on conflict(id) do update set name=excluded.name,role=excluded.role,mission=excluded.mission,default_approval_tier=excluded.default_approval_tier,updated_at=now();

insert into public.nyoni_agent_capabilities(agent_id,capability,tool_name,approval_tier) values
 ('lumina','text_to_image','kie_image', 'B'),
 ('reframe','image_to_image','kie_image', 'B'),
 ('nova','text_to_video','kie_seedance', 'B'),
 ('kinetic','image_to_video','kie_seedance', 'B'),
 ('cutline','video_edit','kie_seedance', 'B'),
 ('sonora','music_generation','kie_suno', 'B'),
 ('sonora','lyrics_generation','kie_suno', 'A'),
 ('vox','voice_synthesis','elevenlabs_v4', 'B'),
 ('rally','campaign_planning','codex', 'A'),
 ('rally','campaign_image_generation','kie_nano_banana_2', 'B')
on conflict(agent_id,capability) do update set tool_name=excluded.tool_name,approval_tier=excluded.approval_tier;

do $$
declare studio_owner uuid;
declare photo_project uuid;
declare video_project uuid;
declare audio_project uuid;
declare campaign_project uuid;
begin
  select id into studio_owner from auth.users order by created_at asc limit 1;
  if studio_owner is null then return; end if;

  insert into public.projects(user_id,name,type,description,status)
  select studio_owner,v.name,'nyoni_hq',v.description,'active'
  from (values
    ('Photo Department','Text-to-image and image-to-image production using the Nyoni AI Studio media stack.'),
    ('Video Department','Text-to-video, image-to-video, video editing, extension, and delivery.'),
    ('Audio Department','Original music, lyrics, voices, dialogue timing, and performance audio.'),
    ('Campaign Studio','Product-led campaign planning, references, actor continuity, and multi-asset production.')
  ) as v(name,description)
  where not exists (select 1 from public.projects p where p.user_id=studio_owner and p.name=v.name);

  select id into photo_project from public.projects where user_id=studio_owner and name='Photo Department' limit 1;
  select id into video_project from public.projects where user_id=studio_owner and name='Video Department' limit 1;
  select id into audio_project from public.projects where user_id=studio_owner and name='Audio Department' limit 1;
  select id into campaign_project from public.projects where user_id=studio_owner and name='Campaign Studio' limit 1;

  insert into public.nyoni_project_floors(owner_id,project_id,slug,display_name,floor_order,template_slug,agent_ids) values
    (studio_owner,photo_project,'photo-department','Photo Department',8,'research_lab',array['lumina','reframe']),
    (studio_owner,video_project,'video-department','Video Department',9,'entertainment',array['nova','kinetic','cutline']),
    (studio_owner,audio_project,'audio-department','Audio Department',10,'mission_control',array['sonora','vox']),
    (studio_owner,campaign_project,'campaign-studio','Campaign Studio',11,'commercials',array['rally','creative','pulse'])
  on conflict(owner_id,slug) do update set project_id=excluded.project_id,display_name=excluded.display_name,
    floor_order=excluded.floor_order,template_slug=excluded.template_slug,agent_ids=excluded.agent_ids;

  insert into public.nyoni_budget_policies(owner_id,project_id,paid_actions_enabled,per_run_usd,per_day_usd,per_month_usd,allowed_providers) values
    (studio_owner,photo_project,true,0.50,5.00,50.00,array['kie','wavespeed']),
    (studio_owner,video_project,true,1.50,10.00,100.00,array['kie','wavespeed']),
    (studio_owner,audio_project,true,0.75,5.00,50.00,array['kie','elevenlabs']),
    (studio_owner,campaign_project,true,1.00,8.00,80.00,array['kie','openai'])
  on conflict(owner_id,project_id) do update set paid_actions_enabled=excluded.paid_actions_enabled,
    per_run_usd=excluded.per_run_usd,per_day_usd=excluded.per_day_usd,per_month_usd=excluded.per_month_usd,
    allowed_providers=excluded.allowed_providers,updated_at=now();

  insert into public.nyoni_connected_integrations(owner_id,provider,capability,status,config,last_checked_at) values
    (studio_owner,'kie','image_generation','connected','{"models":["gpt-image-2-5-sunburst","nano-banana-2"]}',now()),
    (studio_owner,'kie','video_generation','connected','{"model":"bytedance/seedance-2-5"}',now()),
    (studio_owner,'kie','music_generation','connected','{"model":"ai-music-api/generate"}',now()),
    (studio_owner,'elevenlabs','voice_synthesis','connected','{"model":"eleven_v4"}',now()),
    (studio_owner,'wavespeed','media_generation','connected','{"fallback":true}',now())
  on conflict(owner_id,provider,capability) do update set status=excluded.status,config=excluded.config,last_checked_at=excluded.last_checked_at,updated_at=now();

  insert into public.nyoni_schedules(owner_id,name,agent_id,project_name,prompt,cadence_minutes,next_run_at) values
    (studio_owner,'Weekly campaign concept lab','rally','Campaign Studio','Review recent trend and idea findings, then develop three original campaign directions with channel strategy, asset lists, and production briefs. Do not start paid generation without a specific approved product or source asset.',10080,now()+interval '4 hours'),
    (studio_owner,'Weekly media production review','migo','Mission Control','Review Photo, Video, Audio, and Campaign Studio assignments, provider failures, budget usage, pending assets, and delivery bottlenecks. Delegate internal fixes and escalate only consequential blockers.',10080,now()+interval '5 hours')
  on conflict(owner_id,name) do update set prompt=excluded.prompt,cadence_minutes=excluded.cadence_minutes,enabled=true,updated_at=now();
end $$;
