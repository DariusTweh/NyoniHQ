# Nyoni HQ Production Core — source-of-truth map

This map records the read-only integration boundary established before Production Core implementation. Nyoni HQ does not copy or overwrite Movie Studio canon.

| Resource | Authoritative source | HQ integration rule |
| --- | --- | --- |
| HQ projects, ownership, budgets | Supabase `projects`, `nyoni_project_context`, `nyoni_budget_policies` | Resolve by UUID and `owner_id`. Never choose a project by fuzzy title inside a production workflow. |
| Series bibles, episodes, scenes, canon | Supabase `studio_documents` rows with `kind = 'series'` | Resolve by an explicit `series_document_id` mapping. `colony-zero` and `nyoni-detective-pepper-soup-cassava-leaf` are separate series. Palava 231 is intentionally unmapped until the founder explicitly maps it. |
| Movie Studio production packages | Supabase `studio_documents` rows with `kind = 'production'` | Read by stable production document ID. Existing examples include `colony-zero-colony-zero-s1e1`; HQ never rewrites the document. |
| Series characters and their primary images | The selected series document's `characters` array | Resolve exact character IDs and preserve the document revision in packet provenance. A missing image is a blocker, not permission to invent a replacement. |
| Global/user actor library | NYONISTUDIO `lib/projects/actor-library.ts`, which merges `/api/production/library?kind=actor`, `seededSeriesActors`, `seededStudioActors`, `lib/mock-data`, and its browser cache | Only use an actor when the project has an explicit global-character link. HQ treats the Movie Studio library endpoint/source as canonical and does not create a competing actor table. Klozu, Selah and Malik are currently present in the Movie Studio seed/mock source, not the empty normalized `characters` table. |
| Reference selection and ordering | NYONISTUDIO `lib/production/resolve-scene-references.ts` and `prepare-scene-generation.ts` | Production packets use the same role/priority concepts: character master, supporting/look, location, plate, camera, geography, prop, previous frame, and scene reference. Critical references may never be silently dropped. |
| Durable media assets | Supabase `assets` plus Movie Studio production-document asset manifests | Resolve by asset UUID and enforce both `user_id` and `project_id`. Storage URLs are derived server-side; private/signed URLs are never persisted into logs or packet provenance. |
| Character/scene/job continuity | Existing `character_versions`, `character_voice_bindings`, `voice_profiles`, `scenes`, `shot_packets`, and `generation_jobs` tables where populated; otherwise the selected series/production document | Preserve stable IDs, revisions, `continuity_group_id`, reference snapshots, and actual end-frame IDs. Empty normalized tables are not treated as proof that canon is absent. |
| Media provider models | NYONISTUDIO `lib/wavespeed/models.ts` and provider adapters; HQ `server/studio-tools.js` | HQ adapters validate model capabilities and settings. A first-frame model is not allowed to masquerade as multi-reference generation. |
| HQ orchestration and audit trail | `workflows/nyoni-assignment.js`, `nyoni_workflow_steps`, `nyoni_handoffs`, `nyoni_tool_runs`, `nyoni_assignment_events` | MIGO owns the durable workflow; every downstream job has persisted input, state, output, and error data. |
| Founder review | HQ assignments/artifacts plus persisted assets, QA and spend records | “Ready for founder review” requires the packet's required deliverables. A written plan is not a finished video. Approval queues a package; it does not publish it. |

## Verified repository findings

- NYONISTUDIO is available locally at `/Users/dariustweh/Documents/Code/nyoni-ai-studio` and shares Supabase project `ggocwfdhqpstuvhybtap` with HQ.
- The live database has two distinct `series` documents: Colony Zero (12 characters, one episode at audit time) and the detective production (nine characters, six episodes).
- The normalized `characters` and `scenes` tables were empty at audit time; canonical series data is currently stored primarily in versioned `studio_documents` JSON.
- `generation_jobs` already supports dependency IDs, reference snapshots/manifests, continuity groups, attempts, provider IDs, and end-frame assets. Production Core extends this system instead of replacing it.
- Movie Studio's actor library also contains source-controlled seeded characters. HQ must use an explicit link and a read-only adapter; it must not scrape or duplicate that library.

