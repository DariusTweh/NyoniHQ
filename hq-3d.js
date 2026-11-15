import * as THREE from './assets/vendor/three/three.module.js';
import { GLTFLoader } from './assets/vendor/three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from './assets/vendor/three/addons/controls/OrbitControls.js';
import { clone as cloneSkinned } from './assets/vendor/three/addons/utils/SkeletonUtils.js';

const ASSET_ROOT = './assets/3d/';
const AGENT_COLORS = {
  scout: '#79c98f', creative: '#b68de0', pulse: '#69aee8', hunter: '#e49a55',
  story: '#f1b5ae', motion: '#9dc4fb', vault: '#eedb92', migo: '#b8eadb',
  ledger: '#80d8c2', margin: '#f0c56f', treasury: '#86bff2', audit: '#e99ba8',
  lumina: '#f3b4d4', reframe: '#c7a7f5', nova: '#89b9ff', kinetic: '#7ce0d4',
  cutline: '#f39b86', sonora: '#f0cc72', vox: '#a9d7f2', rally: '#f19db8',
};
const AGENT_IDENTITIES = {
  scout: ['SCOUT', 'Research & Discovery'], creative: ['CREATIVE', 'Art Director'],
  pulse: ['PULSE', 'Analytics'], hunter: ['HUNTER', 'Client Acquisition'],
  story: ['STORY', 'Screenwriting'], motion: ['MOTION', 'Production Designer'],
  vault: ['VAULT', 'Ideas & Experiments'], migo: ['MIGO', 'Studio Director'],
  ledger: ['LEDGER', 'Financial Controller'], margin: ['MARGIN', 'FP&A Analyst'],
  treasury: ['TREASURY', 'Cash Operations'], audit: ['AUDIT', 'Risk & Compliance'],
  lumina: ['LUMINA', 'Text-to-Image Artist'], reframe: ['REFRAME', 'Image-to-Image Artist'],
  nova: ['NOVA', 'Text-to-Video Director'], kinetic: ['KINETIC', 'Image-to-Video Animator'],
  cutline: ['CUTLINE', 'AI Video Editor'], sonora: ['SONORA', 'Music Composer'],
  vox: ['VOX', 'Voice Director'], rally: ['RALLY', 'Campaign Producer'],
};

let activeExperience = null;
let manifestPromise = null;
let botPromise = null;
const floorPromises = new Map();

function loadGLTF(url, progress) {
  return new Promise((resolve, reject) => new GLTFLoader().load(url, resolve, progress, reject));
}

function getManifest() {
  manifestPromise ??= fetch(`${ASSET_ROOT}nyoni_hq_manifest.json`).then((response) => {
    if (!response.ok) throw new Error(`Manifest failed with ${response.status}`);
    return response.json();
  });
  return manifestPromise;
}

function loadAssets(floorSlug, reportProgress) {
  const progress = { floor: 0, bot: 0 };
  const update = (key) => (event) => {
    if (event.lengthComputable) progress[key] = event.loaded / event.total;
    reportProgress(Math.round(((progress.floor + progress.bot) / 2) * 100));
  };
  return getManifest().then((manifest) => {
    const floorData = manifest.floors?.[floorSlug];
    if (!floorData) throw new Error(`Unknown floor: ${floorSlug}`);
    if (!floorPromises.has(floorSlug)) {
      floorPromises.set(floorSlug, loadGLTF(`${ASSET_ROOT}${floorData.glb}`, update('floor')));
    }
    botPromise ??= loadGLTF(`${ASSET_ROOT}${manifest.bot_asset.glb}`, update('bot'));
    return Promise.all([manifest, floorData, floorPromises.get(floorSlug), botPromise]);
  });
}

function blenderPositionToThree(position) {
  return new THREE.Vector3(position[0], position[2], -position[1]);
}

function prepareBotMaterials(instance, agentId, accentHex) {
  const accent = new THREE.Color(accentHex || AGENT_COLORS[agentId] || '#b8eadb');
  instance.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
    object.userData.agentId = agentId;
    if (!object.material) return;
    object.material = object.material.clone();
    if (object.material.name.includes('MAT_SCOUT_GREEN')) {
      object.material.color.copy(accent);
      object.material.emissive?.copy(accent).multiplyScalar(0.18);
    }
    if (object.material.name.includes('MAT_SCOUT_EYES')) {
      object.material.color.copy(accent);
      if (object.material.emissive) {
        object.material.emissive.copy(accent);
        object.material.emissiveIntensity = 2.2;
      }
    }
  });
}

function createNameBanner(agentId, accentHex) {
  const [name, role] = AGENT_IDENTITIES[agentId] || [agentId.toUpperCase(), 'Nyoni Agent'];
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 184;
  const context = canvas.getContext('2d');
  const accent = accentHex || AGENT_COLORS[agentId] || '#b8eadb';
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.shadowColor = 'rgba(68,57,45,.18)';
  context.shadowBlur = 18;
  context.fillStyle = 'rgba(255, 252, 246, .94)';
  context.beginPath();
  context.roundRect(12, 12, 744, 154, 34);
  context.fill();
  context.shadowBlur = 0;
  context.strokeStyle = 'rgba(70, 80, 72, .18)';
  context.lineWidth = 3;
  context.stroke();
  context.fillStyle = accent;
  context.beginPath();
  context.roundRect(34, 42, 12, 94, 6);
  context.fill();
  context.fillStyle = '#18231f';
  context.font = '800 48px Inter, Arial, sans-serif';
  context.fillText(name, 72, 82);
  context.fillStyle = '#65736c';
  context.font = '600 25px Inter, Arial, sans-serif';
  context.fillText(role.toUpperCase(), 72, 126);
  context.fillStyle = accent;
  context.beginPath();
  context.arc(700, 88, 12, 0, Math.PI * 2);
  context.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    opacity: 0.9,
  });
  const sprite = new THREE.Sprite(material);
  sprite.name = `NAME_BANNER_${agentId.toUpperCase()}`;
  sprite.userData.agentId = agentId;
  sprite.position.set(0, 2.02, 0);
  sprite.scale.set(3.35, 0.8, 1);
  sprite.renderOrder = 30;
  return sprite;
}

function createWorkBubble(agentId, accentHex) {
  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 220;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, transparent: true, depthTest: false, depthWrite: false,
  }));
  sprite.name = `WORK_BUBBLE_${agentId.toUpperCase()}`;
  sprite.userData.texture = texture;
  sprite.position.set(0, 3.25, 0);
  sprite.scale.set(5.4, 1.32, 1);
  sprite.renderOrder = 40;
  sprite.visible = false;
  sprite.userData.canvas = canvas;
  sprite.userData.texture = texture;
  sprite.userData.agentId = agentId;
  sprite.userData.accent = accentHex;
  return sprite;
}

function updateWorkBubble(sprite, status, detail) {
  if (!sprite) return;
  sprite.visible = status !== 'idle';
  if (!sprite.visible) return;
  const canvas = sprite.userData.canvas;
  const context = canvas.getContext('2d');
  const accent = sprite.userData.accent || '#b8eadb';
  const name = AGENT_IDENTITIES[sprite.userData.agentId]?.[0] || sprite.userData.agentId.toUpperCase();
  const label = { running: 'WORKING', queued: 'QUEUED', review: 'NEEDS APPROVAL', handoff: 'HANDING OFF', complete: 'COMPLETED', failed: 'NEEDS RETRY' }[status] || status.toUpperCase();
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.shadowColor = 'rgba(68,57,45,.22)';
  context.shadowBlur = 24;
  context.fillStyle = 'rgba(255,252,246,.97)';
  context.beginPath(); context.roundRect(12, 12, 876, 174, 38); context.fill();
  context.shadowBlur = 0;
  context.strokeStyle = accent; context.globalAlpha = .72; context.lineWidth = 4; context.stroke(); context.globalAlpha = 1;
  context.fillStyle = accent; context.beginPath(); context.arc(62, 65, 13, 0, Math.PI * 2); context.fill();
  context.fillStyle = '#17231f'; context.font = '800 34px Inter, Arial'; context.fillText(`${name} · ${label}`, 94, 77);
  context.fillStyle = '#66746d'; context.font = '600 27px Inter, Arial';
  const message = String(detail || 'Working on a studio mission');
  context.fillText(message.length > 66 ? `${message.slice(0, 63)}…` : message, 45, 137);
  context.fillStyle = 'rgba(255,252,246,.97)'; context.beginPath(); context.moveTo(410,185); context.lineTo(450,218); context.lineTo(490,185); context.fill();
  sprite.userData.texture.needsUpdate = true;
}

function createExperience(host, floorSlug, initialAgent, agentIds = []) {
  const canvas = host.querySelector('canvas');
  const status = host.querySelector('[data-3d-status]');
  const progressBar = host.querySelector('[data-3d-progress]');
  const rotateButton = host.querySelector('[data-3d-action="rotate"]');
  const resetButton = host.querySelector('[data-3d-action="reset"]');
  if (!canvas) throw new Error('3D canvas is missing');

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-11, 11, 11, -11, 0.1, 120);
  camera.position.set(18, 17, 20);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.8, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.enablePan = true;
  controls.minZoom = 0.8;
  controls.maxZoom = 2.3;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.minPolarAngle = Math.PI * 0.2;
  controls.autoRotate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  controls.autoRotateSpeed = 0.35;
  camera.lookAt(controls.target);

  scene.add(new THREE.HemisphereLight(0xf8f1d9, 0x17231f, 2.45));
  const keyLight = new THREE.DirectionalLight(0xfff0cf, 4.1);
  keyLight.position.set(-6, 15, 8);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.left = -12;
  keyLight.shadow.camera.right = 12;
  keyLight.shadow.camera.top = 12;
  keyLight.shadow.camera.bottom = -12;
  keyLight.shadow.bias = -0.0004;
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0x9ddccc, 1.25);
  rimLight.position.set(8, 9, -10);
  scene.add(rimLight);

  const timer = new THREE.Timer();
  timer.connect(document);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const mixers = [];
  const bots = new Map();
  const pickables = [];
  const selectRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.63, 0.035, 12, 64),
    new THREE.MeshBasicMaterial({ color: AGENT_COLORS[initialAgent] || '#b8eadb', transparent: true, opacity: 0.9 }),
  );
  selectRing.rotation.x = -Math.PI / 2;
  selectRing.visible = false;
  scene.add(selectRing);

  let selectedAgent = initialAgent;
  let floorLabel = floorSlug.replaceAll('_', ' ');
  let frameId = 0;
  let disposed = false;
  let pointerDown = null;
  let ready = false;

  function report(message, percent = null) {
    if (status) status.textContent = message;
    if (progressBar && percent !== null) progressBar.style.setProperty('--progress', `${Math.max(4, percent)}%`);
  }

  function resize() {
    const width = Math.max(host.clientWidth, 1);
    const height = Math.max(host.clientHeight, 1);
    const aspect = width / height;
    const viewSize = width < 700 ? 22.5 : 20.5;
    camera.left = (-viewSize * aspect) / 2;
    camera.right = (viewSize * aspect) / 2;
    camera.top = viewSize / 2;
    camera.bottom = -viewSize / 2;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  function setAction(record, name) {
    if (!record?.actions?.[name] || record.currentAction === name) return;
    const next = record.actions[name];
    const previous = record.actions[record.currentAction];
    previous?.fadeOut(0.22);
    next.reset().fadeIn(0.22).play();
    record.currentAction = name;
  }

  function selectAgent(agentId, announce = false) {
    const record = bots.get(agentId);
    if (!record) return;
    const previous = bots.get(selectedAgent);
    if (previous && previous !== record && previous.activity !== 'running') setAction(previous, 'idle_loop');
    selectedAgent = agentId;
    bots.forEach((bot, id) => {
      if (bot.nameBanner?.material) bot.nameBanner.material.opacity = id === agentId ? 1 : 0.82;
      if (bot.nameBanner) bot.nameBanner.scale.set(id === agentId ? 3.62 : 3.35, id === agentId ? 0.86 : 0.8, 1);
    });
    if (record.activity !== 'running') setAction(record, 'talking_loop');
    selectRing.visible = true;
    selectRing.position.copy(record.position).setY(0.075);
    selectRing.material.color.set(record.accent);
    if (announce) {
      const label = agentId.charAt(0).toUpperCase() + agentId.slice(1);
      report(`${label} selected · drag to orbit · scroll to zoom`, 100);
      window.dispatchEvent(new CustomEvent('nyoni-agent-select', { detail: { id: agentId } }));
    }
  }

  function setAgentActivity(agentId, activity = 'idle') {
    const record = bots.get(agentId);
    if (!record) return;
    record.activity = activity;
    const action = {
      running: 'typing_loop',
      review: 'approval_alert_loop',
      complete: 'celebrate_once',
      talking: 'talking_loop',
      idle: agentId === selectedAgent ? 'talking_loop' : 'idle_loop',
    }[activity] || 'idle_loop';
    setAction(record, action);
  }

  function resetCamera() {
    camera.position.set(18, 17, 20);
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    controls.target.set(0, 0.8, 0);
    controls.update();
  }

  function toggleRotation() {
    controls.autoRotate = !controls.autoRotate;
    rotateButton?.classList.toggle('active', controls.autoRotate);
    rotateButton?.setAttribute('aria-pressed', String(controls.autoRotate));
  }

  function onPointerDown(event) {
    pointerDown = { x: event.clientX, y: event.clientY };
  }

  function raycast(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(pickables, false)[0];
  }

  function onPointerUp(event) {
    if (!ready || !pointerDown) return;
    const distance = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
    pointerDown = null;
    if (distance > 6) return;
    const hit = raycast(event);
    if (hit?.object?.userData?.agentId) selectAgent(hit.object.userData.agentId, true);
  }

  function onPointerMove(event) {
    if (!ready) return;
    canvas.classList.toggle('is-hovering-agent', Boolean(raycast(event)));
  }

  function animate(timestamp) {
    if (disposed) return;
    frameId = requestAnimationFrame(animate);
    timer.update(timestamp);
    const delta = Math.min(timer.getDelta(), 0.05);
    mixers.forEach((mixer) => mixer.update(delta));
    controls.update();
    if (selectRing.visible) selectRing.scale.setScalar(1 + Math.sin(performance.now() * 0.0045) * 0.07);
    renderer.render(scene, camera);
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointermove', onPointerMove);
  resetButton?.addEventListener('click', resetCamera);
  rotateButton?.addEventListener('click', toggleRotation);
  controls.addEventListener('start', () => {
    controls.autoRotate = false;
    rotateButton?.classList.remove('active');
    rotateButton?.setAttribute('aria-pressed', 'false');
  });
  resize();
  animate();
  report(`Loading ${floorLabel}…`, 5);

  loadAssets(floorSlug, (percent) => report(`Loading ${floorLabel}… ${percent}%`, percent))
    .then(([manifest, floorData, floorGLTF, botGLTF]) => {
      if (disposed) return;
      floorLabel = floorData.display_name;
      const floor = floorGLTF.scene.clone(true);
      floor.name = floorData.id;
      floor.traverse((object) => {
        if (!object.isMesh) return;
        object.receiveShadow = true;
        if (object.material) object.material.side = THREE.FrontSide;
      });
      scene.add(floor);

      const scoutManifest = manifest.floors.commercials.agents.scout;
      const scoutPosition = blenderPositionToThree(scoutManifest.position);
      const scoutRotation = scoutManifest.rotation[2];
      const templateAgents = Object.entries(floorData.agents);
      const floorAgents = agentIds.length ? templateAgents.map(([templateId,data],index)=>{
        const agentId=agentIds[index]||templateId;
        return [agentId,{...data,accent:AGENT_COLORS[agentId]||data.accent}];
      }) : templateAgents;
      if (!floorAgents.some(([id]) => id === selectedAgent)) selectedAgent = floorAgents[0]?.[0];

      floorAgents.forEach(([agentId, data], index) => {
        const position = blenderPositionToThree(data.position);
        const container = new THREE.Group();
        container.name = `WEB_AGENT_${agentId.toUpperCase()}`;
        container.position.copy(position);
        container.rotation.y = -(data.rotation[2] - scoutRotation);

        const instance = cloneSkinned(botGLTF.scene);
        instance.position.copy(scoutPosition).multiplyScalar(-1);
        prepareBotMaterials(instance, agentId, data.accent);
        instance.traverse((object) => {
          if (object.isMesh) pickables.push(object);
        });
        container.add(instance);
        const hitTarget = new THREE.Mesh(
          new THREE.SphereGeometry(0.82, 12, 8),
          new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
        );
        hitTarget.position.set(0, 0.82, 0);
        hitTarget.userData.agentId = agentId;
        hitTarget.name = `HIT_${agentId.toUpperCase()}`;
        container.add(hitTarget);
        pickables.push(hitTarget);
        const nameBanner = createNameBanner(agentId, data.accent);
        container.add(nameBanner);
        pickables.push(nameBanner);
        scene.add(container);

        const mixer = new THREE.AnimationMixer(instance);
        const actions = Object.fromEntries(botGLTF.animations.map((clip) => [clip.name, mixer.clipAction(clip)]));
        actions.idle_loop?.play();
        if (actions.idle_loop) actions.idle_loop.time = index * 0.42;
        mixers.push(mixer);
        bots.set(agentId, {
          container, instance, mixer, actions, currentAction: 'idle_loop', position,
          activity: 'idle', nameBanner,
          accent: data.accent || AGENT_COLORS[agentId] || '#b8eadb',
        });
      });

      ready = true;
      selectAgent(selectedAgent, false);
      host.classList.add('is-ready');
      report(`${floorLabel} · drag to orbit · scroll to zoom · click a bot`, 100);
      window.dispatchEvent(new CustomEvent('nyoni-3d-loaded', { detail: { floor: floorSlug } }));
    })
    .catch((error) => {
      if (disposed) return;
      console.error('Nyoni HQ 3D failed to load', error);
      host.classList.add('has-error');
      report('3D could not load — showing the rendered room');
    });

  return {
    selectAgent,
    setAgentActivity,
    resetCamera,
    destroy() {
      disposed = true;
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointermove', onPointerMove);
      resetButton?.removeEventListener('click', resetCamera);
      rotateButton?.removeEventListener('click', toggleRotation);
      controls.dispose();
      timer.dispose();
      renderer.dispose();
    },
  };
}

function createCampusExperience(host, initialAgent, agents, initialDepartment, initialLiveData = {}) {
  const canvas = host.querySelector('canvas');
  const status = host.querySelector('[data-3d-status]');
  const progressBar = host.querySelector('[data-3d-progress]');
  const rotateButton = host.querySelector('[data-3d-action="rotate"]');
  const resetButton = host.querySelector('[data-3d-action="reset"]');
  const campusButton = host.querySelector('[data-3d-action="campus"]');
  const zoomInButton = host.querySelector('[data-3d-action="zoom-in"]');
  const zoomOutButton = host.querySelector('[data-3d-action="zoom-out"]');
  const handoffHud = host.querySelector('[data-handoff-hud]');
  if (!canvas) throw new Error('3D canvas is missing');

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-34, 34, 34, -34, 0.1, 220);
  camera.position.set(52, 54, 58);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.36;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.enablePan = true;
  controls.minZoom = 0.72;
  controls.maxZoom = 6;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.minPolarAngle = Math.PI * 0.16;
  controls.autoRotate = false;
  camera.lookAt(controls.target);

  scene.add(new THREE.HemisphereLight(0xfffbef, 0xc9d8cf, 3.35));
  const key = new THREE.DirectionalLight(0xffedcf, 5.15);
  key.position.set(-24, 46, 30); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -42; key.shadow.camera.right = 42; key.shadow.camera.top = 42; key.shadow.camera.bottom = -42;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xc7e5d6, 2.15); fill.position.set(35, 24, -26); scene.add(fill);

  const timer = new THREE.Timer(); timer.connect(document);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const mixers = [];
  const bots = new Map();
  const pickables = [];
  const departmentCenters = new Map();
  const handoffQueue = [];
  const seenHandoffs = new Set();
  let activeHandoff = null;
  let selectedAgent = initialAgent;
  let pendingLiveData = initialLiveData;
  let pointerDown = null;
  let frameId = 0;
  let disposed = false;
  let ready = false;
  let handoffCamera = null;

  const selectRing = new THREE.Mesh(
    new THREE.TorusGeometry(.68, .045, 12, 64),
    new THREE.MeshBasicMaterial({ color: AGENT_COLORS[initialAgent] || '#b8eadb', transparent: true, opacity: .95 }),
  );
  selectRing.rotation.x = -Math.PI / 2; selectRing.visible = false; scene.add(selectRing);

  function report(message, percent = null) {
    if (status) status.textContent = message;
    if (progressBar && percent !== null) progressBar.style.setProperty('--progress', `${Math.max(4, percent)}%`);
  }
  function resize() {
    const width = Math.max(host.clientWidth, 1), height = Math.max(host.clientHeight, 1), aspect = width / height;
    const view = width < 700 ? 68 : 58;
    camera.left = (-view * aspect) / 2; camera.right = (view * aspect) / 2; camera.top = view / 2; camera.bottom = -view / 2;
    camera.updateProjectionMatrix(); renderer.setSize(width, height, false);
  }
  function setAction(record, name) {
    if (!record?.actions?.[name] || record.currentAction === name) return;
    record.actions[record.currentAction]?.fadeOut(.18);
    record.actions[name].reset().fadeIn(.18).play();
    record.currentAction = name;
  }
  function activityAction(activity) {
    return { running: 'typing_loop', queued: 'thinking_loop', review: 'approval_alert_loop', complete: 'celebrate_once', failed: 'thinking_loop', handoff: 'walk_loop', talking: 'talking_loop' }[activity] || 'idle_loop';
  }
  function selectAgent(agentId, announce = false) {
    const record = bots.get(agentId); if (!record) return;
    selectedAgent = agentId;
    bots.forEach((bot, id) => {
      if (bot.nameBanner?.material) bot.nameBanner.material.opacity = id === agentId ? 1 : .68;
    });
    selectRing.visible = true; selectRing.position.copy(record.container.position).setY(.08); selectRing.material.color.set(record.accent);
    if (announce) { focusAgent(agentId); window.dispatchEvent(new CustomEvent('nyoni-agent-select', { detail: { id: agentId } })); }
  }
  function setAgentActivity(agentId, activity = 'idle', detail = '') {
    const record = bots.get(agentId); if (!record) return;
    record.baseActivity = { activity, detail };
    if (!record.movement) setAction(record, activityAction(activity));
    updateWorkBubble(record.workBubble, activity, detail);
    record.workBubble.visible = !['idle', 'available'].includes(activity);
  }
  function moveBot(record, target, onDone) {
    record.movement = { target: target.clone(), onDone };
    setAction(record, 'walk_loop');
  }
  function updateMovement(record, delta) {
    if (!record.movement) return;
    const offset = record.movement.target.clone().sub(record.container.position); offset.y = 0;
    const distance = offset.length();
    if (distance < .12) {
      record.container.position.copy(record.movement.target);
      const done = record.movement.onDone; record.movement = null;
      setAction(record, activityAction(record.baseActivity?.activity)); done?.(); return;
    }
    const direction = offset.normalize();
    record.container.position.addScaledVector(direction, Math.min(distance, delta * 5.2));
    record.container.rotation.y = Math.atan2(direction.x, direction.z);
  }
  function finishHandoff() {
    if (!activeHandoff) return;
    const { from, to, packet, item } = activeHandoff;
    scene.remove(packet); packet.geometry.dispose(); packet.material.dispose();
    if (handoffHud) {
      const returningToMigo = to.id === 'migo';
      handoffHud.classList.add('is-delivered');
      handoffHud.querySelector('b').textContent = returningToMigo ? 'REPORT DELIVERED TO MIGO' : 'HANDOFF ACCEPTED';
      handoffHud.querySelector('small').textContent = returningToMigo ? `${AGENT_IDENTITIES[from.id]?.[0] || from.id} returned the completed report` : `${AGENT_IDENTITIES[to.id]?.[0] || to.id} is taking over the work`;
      handoffHud.dataset.taskId = item.task_id || item.assignment_id || '';
    }
    let returned = 0;
    const arrive = (record) => () => {
      returned += 1; record.container.rotation.y = record.homeRotation;
      setAgentActivity(record.id, record.baseActivity.activity, record.baseActivity.detail);
      if (returned === 2) {
        activeHandoff = null; handoffCamera = null;
        window.setTimeout(() => {
          if (handoffHud && !activeHandoff) handoffHud.classList.remove('is-visible', 'is-delivered');
          startNextHandoff();
        }, 1250);
      }
    };
    moveBot(from, from.home, arrive(from)); moveBot(to, to.home, arrive(to));
  }
  function startNextHandoff() {
    if (activeHandoff || !handoffQueue.length || !ready) return;
    const item = handoffQueue.shift(), from = bots.get(item.from_agent_id), to = bots.get(item.to_agent_id);
    if (!from || !to || from === to) { startNextHandoff(); return; }
    const midpoint = from.home.clone().add(to.home).multiplyScalar(.5); midpoint.y = Math.max(from.home.y, to.home.y);
    const direction = to.home.clone().sub(from.home).setY(0).normalize();
    const fromMeet = midpoint.clone().addScaledVector(direction, -.72), toMeet = midpoint.clone().addScaledVector(direction, .72);
    const packet = new THREE.Mesh(new THREE.IcosahedronGeometry(.34, 1), new THREE.MeshStandardMaterial({ color: from.accent, emissive: from.accent, emissiveIntensity: 2.2, roughness: .22 }));
    packet.position.copy(from.home).add(new THREE.Vector3(0, 1.4, 0)); scene.add(packet);
    activeHandoff = { item, from, to, packet, phase: 'meeting', arrived: 0, started: 0, fromMeet, toMeet };
    handoffCamera = { target: midpoint.clone(), zoom: 2.85 };
    if (handoffHud) {
      const fromName = AGENT_IDENTITIES[from.id]?.[0] || from.id.toUpperCase();
      const toName = AGENT_IDENTITIES[to.id]?.[0] || to.id.toUpperCase();
      handoffHud.classList.remove('is-delivered'); handoffHud.classList.add('is-visible');
      handoffHud.querySelector('b').textContent = `${fromName} → ${toName}`;
      handoffHud.querySelector('small').textContent = item.title || (to.id === 'migo' ? 'Returning the completed report' : 'Delegating the assignment');
      handoffHud.dataset.taskId = item.task_id || item.assignment_id || '';
    }
    window.dispatchEvent(new CustomEvent('nyoni-handoff-start', { detail: { from: from.id, to: to.id, assignmentId: item.assignment_id, title: item.title } }));
    updateWorkBubble(from.workBubble, 'handoff', `Taking work to ${AGENT_IDENTITIES[to.id]?.[0] || to.id}`); from.workBubble.visible = true;
    updateWorkBubble(to.workBubble, 'handoff', `Receiving work from ${AGENT_IDENTITIES[from.id]?.[0] || from.id}`); to.workBubble.visible = true;
    const arrive = () => {
      if (!activeHandoff) return;
      activeHandoff.arrived += 1;
      if (activeHandoff.arrived === 2) { activeHandoff.phase = 'transfer'; activeHandoff.started = performance.now(); }
    };
    moveBot(from, fromMeet, arrive); moveBot(to, toMeet, arrive);
  }
  function queueHandoffs(handoffs = []) {
    const recentCutoff = Date.now() - 30 * 60 * 1000;
    handoffs.slice().sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0)).forEach((handoff) => {
      const id = handoff.id || `${handoff.assignment_id || ''}:${handoff.from_agent_id}:${handoff.to_agent_id}:${handoff.created_at || ''}`;
      if (seenHandoffs.has(id)) return;
      seenHandoffs.add(id);
      if (!handoff.created_at || new Date(handoff.created_at).getTime() >= recentCutoff) handoffQueue.push(handoff);
    });
    startNextHandoff();
  }
  function updateLiveData(data = {}) {
    pendingLiveData = data;
    if (!ready) return;
    (data.agents || []).forEach((item) => setAgentActivity(item.id, item.activity, item.detail));
    queueHandoffs(data.handoffs || []);
  }
  function resetCamera() {
    controls.target.set(0, 0, 0); camera.position.set(52, 54, 58); camera.zoom = 1; camera.updateProjectionMatrix(); controls.update();
  }
  function zoomBy(factor) { camera.zoom = THREE.MathUtils.clamp(camera.zoom * factor, controls.minZoom, controls.maxZoom); camera.updateProjectionMatrix(); controls.update(); }
  function focusAgent(agentId) {
    const record = bots.get(agentId); if (!record) return;
    const center = record.container.position.clone();
    const offset = camera.position.clone().sub(controls.target).normalize().multiplyScalar(28);
    controls.target.copy(center); camera.position.copy(center).add(offset); camera.zoom = 4.65; camera.updateProjectionMatrix(); controls.update();
  }
  function focusDepartment(name) {
    const center = departmentCenters.get(String(name || '').toUpperCase());
    if (!center) return resetCamera();
    const offset = camera.position.clone().sub(controls.target).normalize().multiplyScalar(48);
    controls.target.copy(center); camera.position.copy(center).add(offset); camera.zoom = 3.15; camera.updateProjectionMatrix(); controls.update();
  }
  function toggleRotation() {
    controls.autoRotate = !controls.autoRotate; rotateButton?.classList.toggle('active', controls.autoRotate); rotateButton?.setAttribute('aria-pressed', String(controls.autoRotate));
  }
  function raycast(event) {
    const rect = canvas.getBoundingClientRect(); pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1; pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera); return raycaster.intersectObjects(pickables, false)[0];
  }
  function onPointerDown(event) { pointerDown = { x: event.clientX, y: event.clientY }; }
  function onPointerUp(event) {
    if (!ready || !pointerDown) return;
    const distance = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y); pointerDown = null; if (distance > 6) return;
    const hit = raycast(event); if (hit?.object?.userData?.agentId) selectAgent(hit.object.userData.agentId, true);
  }
  function onPointerMove(event) { if (ready) canvas.classList.toggle('is-hovering-agent', Boolean(raycast(event))); }
  function animate(timestamp) {
    if (disposed) return; frameId = requestAnimationFrame(animate); timer.update(timestamp); const delta = Math.min(timer.getDelta(), .05);
    mixers.forEach((mixer) => mixer.update(delta)); bots.forEach((record) => updateMovement(record, delta));
    if (activeHandoff) {
      if (activeHandoff.phase === 'meeting') activeHandoff.packet.position.copy(activeHandoff.from.container.position).add(new THREE.Vector3(0, 1.4, 0));
      else if (activeHandoff.phase === 'transfer') {
        const progress = Math.min(1, (performance.now() - activeHandoff.started) / 1150);
        activeHandoff.packet.position.lerpVectors(activeHandoff.fromMeet, activeHandoff.toMeet, progress).add(new THREE.Vector3(0, 1.45 + Math.sin(progress * Math.PI) * .9, 0));
        activeHandoff.packet.rotation.y += delta * 4;
        if (progress >= 1) finishHandoff();
      }
    }
    if (handoffCamera) {
      controls.target.lerp(handoffCamera.target, Math.min(1, delta * 2.8));
      camera.zoom = THREE.MathUtils.lerp(camera.zoom, handoffCamera.zoom, Math.min(1, delta * 2.8));
      camera.updateProjectionMatrix();
    }
    const selected = bots.get(selectedAgent); if (selected && selectRing.visible) selectRing.position.copy(selected.container.position).setY(.08);
    if (selectRing.visible) selectRing.scale.setScalar(1 + Math.sin(performance.now() * .0045) * .07);
    controls.update(); renderer.render(scene, camera);
  }

  const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(host);
  canvas.addEventListener('pointerdown', onPointerDown); canvas.addEventListener('pointerup', onPointerUp); canvas.addEventListener('pointermove', onPointerMove);
  resetButton?.addEventListener('click', resetCamera); campusButton?.addEventListener('click', resetCamera); rotateButton?.addEventListener('click', toggleRotation);
  zoomInButton?.addEventListener('click', () => zoomBy(1.35)); zoomOutButton?.addEventListener('click', () => zoomBy(0.74));
  handoffHud?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('nyoni-handoff-select', { detail: { taskId: handoffHud.dataset.taskId } })));
  controls.addEventListener('start', () => { controls.autoRotate = false; rotateButton?.classList.remove('active'); rotateButton?.setAttribute('aria-pressed', 'false'); });
  resize(); animate(); report('Loading the company campus…', 8);

  Promise.all([
    loadGLTF(`${ASSET_ROOT}nyoni_company_campus_v04.glb`, (event) => event.lengthComputable && report(`Loading the company campus… ${Math.round(event.loaded / event.total * 70)}%`, event.loaded / event.total * 70)),
    getManifest().then((manifest) => {
      botPromise ??= loadGLTF(`${ASSET_ROOT}${manifest.bot_asset.glb}`);
      return Promise.all([manifest, botPromise]);
    }),
  ]).then(([campusGLTF, [manifest, botGLTF]]) => {
    if (disposed) return;
    const campus = campusGLTF.scene;
    campus.name = 'NYONI_COMPANY_CAMPUS';
    campus.traverse((object) => { if (object.isMesh) { object.receiveShadow = true; object.castShadow = true; } });
    scene.add(campus); campus.updateMatrixWorld(true);
    campus.traverse((object) => {
      if (object.name.startsWith('ZONE_')) departmentCenters.set(object.name.slice(5).replaceAll('_', ' ').toUpperCase(), object.getWorldPosition(new THREE.Vector3()));
    });
    const scoutManifest = manifest.floors.commercials.agents.scout;
    const scoutPosition = blenderPositionToThree(scoutManifest.position);
    agents.forEach((agent, index) => {
      const station = campus.getObjectByName(`STATION_${agent.id.toUpperCase()}`);
      if (!station) return;
      const home = station.getWorldPosition(new THREE.Vector3());
      const container = new THREE.Group(); container.name = `WEB_AGENT_${agent.id.toUpperCase()}`; container.position.copy(home); container.rotation.y = Math.PI;
      const instance = cloneSkinned(botGLTF.scene); instance.position.copy(scoutPosition).multiplyScalar(-1); prepareBotMaterials(instance, agent.id, agent.accent); container.add(instance);
      instance.traverse((object) => { if (object.isMesh) pickables.push(object); });
      const hit = new THREE.Mesh(new THREE.SphereGeometry(.84, 12, 8), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
      hit.position.set(0,.84,0); hit.userData.agentId = agent.id; container.add(hit); pickables.push(hit);
      const banner = createNameBanner(agent.id, agent.accent); banner.scale.multiplyScalar(.98); banner.position.y = 2.3; container.add(banner); pickables.push(banner);
      const bubble = createWorkBubble(agent.id, agent.accent); bubble.visible = false; container.add(bubble);
      scene.add(container);
      const mixer = new THREE.AnimationMixer(instance), actions = Object.fromEntries(botGLTF.animations.map((clip) => [clip.name, mixer.clipAction(clip)]));
      actions.idle_loop?.play(); if (actions.idle_loop) actions.idle_loop.time = index * .19; mixers.push(mixer);
      bots.set(agent.id, { id: agent.id, container, instance, mixer, actions, currentAction: 'idle_loop', home: home.clone(), homeRotation: Math.PI, accent: agent.accent, nameBanner: banner, workBubble: bubble, baseActivity: { activity: 'idle', detail: '' }, movement: null });
    });
    ready = true; selectAgent(selectedAgent, false); updateLiveData(pendingLiveData); host.classList.add('is-ready');
    if (initialDepartment) focusDepartment(initialDepartment); else resetCamera();
    report('Company campus live · click a bot · watch real handoffs', 100);
    window.dispatchEvent(new CustomEvent('nyoni-3d-loaded', { detail: { campus: true } }));
  }).catch((error) => {
    if (disposed) return; console.error('Nyoni company campus failed to load', error); host.classList.add('has-error'); report(`3D campus failed: ${error?.message || 'asset unavailable'} — showing the rendered overview`);
    window.dispatchEvent(new CustomEvent('nyoni-3d-error', { detail: { message: error?.message || 'The 3D campus asset could not be loaded.' } }));
  });

  return {
    selectAgent, focusAgent, setAgentActivity, updateLiveData, focusDepartment, resetCamera, zoomBy,
    destroy() {
      disposed = true; cancelAnimationFrame(frameId); resizeObserver.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown); canvas.removeEventListener('pointerup', onPointerUp); canvas.removeEventListener('pointermove', onPointerMove);
      resetButton?.removeEventListener('click', resetCamera); campusButton?.removeEventListener('click', resetCamera); rotateButton?.removeEventListener('click', toggleRotation);
      controls.dispose(); timer.dispose(); renderer.dispose();
    },
  };
}

export function mountHQ3D({ hostId = 'hq-3d-stage', floorSlug = 'commercials', selectedAgent = 'scout', agentIds = [], campus = false, agents = [], department = '', liveData = {} } = {}) {
  activeExperience?.destroy();
  activeExperience = null;
  const host = document.getElementById(hostId);
  if (!host) return null;
  try {
    activeExperience = campus
      ? createCampusExperience(host, selectedAgent, agents, department, liveData)
      : createExperience(host, floorSlug, selectedAgent, agentIds);
  } catch (error) {
    console.error('Nyoni HQ WebGL initialization failed', error);
    host.classList.add('has-error');
    window.dispatchEvent(new CustomEvent('nyoni-3d-error', { detail: { message: error?.message || 'WebGL could not start in this browser.' } }));
    const status = host.querySelector('[data-3d-status]');
    if (status) status.textContent = 'WebGL unavailable — showing the rendered room';
  }
  return activeExperience;
}

export function unmountHQ3D() {
  activeExperience?.destroy();
  activeExperience = null;
}

export function setSelectedAgent(agentId) {
  activeExperience?.selectAgent(agentId, false);
}

export function setAgentActivity(agentId, activity) {
  activeExperience?.setAgentActivity(agentId, activity);
}

export function updateLiveData(data) {
  activeExperience?.updateLiveData?.(data);
}

export function focusDepartment(name) {
  activeExperience?.focusDepartment?.(name);
}

export function focusAgent(agentId) {
  activeExperience?.focusAgent?.(agentId);
}

window.NyoniHQ3D = { mountHQ3D, unmountHQ3D, setSelectedAgent, setAgentActivity, updateLiveData, focusDepartment, focusAgent };
