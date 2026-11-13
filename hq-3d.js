import * as THREE from './assets/vendor/three/three.module.js';
import { GLTFLoader } from './assets/vendor/three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from './assets/vendor/three/addons/controls/OrbitControls.js';
import { clone as cloneSkinned } from './assets/vendor/three/addons/utils/SkeletonUtils.js';

const ASSET_ROOT = './assets/3d/';
const AGENT_COLORS = {
  scout: '#79c98f', creative: '#b68de0', pulse: '#69aee8', hunter: '#e49a55',
  story: '#f1b5ae', motion: '#9dc4fb', vault: '#eedb92', migo: '#b8eadb',
  ledger: '#80d8c2', margin: '#f0c56f', treasury: '#86bff2', audit: '#e99ba8',
};
const AGENT_IDENTITIES = {
  scout: ['SCOUT', 'Research & Discovery'], creative: ['CREATIVE', 'Art Director'],
  pulse: ['PULSE', 'Analytics'], hunter: ['HUNTER', 'Client Acquisition'],
  story: ['STORY', 'Screenwriting'], motion: ['MOTION', 'Production Designer'],
  vault: ['VAULT', 'Ideas & Experiments'], migo: ['MIGO', 'Studio Director'],
  ledger: ['LEDGER', 'Financial Controller'], margin: ['MARGIN', 'FP&A Analyst'],
  treasury: ['TREASURY', 'Cash Operations'], audit: ['AUDIT', 'Risk & Compliance'],
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
  context.shadowColor = 'rgba(0,0,0,.55)';
  context.shadowBlur = 22;
  context.fillStyle = 'rgba(12, 23, 20, .92)';
  context.beginPath();
  context.roundRect(12, 12, 744, 154, 34);
  context.fill();
  context.shadowBlur = 0;
  context.strokeStyle = 'rgba(244, 246, 231, .28)';
  context.lineWidth = 3;
  context.stroke();
  context.fillStyle = accent;
  context.beginPath();
  context.roundRect(34, 42, 12, 94, 6);
  context.fill();
  context.fillStyle = '#f1f4e9';
  context.font = '800 48px Inter, Arial, sans-serif';
  context.fillText(name, 72, 82);
  context.fillStyle = '#aebbb0';
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

export function mountHQ3D({ hostId = 'hq-3d-stage', floorSlug = 'commercials', selectedAgent = 'scout', agentIds = [] } = {}) {
  activeExperience?.destroy();
  activeExperience = null;
  const host = document.getElementById(hostId);
  if (!host) return null;
  try {
    activeExperience = createExperience(host, floorSlug, selectedAgent, agentIds);
  } catch (error) {
    console.error('Nyoni HQ WebGL initialization failed', error);
    host.classList.add('has-error');
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

window.NyoniHQ3D = { mountHQ3D, unmountHQ3D, setSelectedAgent, setAgentActivity };
