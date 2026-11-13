insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('nyoni-artifacts','nyoni-artifacts',true,15728640,array['image/png','image/webp','application/zip'])
on conflict(id) do update set public=true, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;

update public.nyoni_budget_policies
set paid_actions_enabled=true, per_run_usd=1.00, per_day_usd=5.00, per_month_usd=30.00,
    allowed_providers=array['openai'], updated_at=now()
where per_run_usd=0 and per_day_usd=0 and per_month_usd=0;
