/* Nyoni HQ v0.6 — interactive 3D studio with Codex + Muse agent bridges. */
import { runCreativeAssignment } from './creative-agent.js';
import { getAgentRuntimeStatus, hasStudioPasscode, runCodexAssignment, saveStudioPasscode } from './nyoni-agent.js';
const AGENTS = [
  {id:'migo', name:'MIGO', role:'Studio Director', floor:3, accent:'#b8eadb', specialty:'Coordinates projects, triages tasks and queues approvals.', icon:'✦'},
  {id:'scout', name:'Scout', role:'Research & Discovery', floor:0, accent:'#9bdcb2', specialty:'Research briefs, trends, competitor scans and market intelligence.', icon:'⌕'},
  {id:'creative', name:'Creative', role:'Art Director', floor:0, accent:'#d7b1f0', specialty:'Ad directions, campaign concepts and creative briefs.', icon:'✳'},
  {id:'hunter', name:'Hunter', role:'Client Acquisition', floor:0, accent:'#e49a55', specialty:'Prospect lists and personalized outreach drafts, pending review.', icon:'↗'},
  {id:'pulse', name:'Pulse', role:'Analytics', floor:0, accent:'#69aee8', specialty:'Performance analysis and client-friendly reports.', icon:'▥'},
  {id:'story', name:'Story', role:'Screenwriting', floor:1, accent:'#f1b5ae', specialty:'Script outlines, dialogue, character and continuity notes.', icon:'✎'},
  {id:'motion', name:'Motion', role:'Production Designer', floor:1, accent:'#9dc4fb', specialty:'Shot design, storyboards, Seedance-ready production prompts.', icon:'▣'},
  {id:'vault', name:'Vault', role:'Ideas & Experiments', floor:2, accent:'#eedb92', specialty:'Concept discovery, categorization, idea development and backlog.', icon:'◇'},
];
const FLOORS = [
  {name:'Commercials',slug:'commercials',poster:'commercials_poster.png',label:'NYONI COMMERCIALS',code:'01',color:'#9fe3c8',desc:'Client work · Campaigns · Research · Outreach',bots:['scout','creative','hunter','pulse']},
  {name:'Entertainment',slug:'entertainment',poster:'entertainment_isometric.png',label:'NYONI ENTERTAINMENT',code:'02',color:'#b3bafb',desc:'Colony Zero · Palava 231 · SANKOFI',bots:['story','motion','creative']},
  {name:'Research Lab',slug:'research_lab',poster:'research_lab_isometric.png',label:'RESEARCH & IDEAS',code:'03',color:'#e8d29e',desc:'Trend discovery · Experiments · Idea vault',bots:['vault','scout']},
  {name:'Mission Control',slug:'mission_control',poster:'mission_control_isometric.png',label:'MISSION CONTROL',code:'04',color:'#c2d4e4',desc:'Executive operations · Assignment routing · Approvals',bots:['migo']}
];
const SEED_TASKS=[
  {id:'sample-01',title:'Research local business advertising opportunities',agent:'scout',project:'Nyoni Commercials',status:'queued',created:'Sample assignment',output:'',sample:true},
  {id:'sample-02',title:'Develop a concept for a birthday campaign',agent:'creative',project:'Nyoni Commercials',status:'review',created:'Sample assignment',output:'DEMO CONCEPT — “The Moment Before the Surprise”\nOpening: a darkened room, a subtle glow under a door.\nReveal: confetti and a fully styled celebration setup.\nFormat: 9:16 vertical ad, 10–15 seconds.\nThis is illustrative sample content, not AI-generated.',sample:true},
  {id:'sample-03',title:'Outline Palava 231 production beats',agent:'story',project:'Palava 231',status:'queued',created:'Sample assignment',output:'',sample:true}
];
const KEY='nyoni-hq-v01';
const blankState=()=>({page:'hq',floor:0,agent:'scout',task:null,tasks:structuredClone(SEED_TASKS),ideas:[{id:'idea-sample',title:'Commercial campaign: event transformation',description:'Before-and-after event setup concept with one continuous camera transition.',sample:true},{id:'idea-sample2',title:'SANKOFI 3D character style trials',description:'Explore material and lighting variations for the sculptural mythic look.',sample:true}],events:[{message:'Prototype workspace opened',time:'Local demo'},{message:'Three sample assignments loaded',time:'Sample data'}]});
let state=blankState();
let runtime={loading:true,codex:false,muse:false,studio:false,eve:true,protected:true,codexModel:'gpt-6-astra',museModel:'muse-spark-1.3'};
try {const saved=JSON.parse(localStorage.getItem(KEY)); if(saved && Array.isArray(saved.tasks)&&Array.isArray(saved.ideas)){state={...state,...saved,page:'hq'};}}catch{}
state.tasks.forEach(t=>{if(t.status==='running'){t.status='failed';t.error='The previous live run was interrupted. Retry when the Creative runtime is available.';t.runPhase='';}});
const $=s=>document.querySelector(s);
const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const agent=id=>AGENTS.find(a=>a.id===id)||AGENTS[0];
const task=id=>state.tasks.find(t=>t.id===id);
const now=()=>new Date().toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
function store(){try{localStorage.setItem(KEY,JSON.stringify({floor:state.floor,agent:state.agent,tasks:state.tasks,ideas:state.ideas,events:state.events}));}catch{}}
function log(message){state.events.unshift({message,time:now()});state.events=state.events.slice(0,15);store();}
const statuses={queued:'Queued',running:'Working live',review:'Needs approval',approved:'Approved',rejected:'Changes requested',failed:'Run failed'};
function runtimeLabel(){
 if(runtime.loading)return 'CHECKING';
 if(runtime.codex&&runtime.muse)return 'CODEX + MUSE';
 if(runtime.codex)return 'CODEX LIVE';
 return 'CODEX READY';
}
function agentIsLive(a){return Boolean(runtime.codex||(a.id==='creative'&&runtime.eve))}
function providerLabel(a){
 if(runtime.codex)return runtime.muse?'CODEX · MUSE':'CODEX';
 if(a.id==='creative'&&runtime.eve)return 'EVE LIVE';
 return 'CODEX READY';
}
function updateRuntimeChrome(){
 const title=$('#runtime-title'),detail=$('#runtime-detail'),mode=$('#runtime-mode');
 if(title)title.textContent=runtime.codex?(runtime.muse?'Codex + Muse connected':'Codex connected'):'Codex keys needed';
 if(detail)detail.textContent=runtime.codex?`8 live agents · Muse ${runtime.muse?'on':'off'}`:runtime.eve?'Creative fallback live · 7 ready':'8 Codex profiles ready · keys needed';
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
 const spots={1:[[275,260],[460,240],[532,320],[290,362]],2:[[280,274],[480,292],[389,374]],3:[[303,285],[483,306]],4:[[407,312]]}[state.floor+1];
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
function renderHQ(){const floor=FLOORS[state.floor],selected=agent(state.agent);const city=[
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
    <p>Move through four creative floors. Step into a room, meet the crew, and turn an idea into an assignment.</p>
    <button class="world-primary" data-page="tasks">Enter the task board <span>↗</span></button>
  </div>
  <div class="world-stage" aria-label="Interactive Nyoni studio floor">
    <div class="stage-halo"></div>
    ${stageMarkup}
    <div class="stage-caption"><span class="live-pulse"></span>REAL-TIME 3D · drag, zoom, click a bot</div>
  </div>
  <aside class="world-directory" aria-label="Studio floor directory">
    <div class="directory-top"><div><small>STUDIO DIRECTORY</small><strong>Choose a floor</strong></div><span>${floor.code} / 04</span></div>
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
function renderAgents(){return `<div class="wide-panel"><div class="panel-header"><div><div class="wide-title">Meet the crew</div><p class="fineprint">Every identity has a Codex harness profile and an optional Muse collaborator. Connections turn on server-side when their keys are configured.</p></div><button class="panel-link" id="connections-inline">Connections ↗</button></div><div class="agent-grid">${AGENTS.map(a=>`<button class="agent-grid-card" data-agent="${a.id}" style="--agent:${a.accent}"><span class="agent-name-banner"><b>${safe(a.name)}</b><small>${safe(a.role)}</small></span>${botPortrait(a)}<span class="agent-provider ${agentIsLive(a)?'is-live':''}">${safe(providerLabel(a))}</span><span class="mini-tag">${state.tasks.filter(t=>t.agent===a.id).length} assignments</span></button>`).join('')}</div></div>`}
function renderTasks(){return `<div class="wide-panel"><div class="panel-header"><span class="wide-title">All assignments</span><button class="panel-link" id="add-task-inline">＋ New assignment</button></div><p class="fineprint">${runtime.codex?'All eight agents run through the managed Codex harness. Muse joins every run when connected.':'Creative keeps its existing live fallback. The full Codex + Muse crew activates when the server keys are connected.'}</p><div style="overflow-x:auto"><table class="full-task-table"><thead><tr><th>ASSIGNMENT</th><th>AGENT</th><th>RUNTIME</th><th>PROJECT</th><th>STATUS</th><th></th></tr></thead><tbody>${state.tasks.map(t=>{const a=agent(t.agent);return `<tr><td>${safe(t.title)}${t.sample?' <span class="mini-tag">SAMPLE</span>':''}</td><td>${safe(a.name)}</td><td><span class="mini-tag">${safe(providerLabel(a))}</span></td><td>${safe(t.project)}</td><td>${safe(statuses[t.status]||t.status)}</td><td><button class="task-open" data-task="${safe(t.id)}">Open ↗</button></td></tr>`}).join('')}</tbody></table></div></div>`}
function renderIdeas(){return `<div class="wide-panel"><div class="wide-title">The Idea Vault</div><p class="fineprint">Drop concepts here, then assign one to an agent from the task board. Stored locally in this browser.</p><form class="idea-form" id="idea-form"><input type="text" name="idea" maxlength="140" placeholder="A concept worth exploring..." required aria-label="New idea title"/><button type="submit">Save idea</button></form></div><div class="wide-panel"><div class="panel-header"><span class="panel-title">Saved concepts</span><span class="mini-tag">${state.ideas.length} entries</span></div>${state.ideas.map(i=>`<div class="idea-entry"><span class="meta">${i.sample?'EXAMPLE IDEA':'YOUR IDEA'}</span><h3>${safe(i.title)}</h3><p>${safe(i.description||'Ready to develop into an assignment.')}</p><button class="panel-link" data-idea-assign="${safe(i.id)}" style="margin-top:9px">Assign to agent ↗</button></div>`).join('')}</div>`}
function renderOutputs(){const outputs=state.tasks.filter(t=>t.output);return `<div class="wide-panel"><div class="wide-title">Deliverables & approvals</div><p class="fineprint">Every live deliverable records its runtime and still requires your approval. Nothing is automatically posted, sent, purchased, or published.</p>${outputs.length?outputs.map(t=>`<div class="detail-card"><span class="mini-tag">${safe(statuses[t.status])} · ${safe((t.providers?.muse?'CODEX + MUSE':t.providers?.codex?'CODEX':t.agent==='creative'&&!t.sample?'EVE LIVE':'SAMPLE'))}</span><b style="margin-top:9px">${safe(t.title)}</b><p>${safe(t.output)}</p><div class="detail-actions"><button class="btn-ghost" data-task="${safe(t.id)}">Review assignment ↗</button></div></div>`).join(''):'<div class="empty-state">Outputs will show here after an agent finishes an assignment.</div>'}</div>`}
function taskProgress(status){return {queued:1,rejected:1,failed:1,running:2,review:3,approved:4}[status]||1}
function taskActions(t,a){
 if(t.status==='running')return `<button class="btn-outline agent-running" type="button" disabled><span class="run-pulse"></span><span id="agent-run-status">${safe(t.runPhase||'Creative is working')}</span></button>`;
 if(['queued','rejected','failed'].includes(t.status))return `<button class="btn-outline" id="preview-task">✧ ${runtime.codex?`Run ${a.name} in Codex${runtime.muse?' + Muse':''}`:a.id==='creative'?'Run Creative fallback live':'Connect Codex to activate'}</button>${t.error?`<p class="run-error">${safe(t.error)}</p>`:''}`;
 if(t.status==='review')return `<button class="btn-outline" id="approve-task">✓ Approve live deliverable</button><button class="btn-ghost" style="width:100%;margin-top:8px" id="reject-task">Request changes</button>`;
 if(t.status==='approved')return `<span class="mini-tag">✓ Approved by you</span>`;
 return '';
}
function renderInspector(){
 if(state.task && task(state.task)){
  const t=task(state.task),a=agent(t.agent),live=agentIsLive(a)&&!t.sample;
  return `<div class="inspector-heading">ASSIGNMENT INSPECTOR <button class="panel-link" id="back-agent">AGENT ↗</button></div><div class="inspector-agent-card" style="--agent:${a.accent}"><div class="inspector-name-banner"><b>${safe(a.name)}</b><small>${safe(a.role)}</small></div><div class="inspector-portrait">${botPortrait(a)}</div><div class="agent-status-line"><span></span>${safe(statuses[t.status]||t.status)}${live?` · ${safe(providerLabel(a))}`:''}</div></div><div class="inspector-section"><div class="tiny-heading">CURRENT ASSIGNMENT</div><div class="inspector-job"><strong>${safe(t.title)}</strong><small>${safe(t.project)} · ${safe(t.created)}</small><div class="progress-steps">${Array.from({length:4},(_,i)=>`<div class="progress-step ${i<taskProgress(t.status)?'filled':''}"></div>`).join('')}</div></div></div>${t.output?`<div class="inspector-section"><div class="tiny-heading">DELIVERABLE PREVIEW ${live?'· LIVE':''}</div><div class="detail-card"><p>${safe(t.output)}</p></div></div>`:''}<div class="inspector-section"><div class="tiny-heading">NEXT ACTION</div>${taskActions(t,a)}<button class="btn-ghost" id="delete-task" style="width:100%;margin-top:8px" ${t.status==='running'?'disabled':''}>Delete assignment</button><div class="inspector-note">${runtime.codex?`${a.name} runs through Codex${runtime.muse?' with a Muse collaborator pass':''}. You still control approval.`:a.id==='creative'?'Creative is using the existing Eve fallback until Codex is configured.':'This agent profile is ready and activates when Codex is connected.'} Nothing is sent or published automatically.</div></div>`;
 }
 const a=agent(state.agent),assigned=state.tasks.filter(t=>t.agent===a.id),live=agentIsLive(a);
 return `<div class="inspector-heading">AGENT INSPECTOR</div><div class="inspector-agent-card" style="--agent:${a.accent}"><div class="inspector-name-banner"><b>${safe(a.name)}</b><small>${safe(a.role)}</small></div><div class="inspector-portrait">${botPortrait(a)}</div><div class="agent-status-line"><span style="background:${live?'#8be6c8':'#e1b987'}"></span> ${live?'Available':'Ready to connect'} · ${safe(providerLabel(a))}</div></div><div class="inspector-section"><div class="tiny-heading">WHAT THIS AGENT DOES</div><p style="color:#9ab0bc;font-size:11px;line-height:1.7">${safe(a.specialty)}</p></div><div class="inspector-section"><div class="tiny-heading">ASSIGNMENTS (${assigned.length})</div>${assigned.map(t=>`<div class="task-item" data-task="${safe(t.id)}"><div class="task-text"><strong>${safe(t.title)}</strong><span>${safe(statuses[t.status]||t.status)}</span></div></div>`).join('')||'<p class="inspector-note">No tasks assigned yet.</p>'}<button class="btn-outline" id="assign-selected">＋ Assign ${a.name} a task</button></div><div class="inspector-section"><div class="tiny-heading">RUNTIME</div><div class="runtime-stack"><span class="runtime-pill ${runtime.codex?'on':''}">Codex ${runtime.codex?'connected':'ready'}</span><span class="runtime-pill ${runtime.muse?'on':''}">Muse ${runtime.muse?'connected':'optional'}</span><span class="runtime-pill ${runtime.studio?'on':''}">Movie DB ${runtime.studio?'connected':'ready'}</span></div><button class="btn-ghost" id="connections-inspector" style="width:100%;margin-top:10px">Manage connections</button></div><div class="inspector-note">${runtime.codex?'This identity runs through the managed Codex harness.':'The identity and prompts are built. Add the server key to make it a real Codex session.'}</div>`;
}
function mountCurrentHQ(){if(state.page==='hq'){const floor=FLOORS[state.floor];requestAnimationFrame(()=>window.NyoniHQ3D?.mountHQ3D({floorSlug:floor.slug,selectedAgent:state.agent}))}}
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
function assignModal(prefill=''){const a=agent(state.agent);modal(`<div class="modal-top"><h2>New assignment</h2><button class="modal-close" aria-label="Close">×</button></div><div class="modal-description">Give any Nyoni agent a job. ${runtime.codex?'The crew runs through Codex'+(runtime.muse?' with Muse collaboration.':'.'):'Creative has a live fallback; the full crew activates when Codex is connected.'}</div><form id="task-form"><label class="field-label" for="task-title">WHAT NEEDS TO GET DONE?</label><textarea id="task-title" class="form-field textarea" name="title" maxlength="1000" required placeholder="Example: Build three creative directions for a local birthday campaign">${safe(prefill)}</textarea><label class="field-label" for="task-agent">ASSIGN TO</label><select class="form-field" id="task-agent" name="agent">${AGENTS.map(x=>`<option value="${x.id}" ${x.id===a.id?'selected':''}>${x.name} — ${x.role} · ${providerLabel(x)}</option>`).join('')}</select><label class="field-label" for="task-project">PROJECT</label><select class="form-field" id="task-project" name="project">${['Nyoni Commercials','Colony Zero','Palava 231','SANKOFI','Studio Operations','Other'].map(x=>`<option>${x}</option>`).join('')}</select><div class="submit-row"><button type="button" class="modal-close">Cancel</button><button class="primary" type="submit">Add assignment</button></div></form><p class="fineprint">Every live result still requires your approval. Nothing is automatically sent, published, or purchased.</p>`);$('#task-title').focus()}
function connectionsModal(){
 modal(`<div class="modal-top"><h2>Agent connections</h2><button class="modal-close" aria-label="Close">×</button></div><p class="modal-description">Codex is the primary managed harness for every Nyoni agent. Muse Spark can join as a second creative brain, and completed runs can be recorded in the Movie Studio database.</p><div class="connection-grid"><div class="connection-card ${runtime.codex?'connected':''}"><span>PRIMARY RUNTIME</span><b>OpenAI Codex</b><small>${runtime.codex?`Connected · ${safe(runtime.codexModel)}`:'Needs OPENAI_API_KEY'}</small></div><div class="connection-card ${runtime.muse?'connected':''}"><span>COLLABORATOR</span><b>Meta Muse</b><small>${runtime.muse?`Connected · ${safe(runtime.museModel)}`:'Needs MODEL_API_KEY'}</small></div><div class="connection-card ${runtime.studio?'connected':''}"><span>SHARED MEMORY</span><b>Movie Studio DB</b><small>${runtime.studio?'Connected · generation_jobs':'Needs Supabase server variables'}</small></div></div><div class="info-banner"><b>Secure setup</b><br/>Keys stay on the server. For local work, copy <code>.env.example</code> to <code>.env.local</code>. On Vercel, add the same variables in Project Settings. Never paste provider keys into this browser.</div><form id="access-form"><label class="field-label" for="studio-passcode">STUDIO PASSCODE ${hasStudioPasscode()?'· SAVED FOR THIS TAB':''}</label><input class="form-field" id="studio-passcode" name="passcode" type="password" autocomplete="current-password" placeholder="Required for protected production runs"/><div class="submit-row"><button type="button" class="modal-close">Close</button><button class="primary" type="submit">Save passcode</button></div></form>`);
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
 const b=e.target.closest('[data-agent]');if(b){pickAgent(b.dataset.agent);return;}
 const t=e.target.closest('[data-task]');if(t){pickTask(t.dataset.task);return;}
 const ia=e.target.closest('[data-idea-assign]');if(ia){const idea=state.ideas.find(i=>i.id===ia.dataset.ideaAssign);if(idea)assignModal(idea.title);return;}
 const id=e.target.closest('button')?.id;
 if(['new-task-top','new-task-top-dock','add-task-inline','assign-selected'].includes(id)){assignModal();return;}
 if(['connections-btn','connections-top','connections-inline','connections-inspector'].includes(id)){connectionsModal();return;}
 if(id==='back-agent'){state.task=null;render()}
 if(id==='preview-task'){void previewTask()}
 if(id==='approve-task'){const t=task(state.task);if(t){t.status='approved';log(`Output approved: ${t.title}`);render();toast('Approved by you')}}
 if(id==='reject-task'){const t=task(state.task);if(t){t.status='rejected';log(`Revision requested: ${t.title}`);render();toast('Marked for revision')}}
 if(id==='delete-task'){const t=task(state.task);if(t&&t.status!=='running'){state.tasks=state.tasks.filter(x=>x.id!==t.id);state.task=null;log(`Assignment deleted: ${t.title}`);render();toast('Assignment deleted')}}
 if(id==='help-btn'){modal(`<div class="modal-top"><h2>About Nyoni HQ</h2><button class="modal-close">×</button></div><p class="modal-description">NYONI HQ is a four-floor 3D agent campus. Every crew member now has a named identity, a Codex harness profile, and an optional Muse collaborator connection.</p><div class="info-banner"><b>You remain in control.</b> Live drafts require approval, and no agent can automatically publish, contact anyone, or spend money.</div><p class="fineprint">Click any bot or name banner to inspect it. Open Connections to see exactly which runtimes are active.</p><div class="submit-row"><button class="modal-close">Got it</button></div>`);}
});
window.addEventListener('nyoni-agent-select',event=>{const id=event.detail?.id;if(!id||!AGENTS.some(item=>item.id===id))return;state.agent=id;state.task=null;store();updateHQAgentCard(id)});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();if((e.key==='Enter'||e.key===' ')&&e.target.matches('.bot-hit,[role="button"][data-task]')){e.preventDefault();e.target.dispatchEvent(new MouseEvent('click',{bubbles:true}))}});
document.addEventListener('submit',e=>{
 if(e.target.id==='task-form'){e.preventDefault();const form=new FormData(e.target);const title=String(form.get('title')||'').trim();if(!title)return;const t={id:'task-'+Date.now()+'-'+Math.floor(Math.random()*1e6),title,agent:String(form.get('agent')),project:String(form.get('project')),status:'queued',created:now(),output:'',sample:false};state.tasks.unshift(t);state.agent=t.agent;state.task=t.id;log(`Assignment created for ${agent(t.agent).name}`);closeModal();render();toast('Assignment added to local queue')}
 if(e.target.id==='idea-form'){e.preventDefault();const input=e.target.querySelector('input');const title=input.value.trim();if(!title)return;state.ideas.unshift({id:'idea-'+Date.now(),title,description:'Ready for development.',sample:false});log('New idea saved in vault');render();toast('Idea saved locally')}
 if(e.target.id==='access-form'){e.preventDefault();const form=new FormData(e.target);saveStudioPasscode(form.get('passcode'));closeModal();toast('Studio passcode saved for this browser tab')}
});
$('#brand-link').addEventListener('click',e=>{e.preventDefault();nav('hq')});
render();
getAgentRuntimeStatus({refresh:true}).then((status)=>{runtime={loading:false,...status};render();}).catch((error)=>{console.warn('Agent runtime status unavailable',error);runtime={...runtime,loading:false};updateRuntimeChrome();});
import('./hq-3d.js').then(mountCurrentHQ).catch(error=>{console.error('Could not start Nyoni HQ 3D',error);const host=$('#hq-3d-stage');host?.classList.add('has-error');const status=host?.querySelector('[data-3d-status]');if(status)status.textContent=`3D module error: ${error?.message||'unknown error'}`});
