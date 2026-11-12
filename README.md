# NYONI HQ — Interactive 3D Agent Studio (v0.6)

An interactive Nyoni Studios headquarters with four real-time Blender-built floors, animated GLB agents, Codex profiles for the full eight-agent crew, an optional Muse collaborator pass, local assignment management, a review/approval flow, and a saved Idea Vault.

**IMPORTANT:** The OpenAI Agents API integration uses the managed Codex harness. Muse connects through Meta Model API and advises each specialist before Codex produces the final deliverable. These connections activate only when server-side credentials are configured. Creative retains the existing Eve fallback locally. No agent can automatically publish, contact anyone, spend money, or perform external actions.

## Quick start

Install once, then start the local site:

```bash
npm install
npm run dev
# Open http://127.0.0.1:4173
```

Copy `.env.example` to `.env.local` and configure the provider keys you want:

```bash
OPENAI_API_KEY=...     # Codex harness for all agents
MODEL_API_KEY=...      # optional Muse Spark collaborator
NYONI_ACCESS_TOKEN=... # required before production execution
```

The Vite development server starts the website, Codex/Muse bridge routes, and the existing Eve Creative-agent fallback together.

The checked-in Three.js vendor files and GLBs are served locally. Do not open `index.html` directly with `file://`; browser module, agent routes, and GLB security rules require the local HTTP server.

Production requires server-side environment variables and an access token or full application authentication. The API refuses paid production execution when `NYONI_ACCESS_TOKEN` is missing.

## What works today

- Four real-time Three.js rooms exported from Blender, with orbit, zoom, reset and responsive rendering.
- Commercials: campaign workstations for Scout, Creative, Hunter, and Pulse.
- Entertainment: Story writers' room, Motion editing bay, Creative station, and screening lounge.
- Research Lab: Scout and Vault stations, archive wall, research pods, and central idea table.
- Mission Control: MIGO command station, briefing table, ops consoles, and dashboard wall.
- 8 animated, color-coded agent identities with visible name/role banners and enlarged click targets across the four rooms.
- Bot selection updates the inspected agent everywhere in the HQ.
- Managed Codex harness bridge for all eight agents, with streamed runtime phases and per-agent instructions.
- Optional Muse Spark collaborator pass connected to every Codex identity.
- Existing Creative Eve fallback with durable server sessions and real draft briefs when Codex is not configured.
- New assignment form, task board, task detail, approve/revise/delete, runtime badges, and an honest connection status panel.
- Idea Vault: add ideas, launch assignment from idea.
- Deliverables page reflecting local sample outputs.
- `localStorage` saves your tasks/ideas in this browser.
- Responsive layout for phone and desktop; reduced-motion support.

## Planned production architecture

Use this build as the visual/UI foundation, **not** as a production backend:

| Layer | Production approach |
| --- | --- |
| Front end | Current Vite interface with Three.js; optionally move to Next.js/React as the product grows |
| Identity | Supabase Auth with owner/team membership |
| Data | Supabase Postgres + RLS on organizations, tasks, steps, events, approvals, assets |
| Execution | OpenAI Agents API managed Codex harness; Meta Muse collaborator; Eve fallback for Creative |
| Long tasks | Codex sessions or Eve durable sessions, with database-backed assignment/event records added next |
| Live statuses | Actual Codex/Eve stream events drive assignment status; Supabase Realtime can fan them out later |
| Source-backed research | Permissioned web search tools and citations |
| Asset creation | Explicit integrations for images/video, only when provider APIs permit |
| Approvals | Human approval before emails, posts, client sends or spend |
| Storage | Signed storage URLs for generated files, not client-side fake assets |

### Suggested minimum database tables

- `organizations` and `memberships`
- `agents` (identity/persona/tool permissions)
- `projects`
- `tasks` (queued/running/waiting_approval/done/failed/cancelled)
- `task_steps` (named stage, actual completion timestamps)
- `task_events` (append-only actions, agent id, timestamps, outputs)
- `deliverables` (file refs/content, provenance, approval state)
- `ideas`
- `approval_requests`
- `tool_runs` (safe execution logging, duration, cost, error)

## Suggested milestone sequence

1. Complete: visual prototype and four interactive rooms.
2. Complete locally: Creative live-agent execution and approval flow.
3. Complete in code: Codex profiles for all agents, Muse collaborator bridge, runtime status, and 3D name banners.
4. Add the provider credentials and verify one live Codex + Muse run.
5. Add Supabase Auth, RLS and persistent task/event tables.
6. Deploy and replace the studio passcode with production user authentication.
7. Add Scout's sourced research workflow; citations and tool use must be inspected.
8. Enable agent collaboration via recorded handoffs, shared project context and approvals.
9. Integrate external creation APIs only with credentials, rate limits, budgets and approvals.

## Security notes

Never put a model API key, Supabase service-role key or other provider secrets in browser JavaScript. Add backend authorization, spending limits, task quotas and audit logs before connecting autonomous tools. Require explicit human approval for contacting prospects, publishing content, and incurring costs.
