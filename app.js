/* Nyoni HQ v0.6 — interactive 3D studio with Codex + Muse agent bridges. */
import { runCreativeAssignment } from './creative-agent.js';
import { createStudioAssignment, getAgentRuntimeStatus, hasStudioPasscode, listStudioActivity, listStudioAssignments, runCodexAssignment, saveStudioPasscode, updateStudioAssignment } from './nyoni-agent.js';
const AGENTS = [
  {id:'migo', name:'MIGO', role:'Studio Director', floor:3, accent:'#b8eadb', specialty:'Coordinates projects, triages tasks and queues approvals.', icon:'✦'},
  {id:'scout', name:'Scout', role:'Research & Discovery', floor:0, accent:'#9bdcb2', specialty:'Research briefs, trends, competitor scans and market intelligence.', icon:'⌕'},
  {id:'creative', name:'Creative', role:'Art Director', floor:0, accent:'#d7b1f0', specialty:'Ad directions, campaign concepts and creative briefs.', icon:'✳'},
  {id:'hunter', name:'Hunter', role:'Client Acquisition', floor:0, accent:'#e49a55', specialty:'Prospect lists and personalized outreach drafts, pending review.', icon:'↗'},
  {id:'pulse', name:'Pulse', role:'Analytics', floor:0, accent:'#69aee8', specialty:'Performance analysis and client-friendly reports.', icon:'▥'},
  {id:'story', name:'Story', role:'Screenwriting', floor:1, accent:'#f1b5ae', specialty:'Script outlines, dialogue, character and continuity notes.', icon:'✎'},
  {id:'motion', name:'Motion', role:'Production Designer', floor:1, accent:'#9dc4fb', specialty:'Shot design, storyboards, Seedance-ready production prompts.', icon:'▣'},
  {id:'vault', name:'Vault', role:'Ideas & Experiments', floor:2, accent:'#eedb92', specialty:'Concept discovery, categorization, idea development and backlog.', icon:'◇'},
  {id:'ledger', name:'Ledger', role:'Financial Controller', floor:6, accent:'#80d8c2', specialty:'Reconciliation, revenue records, subscriptions, invoices and operating costs.', icon:'＄'},
  {id:'margin', name:'Margin', role:'FP&A Analyst', floor:6, accent:'#f0c56f', specialty:'Forecasts, profitability, unit economics and bounded budget recommendations.', icon:'↗'},
  {id:'treasury', name:'Treasury', role:'Cash Operations', floor:6, accent:'#86bff2', specialty:'Cash flow, receivables, renewals and approval-gated financial actions.', icon:'¤'},
  {id:'audit', name:'Audit', role:'Risk & Compliance', floor:6, accent:'#e99ba8', specialty:'Anomaly detection, financial controls, missing records and policy review.', icon:'✓'},
  {id:'lumina', name:'Lumina', role:'Text-to-Image Artist', floor:7, accent:'#f3b4d4', specialty:'Turns written briefs into finished campaign images through Nyoni Studio.', icon:'◉'},
  {id:'reframe', name:'Reframe', role:'Image-to-Image Artist', floor:7, accent:'#c7a7f5', specialty:'Restyles, repairs and transforms source images while preserving what matters.', icon:'◇'},
  {id:'nova', name:'Nova', role:'Text-to-Video Director', floor:8, accent:'#89b9ff', specialty:'Directs vertical video from text with Seedance camera, action and sound.', icon:'▶'},
  {id:'kinetic', name:'Kinetic', role:'Image-to-Video Animator', floor:8, accent:'#7ce0d4', specialty:'Animates supplied stills with intentional motion and visual continuity.', icon:'↝'},
  {id:'cutline', name:'Cutline', role:'AI Video Editor', floor:8, accent:'#f39b86', specialty:'Edits and transforms supplied footage into publish-ready visual sequences.', icon:'✂'},
  {id:'sonora', name:'Sonora', role:'Music Composer', floor:9, accent:'#f0cc72', specialty:'Composes campaign music and scene scores through Suno-compatible KIE tools.', icon:'♫'},
  {id:'vox', name:'Vox', role:'Voice Director', floor:9, accent:'#a9d7f2', specialty:'Directs and generates natural voice performances through ElevenLabs.', icon:'◖'},
  {id:'rally', name:'Rally', role:'Campaign Producer', floor:10, accent:'#f19db8', specialty:'Builds campaign visuals and coordinates creative production across departments.', icon:'✦'},
];
const FLOORS = [
  {name:'Nyoni Commercials',slug:'commercials',poster:'commercials_poster.png',label:'NYONI COMMERCIALS',code:'01',color:'#9fe3c8',desc:'Client work · Campaigns · Research · Outreach',bots:['scout','creative','hunter','pulse']},
  {name:'Colony Zero',slug:'entertainment',poster:'entertainment_isometric.png',label:'COLONY ZERO',code:'02',color:'#b3bafb',desc:'Original world · Story · Production',bots:['story','motion','creative']},
  {name:'Palava 231',slug:'entertainment',poster:'entertainment_isometric.png',label:'PALAVA 231',code:'03',color:'#98c7fb',desc:'Story development · Motion · Creative',bots:['story','motion','creative']},
  {name:'SANKOFI',slug:'research_lab',poster:'research_lab_isometric.png',label:'SANKOFI',code:'04',color:'#eab6d4',desc:'Culture-led stories · Research · Ideas',bots:['vault','scout','story']},
  {name:'Research & Ideas Lab',slug:'research_lab',poster:'research_lab_isometric.png',label:'RESEARCH & IDEAS',code:'05',color:'#e8d29e',desc:'Trend discovery · Experiments · Idea vault',bots:['vault','scout']},
  {name:'Mission Control',slug:'mission_control',poster:'mission_control_isometric.png',label:'MISSION CONTROL',code:'06',color:'#c2d4e4',desc:'Executive operations · Assignment routing · Approvals',bots:['migo','pulse']},
  {name:'Finance Department',slug:'commercials',poster:'commercials_poster.png',label:'FINANCE DEPARTMENT',code:'07',color:'#80d8c2',desc:'Revenue · Forecasting · Reconciliation · Risk',bots:['ledger','margin','treasury','audit']},
  {name:'Photo Department',slug:'research_lab',poster:'research_lab_isometric.png',label:'PHOTO DEPARTMENT',code:'08',color:'#f3b4d4',desc:'Text to image · Image transformation · Campaign stills',bots:['lumina','reframe']},
  {name:'Video Department',slug:'entertainment',poster:'entertainment_isometric.png',label:'VIDEO DEPARTMENT',code:'09',color:'#89b9ff',desc:'Text to video · Image animation · AI editing',bots:['nova','kinetic','cutline']},
  {name:'Audio Department',slug:'mission_control',poster:'mission_control_isometric.png',label:'AUDIO DEPARTMENT',code:'10',color:'#f0cc72',desc:'Music composition · Voice direction · Audio generation',bots:['sonora','vox']},
  {name:'Campaign Studio',slug:'commercials',poster:'commercials_poster.png',label:'CAMPAIGN STUDIO',code:'11',color:'#f19db8',desc:'Campaign production · Creative systems · Performance',bots:['rally','creative','pulse']}
];
const SEED_TASKS=[];
const KEY='nyoni-hq-v01';
const blankState=()=>({page:'hq',floor:0,agent:'scout',task:null,tasks:[],ideas:[],events:[]});
let state=blankState();
let runtime={loading:true,codex:false,muse:false,studio:false,eve:true,protected:true,codexModel:'gpt-6-luna',reasoningEffort:'low',premiumModelsLocked:true,museModel:'muse-spark-1.3',stripe:false,elevenLabs:false,kie:false,waveSpeed:false};
try {const saved=JSON.parse(localStorage.getItem(KEY)); if(saved && Array.isArray(saved.tasks)&&Array.isArray(saved.ideas)){state={...state,...saved,page:'hq'};}}catch{}
state.tasks=state.tasks.filter(t=>!t.sample);
state.ideas=state.ideas.filter(i=>!i.sample);
state.tasks.forEach(t=>{if(t.status==='running'){t.status='failed';t.error='The previous live run was interrupted. Retry when the Creative runtime is available.';t.runPhase='';}});
const $=s=>document.querySelector(s);
const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const agent=id=>AGENTS.find(a=>a.id===id)||AGENTS[0];
const task=id=>state.tasks.find(t=>t.id===id);
const now=()=>new Date().toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
function store(){try{localStorage.setItem(KEY,JSON.stringify({floor:state.floor,agent:state.agent,tasks:state.tasks,ideas:state.ideas,events:state.events}));}catch{}}
function log(message){state.events.unshift({message,time:now()});state.events=state.events.slice(0,15);store();}
const statuses={queued:'Queued',running:'Working live',review:'Needs approval',waiting_approval:'Needs approval',approved:'Approved',done:'Completed',rejected:'Changes requested',failed:'Run failed',cancelled:'Cancelled'};

function remoteTask(row){
 const status={waiting_approval:'review',cancelled:'failed'}[row.status]||row.status;
 const version=row.nyoni_artifacts?.[0]?.nyoni_artifact_versions?.[0]?.content;
 return {id:row.id,title:row.title,agent:row.agent_id,project:row.projects?.name||row.request?.project||'Nyoni Studios',status,
  created:new Date(row.created_at).toLocaleString(),output:row.result?.deliverable||version?.deliverable||'',media:row.result?.media||version?.media||[],providers:row.result?.providers||{},error:row.error||'',remote:true,
  workflowRunId:row.workflow_run_id,steps:row.nyoni_workflow_steps||[],handoffs:row.nyoni_handoffs||[],blockers:row.result?.blockers||[]};
}

function activityTask(row){
 const status={waiting_approval:'review',cancelled:'failed'}[row.status]||row.status;
 return {id:`activity-${row.id}`,title:row.phase||'Studio mission in progress',agent:row.agentId,project:'Nyoni Studios',status,
  created:new Date(row.updatedAt).toLocaleString(),output:'',error:'',activityOnly:true,remote:false,steps:[]};
}

async function syncRemoteAssignments({quiet=true}={}){
 if(!runtime.studio)return;
 try{
  const authenticated=hasStudioPasscode();
  const rows=authenticated?await listStudioAssignments():await listStudioActivity();
  const remote=rows.map(authenticated?remoteTask:activityTask),locals=state.tasks.filter(t=>!t.remote&&!t.activityOnly);
  state.tasks=[...remote,...locals];
  if(state.task&&!state.tasks.some(t=>t.id===state.task))state.task=null;
  store();render();
 }catch(error){if(!quiet)toast(error.message);console.warn('Assignment sync unavailable',error)}
}
function runtimeLabel(){
 if(runtime.loading)return 'CHECKING';
 if(runtime.codex&&runtime.muse)return 'CODEX + MUSE';
 if(runtime.codex)return 'CODEX LIVE';
 return 'CODEX READY';
}
function agentIsLive(a){return Boolean(runtime.codex||(a.id==='creative'&&runtime.eve))}
function providerLabel(a){
 if(['lumina','reframe','nova','kinetic','cutline','sonora','rally'].includes(a.id)&&runtime.kie)return 'KIE · LIVE';
 if(a.id==='vox'&&runtime.elevenLabs)return 'ELEVENLABS · LIVE';
 if(runtime.codex)return runtime.muse?'CODEX · MUSE':'CODEX';
 if(a.id==='creative'&&runtime.eve)return 'EVE LIVE';
 return 'CODEX READY';
}
function updateRuntimeChrome(){
 const title=$('#runtime-title'),detail=$('#runtime-detail'),mode=$('#runtime-mode');
 if(title)title.textContent=runtime.codex?(runtime.muse?'Codex + Muse connected':'Codex connected'):'Codex keys needed';
 if(detail)detail.textContent=runtime.codex?`20 live agents · Muse ${runtime.muse?'on':'off'}`:runtime.eve?'Creative fallback live · 19 ready':'20 agent profiles ready · keys needed';
 if(mode)mode.innerHTML=`<span></span> ${runtimeLabel()}`;
}
function botSvg(a,size=1){const c=a.accent;return `<g transform="scale(${size})">
  <ellipse cx="0" cy="29" rx="28" ry="8" fill="#020b15" opacity=".32" class="bot-glow"/>
  <g class="bot-float"><path d="M-13 14 Q0 6 13 14 L16 34 Q0 39 -16 34Z" fill="#c8d7df" stroke="#6b8a98" stroke-width="1.7"/><rect x="-7" y="24" width="14" height="6" rx="3" fill="${c}"/>
  <rect x="-25" y="-28" width="50" height="44" rx="17" fill="#dce8ec" stroke="#7f99a5" stroke-width="1.8"/><rect x="-20" y="-22" width="40" height="33" rx="12" fill="#102634" stroke="#294858" stroke-width="1.5"/>
  <ellipse cx="-9" cy="-5" rx="4" ry="6" fill="${c}" class="bot-eye"/><ellipse cx="9" cy="-5" rx="4" ry="6" fill="${c}" class="bot-eye"/><path d="M-4 5Q0 8 4 5" stroke="${c}" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  <path d="M0-29V-38" stroke="#8faab6" stroke-width="3" stroke-linecap="round"/><circle cx="0" cy="-41" r="4.5" fill="${c}"/>
  <path d="M-24 20Q-34 16-34 26" stroke="#a3bac4" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M24 20Q34 16 34 26" stroke="#a3bac4" stroke-width="6" fill="none" stroke-linecap="round"/>
  <rect x="-13" y="33" width="9" height="7" rx="3" fill="#9bb3bd"/><rect x="4" y="33" width="9" height="7" rx="3" fill="#9bb3bd"/>
  <circle cx="-13" cy="-23" r="3" fill="#f9ffff" opacity=".6"/></g></g>`}
function botPortrait(a){return `<svg viewBox="-52 -58 104 108" aria-label="${safe(a.name)} bot"><circle cx="0" cy="0" r="49" fill="${a.accent}" opacity=".07"/>${botSvg(a,1)}</svg>`}
function desk(x,y,a,extra=''){const desk=`<g transform="translate(${x},${y})">
  <ellipse cx="0" cy="50" rx="80" ry="31" fill="#000c18" opacity=".28" />
  <path d="M-75 17L-4-20 72 16 0 53Z" fill="#385160" stroke="#617b86" stroke-width="2"/>
  <path d="M-75 17L0 53V68L-75 31Z" fill="#1d3441" stroke="#526978"/><path d="M0 53L72 16V31L0 68Z" fill="#263f4b" stroke="#5a7682"/>
  <path d="M-10-2L14-14 42 0 17 14Z" fill="#091e2c" stroke="#91bdbe" stroke-width="1.5"/>
  <path d="M-12-43L24-64 45-52 10-30Z" fill="#496471" stroke="#83a9b6"/><path d="M-8-45L23-62 41-51 10-34Z" fill="#112a37"/>
  <path d="M2-44L16-52 32-44 18-36Z" fill="${a.accent}" opacity=".42"/><path d="M10-30L20-26 24-23 13-21Z" fill="#718e9a"/>
  <path d="M-50 17L-30 7 -9 17 -30 28Z" fill="#102432" stroke="#45687a"/><path d="M-43 15L-26 7 -14 15 -31 23Z" fill="${a.accent}" opacity=".35"/>
  <path d="M43 8L53 3 58 6 49 13Z" fill="#edddc3"/>
  </g>`;
  return `<g>${desk}<g transform="translate(${x-8},${y-50})">${botSvg(a,.76)}</g>
  <g class="bot-hit" data-agent="${a.id}" tabindex="0" role="button" aria-label="Inspect ${a.name}" transform="translate(${x-8},${y-50})">
   <circle class="bot-glow" cx="0" cy="-10" r="41" fill="${a.accent}" opacity=".07"/><circle cx="0" cy="-10" r="47" fill="transparent"/>
  </g><g transform="translate(${x-36},${y+66})"><rect width="75" height="22" rx="8" fill="#102633" stroke="#41606d"/><circle cx="11" cy="11" r="3" fill="${a.accent}"/><text x="20" y="14.5" font-size="10" font-weight="700" fill="#d8e8e7">${safe(a.name)}</text></g>${extra}</g>`;
}
function sceneSvg(){const floor=FLOORS[state.floor], bots=floor.bots.map(agent);
 const spots={1:[[407,312]],2:[[303,285],[483,306]],3:[[280,274],[480,292],[389,374]],4:[[275,260],[460,240],[532,320],[290,362]]}[bots.length];
 const spotsOrder=bots.map((a,i)=>({a,xy:spots[i]})).sort((a,b)=>a.xy[1]-b.xy[1]);
 const back='<path d="M65 262L398 80 735 262 404 446Z" fill="#192e3d" opacity=".25"/>';
 const windows=`<path d="M69 252L399 71V132L69 312Z" fill="#263e4b" stroke="#68889a" stroke-width="2" opacity=".70"/><path d="M399 71L731 252V311L399 132Z" fill="#233a48" stroke="#718d9a" stroke-width="2" opacity=".6"/>`;
 const pane=`<g opacity=".8"><path d="M110 245L190 203V258L110 300Z" fill="#163344" stroke="#799fae"/><path d="M215 188L300 143V197L215 244Z" fill="#163344" stroke="#799fae"/><path d="M489 144L574 189V245L489 198Z" fill="#132e3e" stroke="#6f9aa8"/><path d="M606 206L687 251V304L606 262Z" fill="#112c3d" stroke="#6f9aa8"/></g>`;
 const floorLines=Array.from({length:7},(_,i)=>{let t=(i+1)/8;let x1=70+(400-70)*t,y1=267+(84-267)*t,x2=400+(733-400)*t,y2=84+(267-84)*t;return `<path d="M${x1} ${y1}L${400+(733-400)*(1-t)} ${84+(267-84)*(1-t)}" stroke="#a0baca" stroke-width=".8" opacity=".09"/>`}).join('');
 return `<svg viewBox="0 0 800 530" role="img" aria-label="Isometric miniature room for ${safe(floor.name)} with interactive robots" xmlns="http://www.w3.org/2000/svg">
 <defs><radialGradient id="roomGlow"><stop offset="0" stop-color="${floor.color}" stop-opacity=".12"/><stop offset="1" stop-color="#0e1d2c" stop-opacity="0"/></radialGradient><linearGradient id="floorFace" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#355066"/><stop offset="1" stop-color="#203846"/></linearGradient></defs>
 <circle cx="400" cy="270" r="260" fill="url(#roomGlow)" />${back}
 <path d="M65 268L400 84 735 268 400 452Z" fill="#2a4654" stroke="#77929d" stroke-width="2"/>
 <path d="M65 268L400 452V481L65 297Z" fill="#1a313d" stroke="#4b6b77"/>
 <path d="M400 452L735 268V297L400 481Z" fill="#263c49" stroke="#496977"/>
 <path d="M65 268L400 84 735 268 400 452Z" fill="url(#floorFace)" opacity=".9"/>${windows}${pane}
 <path d="M65 268L400 452L735 268" fill="none" stroke="#b3d3d4" opacity=".3" stroke-width="2"/>
 <path d="M118 267L401 115 683 267 400 422Z" fill="none" stroke="#7ea2af" opacity=".15" stroke-width="1"/>
 <path d="M150 268L400 133 650 268 400 405Z" fill="none" stroke="#6e929e" opacity=".12"/>
 <path d="M65 268L735 268M400 84L400 452" stroke="#a0baca" stroke-width=".7" opacity=".10" />
 <g transform="translate(147 322)"><path d="M0 0L27-15 55 0 27 16Z" fill="#4e6a68"/><path d="M10-19v22M22-27v30" stroke="#5d9b7a" stroke-width="4" stroke-linecap="round"/><ellipse cx="14" cy="-32" rx="15" ry="9" fill="#6ea68e"/><ellipse cx="28" cy="-23" rx="14" ry="8" fill="#5a987b"/></g>
 <g transform="translate(613 330)"><path d="M0 0L25-14 47 0 22 14Z" fill="#886e6b"/><path d="M18-12v-32M30-8v-39" stroke="#669c7b" stroke-width="4"/><ellipse cx="18" cy="-47" rx="15" ry="9" fill="#6aaf8c"/><ellipse cx="31" cy="-55" rx="14" ry="9" fill="#7fb99a"/></g>
 ${state.floor===3?`<g transform="translate(288 208)"><path d="M-55-20L0-50 55-20 0 10Z" fill="#36515c" stroke="#6f95a0"/><text x="-5" y="-20" font-size="13" fill="#cce7df" text-anchor="middle" font-weight="800">NYONI</text></g>`:''}
 ${spotsOrder.map(({a,xy})=>desk(xy[0],xy[1],a)).join('')}
 <g><path d="M310 471L402 519 490 471" fill="none" stroke="#a8e8d5" opacity=".22" stroke-width="1"/><text x="400" y="496" font-size="9" fill="#7f99a4" text-anchor="middle" letter-spacing="2">NYONI STUDIOS · FLOOR ${floor.code}</text></g>
 </svg>`}
function taskItem(t){const a=agent(t.agent);return `<div class="task-item" data-task="${safe(t.id)}" tabindex="0" role="button" aria-label="Open assignment ${safe(t.title)}"><div class="task-symbol" style="color:${a.accent}">${a.icon}</div><div class="task-text"><strong>${safe(t.title)}</strong><span>${safe(a.name)} · ${safe(t.project)}${t.sample?' · SAMPLE':''}</span></div><span class="task-state ${safe(t.status)}">${statuses[t.status]||t.status}</span></div>`}
function renderHQLegacy(){const floor=FLOORS[state.floor],selected=agent(state.agent);const city=[
  ['10%',44,280],['20%',60,410],['34%',48,345],['49%',76,505],['65%',56,390],['79%',68,470],['91%',43,300]
];const stageMarkup=`<div class="stage-model stage-model-webgl" id="hq-3d-stage">
      <img class="stage-poster" src="./assets/3d/${floor.poster}" alt="Rendered overview of the Nyoni ${safe(floor.name)} floor"/>
      <canvas aria-label="Interactive 3D ${safe(floor.name)} room. Drag to orbit, scroll to zoom, and click an agent."></canvas>
      <div class="stage-loader"><span data-3d-status>Preparing ${safe(floor.name)}…</span><i data-3d-progress></i></div>
      <div class="three-controls" aria-label="3D camera controls">
        <button class="active" type="button" data-3d-action="rotate" aria-pressed="true"><span>↻</span> Orbit</button>
        <button type="button" data-3d-action="reset"><span>⌂</span> Reset</button>
      </div>
    </div>`;
 return `<section class="world-hero" style="--floor-accent:${floor.color}">
  <div class="world-atmosphere" aria-hidden="true"><div class="world-sun"></div>${city.map(([x,w,h],i)=>`<span class="city-building b${i+1}" style="--x:${x};--w:${w}px;--h:${h}px"></span>`).join('')}<div class="world-grid"></div></div>
  <div class="world-copy">
    <div class="world-kicker"><span></span> NYONI STUDIOS / AGENT CAMPUS</div>
    <h2>A living studio<br/>for ideas <em>in motion.</em></h2>
    <p>Move through six project floors. Step into a room, meet the crew, and turn an idea into an autonomous assignment.</p>
    <button class="world-primary" data-page="tasks">Enter the task board <span>↗</span></button>
  </div>
  <div class="world-stage" aria-label="Interactive Nyoni studio floor">
    <div class="stage-halo"></div>
    ${stageMarkup}
    <div class="stage-caption"><span class="live-pulse"></span>REAL-TIME 3D · drag, zoom, click a bot</div>
  </div>
  <aside class="world-directory" aria-label="Studio floor directory">
    <div class="directory-top"><div><small>STUDIO DIRECTORY</small><strong>Choose a floor</strong></div><span>${floor.code} / 06</span></div>
    <div class="directory-search">⌕ <span>Find a room or agent</span><kbd>⌘ K</kbd></div>
    <div class="directory-list">${FLOORS.map((f,i)=>`<button class="directory-floor ${i===state.floor?'active':''}" data-floor="${i}" style="--chip:${f.color}"><span class="floor-index">${f.code}</span><span class="floor-swatch"></span><span class="floor-copy"><strong>${safe(f.name)}</strong><small>${f.bots.map(id=>agent(id).name).join(' · ')}</small></span><span class="floor-arrow">${i===state.floor?'●':'↗'}</span></button>`).join('')}</div>
    <div class="directory-foot">POINT AT A BOT TO MEET THE CREW</div>
  </aside>
  <div class="world-agent" style="--agent:${selected.accent}">
    <div class="world-agent-portrait">${botPortrait(selected)}</div>
    <div><span>NOW INSPECTING</span><strong>${selected.name}</strong><small>${safe(selected.role)}</small></div>
    <button data-page="agents" aria-label="Open all agents">↗</button>
  </div>
  <div class="world-dock">
    <div class="dock-status"><span></span><small>FLOOR ${floor.code}</small><strong>${safe(floor.name)}</strong></div>
    <div class="dock-divider"></div>
    <div class="dock-stat"><small>ASSIGNMENTS</small><strong>${state.tasks.length}</strong></div>
    <div class="dock-stat"><small>NEED REVIEW</small><strong>${state.tasks.filter(t=>t.status==='review').length}</strong></div>
    <button class="dock-action" id="new-task-top-dock"><span>＋</span> New assignment</button>
  </div>
  <div class="world-help">CLICK A BOT <span>·</span> SWITCH FLOORS <span>·</span> BUILD THE MISSION</div>
 </section>`}
function agentWork(agentId,projectName=''){
 const active=state.tasks.find(t=>t.agent===agentId&&(!projectName||t.project===projectName)&&['running','queued','review','failed'].includes(t.status));
 if(!active)return {status:'idle',label:'Available',detail:'Ready for a mission',task:null,progress:0};
 const done=active.steps?.filter(step=>step.status==='done').length||0,total=active.steps?.length||0;
 const label={running:'Working',queued:'Queued',review:'Needs you',failed:'Blocked'}[active.status]||active.status;
 const detail=active.status==='running'?(active.steps?.find(step=>step.status==='running')?.title||active.runPhase||active.title):active.title;
 return {status:active.status,label,detail,task:active,progress:total?Math.round(done/total*100):active.status==='review'?100:active.status==='running'?48:8};
}
function workBubble(a,projectName){const work=agentWork(a.id,projectName);return `<button class="work-bubble ${work.status}" data-agent-console="${a.id}" style="--agent:${a.accent}"><span class="work-orb">${a.icon}</span><span class="work-copy"><b>${safe(a.name)}</b><small>${safe(work.label)} · ${safe(work.detail)}</small><i><em style="width:${work.progress}%"></em></i></span>${work.status==='review'?'<span class="needs-you">YOU</span>':''}</button>`}
function renderHQ(){
 const floor=FLOORS[state.floor],floorAgents=floor.bots.map(agent),floorTasks=state.tasks.filter(t=>t.project===floor.name),active=floorTasks.filter(t=>['running','queued'].includes(t.status)).length,review=floorTasks.filter(t=>t.status==='review').length;
 const stageMarkup=`<div class="stage-model stage-model-webgl" id="hq-3d-stage"><img class="stage-poster" src="./assets/3d/${floor.poster}" alt="Rendered ${safe(floor.name)} floor"/><canvas aria-label="Interactive 3D ${safe(floor.name)} room"></canvas><div class="stage-loader"><span data-3d-status>Preparing ${safe(floor.name)}…</span><i data-3d-progress></i></div><div class="three-controls"><button class="active" type="button" data-3d-action="rotate" aria-pressed="true">↻ Orbit</button><button type="button" data-3d-action="reset">⌂ Reset</button></div></div>`;
 return `<section class="command-home" style="--floor-accent:${floor.color}">
  <header class="command-head"><div><span class="command-kicker"><i></i> NYONI HQ · LIVE STUDIO</span><h2>${safe(floor.name)}</h2><p>${safe(floor.desc)}</p></div><div class="command-head-actions"><span><b>${active}</b> working</span><span class="${review?'hot':''}"><b>${review}</b> need you</span><button id="new-task-command">＋ Assign</button></div></header>
  <nav class="floor-rail" aria-label="Project floors">${FLOORS.map((item,index)=>`<button data-floor="${index}" class="${index===state.floor?'active':''}" style="--chip:${item.color}"><i></i><span>${item.code}</span>${safe(item.name)}</button>`).join('')}</nav>
  <main class="command-grid">
   <section class="command-stage"><div class="stage-glow"></div>${stageMarkup}<div class="stage-live"><i></i> LIVE 3D · CLICK A BOT OR WORK BUBBLE</div></section>
   <aside class="worker-panel"><div class="panel-cap"><span>ON THIS FLOOR</span><b>${floorAgents.length} agents</b></div><div class="worker-list">${floorAgents.map(a=>workBubble(a,floor.name)).join('')}</div><button class="talk-migo" data-agent-console="migo">✦ Ask MIGO to run the studio</button></aside>
  </main>
  <section class="command-bottom"><div class="live-feed"><div class="panel-cap"><span>FLOOR ACTIVITY</span><b>${floorTasks.length} real assignments</b></div>${floorTasks.slice(0,4).map(t=>`<button data-task="${safe(t.id)}"><i class="${safe(t.status)}"></i><span><b>${safe(agent(t.agent).name)}</b>${safe(t.title)}</span><small>${safe(t.blockers?.length?`${t.blockers.length} blockers`:statuses[t.status]||t.status)}</small></button>`).join('')||'<p>No recorded work on this floor yet.</p>'}</div><div class="money-card"><span>PROJECT MEMORY</span><h3>${safe(floor.name)} stays isolated.</h3><p>Agents load this floor’s saved operating charter and project-specific sources. Cross-project canon is never treated as memory.</p><button data-agent-console="migo">Ask MIGO ↗</button></div></section>
  <button class="mobile-assign" id="new-task-mobile">＋ New assignment</button>
 </section>`;
}
function renderAgents(){return `<div class="wide-panel"><div class="panel-header"><div><div class="wide-title">Meet the crew</div><p class="fineprint">Every identity has a Codex harness profile and an optional Muse collaborator. Connections turn on server-side when their keys are configured.</p></div><button class="panel-link" id="connections-inline">Connections ↗</button></div><div class="agent-grid">${AGENTS.map(a=>`<button class="agent-grid-card" data-agent="${a.id}" style="--agent:${a.accent}"><span class="agent-name-banner"><b>${safe(a.name)}</b><small>${safe(a.role)}</small></span>${botPortrait(a)}<span class="agent-provider ${agentIsLive(a)?'is-live':''}">${safe(providerLabel(a))}</span><span class="mini-tag">${state.tasks.filter(t=>t.agent===a.id).length} assignments</span></button>`).join('')}</div></div>`}
function renderTasks(){return `<div class="wide-panel"><div class="panel-header"><span class="wide-title">All assignments</span><button class="panel-link" id="add-task-inline">＋ New assignment</button></div><p class="fineprint">All 20 agents plan through Codex; production specialists also operate KIE, Suno-compatible music and ElevenLabs through bounded department budgets.</p><div style="overflow-x:auto"><table class="full-task-table"><thead><tr><th>ASSIGNMENT</th><th>AGENT</th><th>RUNTIME</th><th>PROJECT</th><th>STATUS</th><th></th></tr></thead><tbody>${state.tasks.map(t=>{const a=agent(t.agent);return `<tr><td>${safe(t.title)}${t.sample?' <span class="mini-tag">SAMPLE</span>':''}</td><td>${safe(a.name)}</td><td><span class="mini-tag">${safe(providerLabel(a))}</span></td><td>${safe(t.project)}</td><td>${safe(statuses[t.status]||t.status)}</td><td><button class="task-open" data-task="${safe(t.id)}">Open ↗</button></td></tr>`}).join('')}</tbody></table></div></div>`}
function renderIdeas(){return `<div class="wide-panel"><div class="wide-title">The Idea Vault</div><p class="fineprint">Drop concepts here, then assign one to an agent from the task board. Stored locally in this browser.</p><form class="idea-form" id="idea-form"><input type="text" name="idea" maxlength="140" placeholder="A concept worth exploring..." required aria-label="New idea title"/><button type="submit">Save idea</button></form></div><div class="wide-panel"><div class="panel-header"><span class="panel-title">Saved concepts</span><span class="mini-tag">${state.ideas.length} entries</span></div>${state.ideas.map(i=>`<div class="idea-entry"><span class="meta">${i.sample?'EXAMPLE IDEA':'YOUR IDEA'}</span><h3>${safe(i.title)}</h3><p>${safe(i.description||'Ready to develop into an assignment.')}</p><button class="panel-link" data-idea-assign="${safe(i.id)}" style="margin-top:9px">Assign to agent ↗</button></div>`).join('')}</div>`}
function mediaPreview(t){return (t.media||[]).map(item=>item.type==='video'?`<video controls playsinline preload="metadata" src="${safe(item.url)}"></video>`:item.type==='audio'?`<audio controls preload="metadata" src="${safe(item.url)}"></audio>`:`<img loading="lazy" src="${safe(item.url)}" alt="Generated media for ${safe(t.title)}"/>`).join('')}
function renderOutputs(){const outputs=state.tasks.filter(t=>t.output||t.media?.length);return `<div class="wide-panel"><div class="wide-title">Deliverables & approvals</div><p class="fineprint">Generated images, video and audio appear here for review. Nothing is automatically published or sent.</p>${outputs.length?outputs.map(t=>`<div class="detail-card"><span class="mini-tag">${safe(statuses[t.status])} · ${safe(t.providers?.studio||t.providers?.muse?'STUDIO LIVE':t.providers?.codex?'CODEX':t.agent==='creative'&&!t.sample?'EVE LIVE':'SAMPLE')}</span><b style="margin-top:9px">${safe(t.title)}</b>${t.media?.length?`<div class="deliverable-media">${mediaPreview(t)}</div>`:''}<p>${safe(t.output)}</p><div class="detail-actions"><button class="btn-ghost" data-task="${safe(t.id)}">Review assignment ↗</button></div></div>`).join(''):'<div class="empty-state">Outputs will show here after an agent finishes an assignment.</div>'}</div>`}
function taskProgress(status){return {queued:1,rejected:1,failed:1,running:2,review:3,approved:4,done:4}[status]||1}
function taskActions(t,a){
 if(t.status==='running')return `<button class="btn-outline agent-running" type="button" disabled><span class="run-pulse"></span><span id="agent-run-status">${safe(t.runPhase||'Creative is working')}</span></button>`;
 if(t.remote&&['queued','running'].includes(t.status))return `<button class="btn-outline" id="sync-task">↻ Refresh durable run</button>${t.steps?.length?`<p class="inspector-note">${t.steps.map(s=>`${safe(s.title)} · ${safe(statuses[s.status]||s.status)}`).join('<br/>')}</p>`:''}`;
 if(['queued','rejected','failed'].includes(t.status))return `<button class="btn-outline" id="preview-task">✧ ${runtime.codex?`Run ${a.name} in Codex${runtime.muse?' + Muse':''}`:a.id==='creative'?'Run Creative fallback live':'Connect Codex to activate'}</button>${t.error?`<p class="run-error">${safe(t.error)}</p>`:''}`;
 if(t.status==='review')return `<button class="btn-outline" id="approve-task">✓ Approve live deliverable</button><button class="btn-ghost" style="width:100%;margin-top:8px" id="reject-task">Request changes</button>`;
 if(t.status==='approved')return `<span class="mini-tag">✓ Approved by you</span>`;
 if(t.status==='done')return `<span class="mini-tag">✓ Completed autonomously</span>`;
 return '';
}
function renderInspector(){
 if(state.task && task(state.task)){
  const t=task(state.task),a=agent(t.agent),live=agentIsLive(a)&&!t.sample;
  const handoffTrail=(t.handoffs||[]).sort((x,y)=>new Date(x.created_at)-new Date(y.created_at));
  return `<div class="inspector-heading">ASSIGNMENT INSPECTOR <button class="panel-link" id="back-agent">AGENT ↗</button></div><div class="inspector-agent-card" style="--agent:${a.accent}"><div class="inspector-name-banner"><b>${safe(a.name)}</b><small>${safe(a.role)}</small></div><div class="inspector-portrait">${botPortrait(a)}</div><div class="agent-status-line"><span></span>${safe(statuses[t.status]||t.status)}${live?` · ${safe(providerLabel(a))}`:''}</div></div><div class="inspector-section"><div class="tiny-heading">CURRENT ASSIGNMENT</div><div class="inspector-job"><strong>${safe(t.title)}</strong><small>${safe(t.project)} · ${safe(t.created)}</small><div class="progress-steps">${Array.from({length:4},(_,i)=>`<div class="progress-step ${i<taskProgress(t.status)?'filled':''}"></div>`).join('')}</div></div></div>${handoffTrail.length?`<div class="inspector-section"><div class="tiny-heading">COLLABORATION TRAIL</div><div class="handoff-trail">${handoffTrail.map(h=>`<div><b>${safe(agent(h.from_agent_id).name)}</b><span>→</span><b>${safe(agent(h.to_agent_id).name)}</b><small>${safe(h.status)}</small></div>`).join('')}</div></div>`:''}${t.output||t.media?.length?`<div class="inspector-section"><div class="tiny-heading">DELIVERABLE PREVIEW ${live?'· LIVE':''}</div><div class="detail-card">${t.media?.length?`<div class="deliverable-media">${mediaPreview(t)}</div>`:''}${t.output?`<p>${safe(t.output)}</p>`:''}</div></div>`:''}<div class="inspector-section"><div class="tiny-heading">NEXT ACTION</div>${taskActions(t,a)}<button class="btn-ghost" id="delete-task" style="width:100%;margin-top:8px" ${t.status==='running'?'disabled':''}>Delete assignment</button><div class="inspector-note">${runtime.codex?`${a.name} runs through Codex${runtime.muse?' with a Muse collaborator pass':''}. Generated media appears here automatically; publishing and consequential external actions still need you.`:a.id==='creative'?'Creative is using the existing Eve fallback until Codex is configured.':'This agent profile is ready and activates when Codex is connected.'}</div></div>`;
 }
 const a=agent(state.agent),assigned=state.tasks.filter(t=>t.agent===a.id),live=agentIsLive(a);
 return `<div class="inspector-heading">AGENT INSPECTOR</div><div class="inspector-agent-card" style="--agent:${a.accent}"><div class="inspector-name-banner"><b>${safe(a.name)}</b><small>${safe(a.role)}</small></div><div class="inspector-portrait">${botPortrait(a)}</div><div class="agent-status-line"><span style="background:${live?'#8be6c8':'#e1b987'}"></span> ${live?'Available':'Ready to connect'} · ${safe(providerLabel(a))}</div></div><div class="inspector-section"><div class="tiny-heading">WHAT THIS AGENT DOES</div><p style="color:#9ab0bc;font-size:11px;line-height:1.7">${safe(a.specialty)}</p></div><div class="inspector-section"><div class="tiny-heading">ASSIGNMENTS (${assigned.length})</div>${assigned.map(t=>`<div class="task-item" data-task="${safe(t.id)}"><div class="task-text"><strong>${safe(t.title)}</strong><span>${safe(statuses[t.status]||t.status)}</span></div></div>`).join('')||'<p class="inspector-note">No tasks assigned yet.</p>'}<button class="btn-outline" id="assign-selected">＋ Assign ${a.name} a task</button></div><div class="inspector-section"><div class="tiny-heading">RUNTIME</div><div class="runtime-stack"><span class="runtime-pill ${runtime.codex?'on':''}">Codex ${runtime.codex?'connected':'ready'}</span><span class="runtime-pill ${runtime.muse?'on':''}">Muse ${runtime.muse?'connected':'optional'}</span><span class="runtime-pill ${runtime.studio?'on':''}">Movie DB ${runtime.studio?'connected':'ready'}</span></div><button class="btn-ghost" id="connections-inspector" style="width:100%;margin-top:10px">Manage connections</button></div><div class="inspector-note">${runtime.codex?'This identity runs through the managed Codex harness.':'The identity and prompts are built. Add the server key to make it a real Codex session.'}</div>`;
}
function applyAgentActivities(){const floor=FLOORS[state.floor];floor?.bots.forEach(id=>{const status=agentWork(id,floor.name).status;window.NyoniHQ3D?.setAgentActivity?.(id,status==='review'?'review':status==='running'?'running':['approved','done'].includes(status)?'complete':'idle')})}
function mountCurrentHQ(){if(state.page==='hq'){const floor=FLOORS[state.floor];requestAnimationFrame(()=>{window.NyoniHQ3D?.mountHQ3D({floorSlug:floor.slug,selectedAgent:state.agent,agentIds:floor.bots});setTimeout(applyAgentActivities,800)})}}
function updateHQAgentCard(id){const selected=agent(id),card=$('.world-agent');if(!card)return;card.style.setProperty('--agent',selected.accent);card.innerHTML=`<div class="world-agent-portrait">${botPortrait(selected)}</div><div><span>NOW INSPECTING</span><strong>${selected.name}</strong><small>${safe(selected.role)}</small></div><button data-page="agents" aria-label="Open all agents">↗</button>`}
function render(){
 const meta={hq:['The studio is alive','A tiny world for the big things we’re building.'],agents:['Meet the agents','Every great studio needs a great crew.'],tasks:['Assignment board','Make the work visible, one assignment at a time.'],ideas:['Where ideas begin','Save the spark before it disappears.'],outputs:['Delivered work','Review, revise, and approve in one place.']}[state.page];
 window.NyoniHQ3D?.unmountHQ3D();
 document.body.classList.toggle('page-hq',state.page==='hq');
 $('#page-heading').innerHTML=safe(meta[0])+'<span class="tiny-star">✳</span>';
 $('#page-subtitle').textContent=meta[1];
 $('#breadcrumb-current').textContent=state.page.toUpperCase();
 $('#page-content').innerHTML=({hq:renderHQ,agents:renderAgents,tasks:renderTasks,ideas:renderIdeas,outputs:renderOutputs}[state.page])();
 $('#inspector').innerHTML=renderInspector();
 $('#sidebar-task-count').textContent=state.tasks.length;
 document.querySelectorAll('.nav-item').forEach(el=>el.classList.toggle('active',el.dataset.page===state.page));
 updateRuntimeChrome();
 store();
 mountCurrentHQ();
}
function toast(message){const el=document.createElement('div');el.className='toast';el.textContent=message;$('#toast-root').replaceChildren(el);setTimeout(()=>el.remove(),3200)}
function modal(html){$('#modal-root').innerHTML=`<div class="modal-backdrop"><div class="modal-card" role="dialog" aria-modal="true">${html}</div></div>`;$('#modal-root').querySelector('.modal-backdrop').addEventListener('click',e=>{if(e.target===e.currentTarget)closeModal()});$('#modal-root').querySelectorAll('.modal-close').forEach(el=>el.addEventListener('click',closeModal));}
function closeModal(){$('#modal-root').innerHTML=''}
function assignModal(prefill=''){const a=agent(state.agent);modal(`<div class="modal-top"><h2>New assignment</h2><button class="modal-close" aria-label="Close">×</button></div><div class="modal-description">Give any Nyoni agent a mission. Media specialists plan the job, call the right Nyoni Studio generator, and return the result here.</div><form id="task-form"><label class="field-label" for="task-title">WHAT NEEDS TO GET DONE?</label><textarea id="task-title" class="form-field textarea" name="title" maxlength="1000" required placeholder="Example: Create a cinematic vertical launch video for Nyoni">${safe(prefill)}</textarea><label class="field-label" for="task-agent">ASSIGN TO</label><select class="form-field" id="task-agent" name="agent">${AGENTS.map(x=>`<option value="${x.id}" ${x.id===a.id?'selected':''}>${x.name} — ${x.role} · ${providerLabel(x)}</option>`).join('')}</select><label class="field-label" for="task-project">PROJECT / DEPARTMENT</label><select class="form-field" id="task-project" name="project">${FLOORS.map(x=>`<option ${x.name===FLOORS[a.floor]?.name?'selected':''}>${x.name}</option>`).join('')}</select><label class="field-label" for="task-source">SOURCE IMAGE OR VIDEO URL · REQUIRED FOR REFRAME, KINETIC & CUTLINE</label><input class="form-field" id="task-source" name="sourceUrl" type="url" placeholder="https://…"/><div class="submit-row"><button type="button" class="modal-close">Cancel</button><button class="primary" type="submit">Start assignment</button></div></form><p class="fineprint">Bounded internal generation runs automatically. Publishing, outreach, deletion, account changes, contracts, and money movement still require approval.</p>`);$('#task-title').focus()}
function connectionsModal(){
 modal(`<div class="modal-top"><h2>Agent connections</h2><button class="modal-close" aria-label="Close">×</button></div><p class="modal-description">Codex runs the crew, Supabase holds shared memory, and connected media providers support production work. Consequential external actions remain approval-gated.</p><div class="connection-grid"><div class="connection-card ${runtime.codex?'connected':''}"><span>PRIMARY RUNTIME</span><b>OpenAI Codex</b><small>${runtime.codex?`Connected · ${safe(runtime.codexModel)} · ${safe(runtime.reasoningEffort)} reasoning`:'Needs OPENAI_API_KEY'}</small></div><div class="connection-card ${runtime.studio?'connected':''}"><span>SHARED MEMORY</span><b>Supabase Studio DB</b><small>${runtime.studio?'Connected · durable assignments':'Needs Supabase server variables'}</small></div><div class="connection-card ${runtime.elevenLabs?'connected':''}"><span>VOICE</span><b>ElevenLabs</b><small>${runtime.elevenLabs?'Connected server-side':'Needs ELEVENLABS_API_KEY'}</small></div><div class="connection-card ${runtime.kie?'connected':''}"><span>MEDIA</span><b>KIE</b><small>${runtime.kie?'Connected server-side':'Needs KIE_API_KEY'}</small></div><div class="connection-card ${runtime.waveSpeed?'connected':''}"><span>MEDIA</span><b>WaveSpeed</b><small>${runtime.waveSpeed?'Connected server-side':'Needs WAVESPEED_API_KEY'}</small></div><div class="connection-card ${runtime.stripe?'connected':''}"><span>FINANCE · READ ONLY</span><b>Stripe</b><small>${runtime.stripe?'Restricted connection active':'Needs STRIPE_RESTRICTED_KEY'}</small></div></div><div class="info-banner"><b>Cost and autonomy guards active</b><br/>Internal research, drafting, analysis, QA, and handoffs run automatically. Publishing, outreach, account changes, contracts, deletion, and money movement require approval.</div><form id="access-form"><label class="field-label" for="studio-passcode">STUDIO PASSCODE ${hasStudioPasscode()?'· SAVED FOR THIS TAB':''}</label><input class="form-field" id="studio-passcode" name="passcode" type="password" autocomplete="current-password" placeholder="Required for protected commands and approvals"/><div class="submit-row"><button type="button" class="modal-close">Close</button><button class="primary" type="submit">Save passcode</button></div></form>`);
}
function agentConsoleModal(agentId){
 const a=agent(agentId),assigned=state.tasks.filter(t=>t.agent===a.id).slice(0,5),floor=FLOORS.find(item=>item.bots.includes(a.id))||FLOORS[state.floor];
 state.agent=a.id;
 const needsSource=['reframe','kinetic','cutline'].includes(a.id),acceptsSource=needsSource||a.id==='rally';
 modal(`<div class="agent-console" style="--agent:${a.accent}"><div class="modal-top"><div class="console-identity"><span>${a.icon}</span><div><small>LIVE AGENT</small><h2>${safe(a.name)}</h2><p>${safe(a.role)}</p></div></div><button class="modal-close" aria-label="Close">×</button></div><p class="console-specialty">${safe(a.specialty)}</p><div class="console-work">${assigned.map(t=>`<div><i class="${safe(t.status)}"></i><span><b>${safe(statuses[t.status]||t.status)}</b>${safe(t.title)}</span>${t.status==='review'?`<button data-quick-approve="${safe(t.id)}">Approve</button>`:''}</div>`).join('')||'<p>No assignments yet. Give this agent a mission below.</p>'}</div><form id="agent-command-form"><input type="hidden" name="agent" value="${a.id}"/><input type="hidden" name="project" value="${safe(floor.name)}"/><label for="agent-command">TALK TO ${safe(a.name).toUpperCase()}</label><textarea id="agent-command" name="title" required maxlength="1000" placeholder="Tell ${safe(a.name)} what outcome you want…"></textarea>${acceptsSource?`<label for="agent-source">SOURCE ${needsSource?'REQUIRED':'OPTIONAL'}</label><input class="form-field" id="agent-source" name="sourceUrl" type="url" ${needsSource?'required':''} placeholder="Public image or video URL"/>`:''}<div class="console-submit"><span>Runs durably in the background</span><button type="submit">Start mission ↗</button></div></form></div>`);
 setTimeout(()=>$('#agent-command')?.focus(),0);
}
function previewText(t){const a=agent(t.agent),q=t.title;const formats={scout:`DEMO RESEARCH OUTLINE — ${q}\n1. Define target audience and geography.\n2. Collect evidence from trusted industry and business sources.\n3. Compare key opportunities, gaps, and risks.\n4. Prepare a cited report for MIGO review.\nNO LIVE RESEARCH WAS PERFORMED.`,creative:`DEMO CAMPAIGN DIRECTION — ${q}\nConcept: “Make the moment unforgettable.”\nVisuals: tactile cinematic close-ups, strong natural lighting, and an unexpected reveal.\nDeliverables: 3 stills, one 9:16 short video creative brief, ad caption and CTA.\nNO AI MODEL WAS CALLED.`,story:`DEMO SCRIPT PLAN — ${q}\nOpening: establish stakes through a visual action, not exposition.\nMiddle: set up a character disagreement with a specific consequence.\nClosing: reveal a new complication that motivates the next scene.\nNO AI MODEL WAS CALLED.`,hunter:`DEMO CLIENT OUTREACH PLAN — ${q}\nChoose target category and region; validate business details; review recent creative output; draft a specific, non-spammy proposal; request human approval before outreach.\nNO PROSPECTS WERE LOOKED UP OR CONTACTED.`,pulse:`DEMO ANALYTICS CHECKLIST — ${q}\nTrack publishing cadence, reach, saves, CTR, qualified inquiries, conversion rate and client retention. Separate verified source data from estimates.\nNO LIVE METRICS WERE READ.`,motion:`DEMO PRODUCTION PLAN — ${q}\nShot 1: angled establishing, 24fps, intentional asymmetry.\nShot 2: motivated camera move and facial reaction.\nShot 3: clean product or story reveal.\nProduction notes: continuity, staging, materials, lighting, physics.\nNO VIDEO WAS GENERATED.`,vault:`DEMO IDEA BRIEF — ${q}\nCore hook: one clear visual twist in the opening seconds.\nDifferentiate: lean into Nyoni's distinctive storytelling rather than copying a trend.\nTest: three concept variants, scored for feasibility and originality.\nNO AI MODEL WAS CALLED.`,migo:`DEMO MISSION BRIEF — ${q}\n1. Clarify outcome and constraints.\n2. Assign the relevant specialist.\n3. Establish review checkpoints.\n4. Require approval before publication, outreach or spend.\nNO AGENTS WERE ACTUALLY DELEGATED.`};return formats[a.id]||formats.migo}
async function previewTask(){
 const t=task(state.task);if(!t||t.status==='running')return;
 if(!runtime.codex&&!(t.agent==='creative'&&runtime.eve)){
  connectionsModal();toast('Connect Codex to activate this agent');return;
 }
 const a=agent(t.agent);
 t.status='running';t.runPhase=`Connecting to ${a.name}`;t.error='';t.sample=false;store();render();
 window.NyoniHQ3D?.setAgentActivity?.(a.id,'running');
 let lastPhase='';
 try{
  const runner=runtime.codex?runCodexAssignment:runCreativeAssignment;
  const result=await runner(t,(phase)=>{
   if(!phase||phase===lastPhase)return;
   lastPhase=phase;t.runPhase=phase;store();
   const label=$('#agent-run-status');if(label)label.textContent=phase;
  });
  t.output=result.output;t.sessionId=result.sessionId;t.providers=result.providers||{eve:true};t.status='review';t.runPhase='';t.error='';
  log(`${a.name} completed a live deliverable for review: ${t.title}`);toast(`${a.name} deliverable ready for your approval`);
 }catch(error){
  console.error(`${a.name} agent run failed`,error);t.status='failed';t.runPhase='';t.error=error?.message||`${a.name} could not complete the assignment.`;
  log(`${a.name} run failed: ${t.title}`);toast(`${a.name} could not finish — open the assignment to retry`);
 }finally{
  window.NyoniHQ3D?.setAgentActivity?.(a.id,'idle');store();render();
 }
}
function nav(page){state.page=page;state.task=null;render()}
function pickAgent(id){state.agent=id;state.task=null;render()}
function pickTask(id){state.task=id;render()}
document.addEventListener('click',e=>{
 const p=e.target.closest('[data-page]');if(p){nav(p.dataset.page);return;}
 const f=e.target.closest('[data-floor]');if(f){state.floor=Number(f.dataset.floor);state.agent=FLOORS[state.floor].bots[0];state.task=null;render();return;}
 const consoleButton=e.target.closest('[data-agent-console]');if(consoleButton){agentConsoleModal(consoleButton.dataset.agentConsole);return;}
 const quickApprove=e.target.closest('[data-quick-approve]');if(quickApprove){const assignmentId=quickApprove.dataset.quickApprove;void updateStudioAssignment(assignmentId,'approve').then(()=>{closeModal();return syncRemoteAssignments({quiet:false})}).catch(error=>toast(error.message));return;}
 const b=e.target.closest('[data-agent]');if(b){pickAgent(b.dataset.agent);return;}
 const t=e.target.closest('[data-task]');if(t){pickTask(t.dataset.task);return;}
 const ia=e.target.closest('[data-idea-assign]');if(ia){const idea=state.ideas.find(i=>i.id===ia.dataset.ideaAssign);if(idea)assignModal(idea.title);return;}
 const id=e.target.closest('button')?.id;
 if(['new-task-top','new-task-top-dock','new-task-command','new-task-mobile','add-task-inline','assign-selected'].includes(id)){assignModal();return;}
 if(['connections-btn','connections-top','connections-inline','connections-inspector'].includes(id)){connectionsModal();return;}
 if(id==='back-agent'){state.task=null;render()}
 if(id==='preview-task'){void previewTask()}
 if(id==='sync-task'){void syncRemoteAssignments({quiet:false})}
 if(id==='approve-task'){const t=task(state.task);if(t){if(t.remote){void updateStudioAssignment(t.id,'approve').then(()=>syncRemoteAssignments({quiet:false})).catch(e=>toast(e.message));}else{t.status='approved';log(`Output approved: ${t.title}`);render();toast('Approved by you')}}}
 if(id==='reject-task'){const t=task(state.task);if(t){if(t.remote){void updateStudioAssignment(t.id,'reject').then(()=>syncRemoteAssignments({quiet:false})).catch(e=>toast(e.message));}else{t.status='rejected';log(`Revision requested: ${t.title}`);render();toast('Marked for revision')}}}
 if(id==='delete-task'){const t=task(state.task);if(t&&t.status!=='running'){if(t.remote){void updateStudioAssignment(t.id,'cancel').then(()=>syncRemoteAssignments({quiet:false})).catch(e=>toast(e.message));}else{state.tasks=state.tasks.filter(x=>x.id!==t.id);state.task=null;log(`Assignment deleted: ${t.title}`);render();toast('Assignment deleted')}}}
 if(id==='help-btn'){modal(`<div class="modal-top"><h2>About Nyoni HQ</h2><button class="modal-close">×</button></div><p class="modal-description">NYONI HQ is an eleven-floor 3D operating system with 20 persistent agents across creative, finance, photo, video, audio and campaign production.</p><div class="info-banner"><b>Approvals are reserved for consequential actions.</b> Internal planning and bounded media generation run automatically. Publishing, outreach, deletion, account changes, contracts, and money movement still require you.</div><p class="fineprint">Click a 3D bot or its live work bubble to see its current work, start a mission and review generated media from the front screen.</p><div class="submit-row"><button class="modal-close">Got it</button></div>`);}
});
window.addEventListener('nyoni-agent-select',event=>{const id=event.detail?.id;if(!id||!AGENTS.some(item=>item.id===id))return;state.agent=id;state.task=null;store();updateHQAgentCard(id)});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();if((e.key==='Enter'||e.key===' ')&&e.target.matches('.bot-hit,[role="button"][data-task]')){e.preventDefault();e.target.dispatchEvent(new MouseEvent('click',{bubbles:true}))}});
document.addEventListener('submit',e=>{
 if(e.target.id==='agent-command-form'){e.preventDefault();const form=new FormData(e.target),title=String(form.get('title')||'').trim();if(!title)return;const draft={title,agent:String(form.get('agent')),project:String(form.get('project')),sourceUrl:String(form.get('sourceUrl')||'').trim(),status:'queued',created:now(),output:'',media:[],sample:false};if(!hasStudioPasscode()){connectionsModal();toast('Save the studio passcode once to start autonomous work');return;}const button=e.target.querySelector('button[type="submit"]');button.disabled=true;button.textContent='Starting…';void createStudioAssignment(draft).then(row=>{const saved=remoteTask(row);state.tasks.unshift(saved);closeModal();render();toast(`${agent(saved.agent).name} is working`);setTimeout(()=>syncRemoteAssignments(),2000)}).catch(error=>{button.disabled=false;button.textContent='Start mission ↗';toast(error.message)});return;}
 if(e.target.id==='task-form'){e.preventDefault();const form=new FormData(e.target);const title=String(form.get('title')||'').trim();if(!title)return;const t={id:'task-'+Date.now()+'-'+Math.floor(Math.random()*1e6),title,agent:String(form.get('agent')),project:String(form.get('project')),sourceUrl:String(form.get('sourceUrl')||'').trim(),status:'queued',created:now(),output:'',sample:false};
  if(runtime.studio&&runtime.codex){
   if(!hasStudioPasscode()){connectionsModal();toast('Save the studio passcode once to start autonomous assignments');return;}
   const button=e.target.querySelector('[type="submit"]');button.disabled=true;button.textContent='Starting durable run…';
   void createStudioAssignment(t).then(row=>{const saved=remoteTask(row);state.tasks.unshift(saved);state.agent=saved.agent;state.task=saved.id;log(`Durable assignment started for ${agent(saved.agent).name}`);closeModal();render();toast('Assignment started — it will continue if you close HQ');setTimeout(()=>syncRemoteAssignments(),2500)}).catch(error=>{button.disabled=false;button.textContent='Add assignment';toast(error.message)});return;
  }
  state.tasks.unshift(t);state.agent=t.agent;state.task=t.id;log(`Assignment created for ${agent(t.agent).name}`);closeModal();render();toast('Assignment added to local queue')}
 if(e.target.id==='idea-form'){e.preventDefault();const input=e.target.querySelector('input');const title=input.value.trim();if(!title)return;state.ideas.unshift({id:'idea-'+Date.now(),title,description:'Ready for development.',sample:false});log('New idea saved in vault');render();toast('Idea saved locally')}
 if(e.target.id==='access-form'){e.preventDefault();const form=new FormData(e.target);saveStudioPasscode(form.get('passcode'));closeModal();toast('Studio passcode saved for this browser tab')}
});
$('#brand-link').addEventListener('click',e=>{e.preventDefault();nav('hq')});
render();
getAgentRuntimeStatus({refresh:true}).then((status)=>{runtime={loading:false,...status};render();void syncRemoteAssignments();setInterval(()=>syncRemoteAssignments(),8000);}).catch((error)=>{console.warn('Agent runtime status unavailable',error);runtime={...runtime,loading:false};updateRuntimeChrome();});
import('./hq-3d.js').then(mountCurrentHQ).catch(error=>{console.error('Could not start Nyoni HQ 3D',error);const host=$('#hq-3d-stage');host?.classList.add('has-error');const status=host?.querySelector('[data-3d-status]');if(status)status.textContent=`3D module error: ${error?.message||'unknown error'}`});
