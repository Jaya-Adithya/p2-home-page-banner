const THREE = await import("./node_modules/three/build/three.module.js").catch(() =>
  import("https://cdn.jsdelivr.net/npm/three@0.166.1/build/three.module.js"),
);

const LAYOUT_STORAGE_KEY = "particle-sphere-layout-v5";

// Set to true to show the on-screen layout tuning panel (sliders + reset/copy).
const DEBUG = false;

const defaultLayout = {
  main: { x: 5, y: 0.06, z: 0.2, scale: 0.66 },
  layers: [
    {
      name: "Seed",
      visible: 0.2,
      x: 0.18,
      y: -0.01,
      z: 0.61,
      scale: 0.86,
      rotY: 0.33841,
      opacity: 0.3,
    },
    {
      name: "Sprout",
      visible: 0.37,
      x: 1.42,
      y: 0,
      z: -0.05,
      scale: 0.73,
      rotY: 0.32841,
      opacity: 0.5,
    },
    {
      name: "Bloom",
      visible: 0.57,
      x: 2.91,
      y: 0.02,
      z: -0.22,
      scale: 0.7,
      rotY: 0.30841,
      opacity: 0.7,
    },
  ],
};

const MAIN_TARGET_OPACITY = 0.8;

function loadLayout() {
  try {
    const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!saved) {
      return structuredClone(defaultLayout);
    }
    const parsed = JSON.parse(saved);
    return {
      main: { ...defaultLayout.main, ...parsed.main },
      layers: defaultLayout.layers.map((layer, index) => ({
        ...layer,
        ...(parsed.layers?.[index] ?? {}),
      })),
    };
  } catch {
    return structuredClone(defaultLayout);
  }
}

const layout = loadLayout();

const canvas = document.querySelector("#particle-sphere");
const app = document.querySelector("#app");
const annotationElements = [...document.querySelectorAll("#annotations .annotation")];
const scene = new THREE.Scene();

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  powerPreference: "high-performance",
});
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
camera.position.set(0, 0, 7.2);

const sphereRadius = 2.32;
const hoverAngularRadius = 0.22;
const hoverPush = 1.52;
const hotspotMinSeparation = 0.55;
const autoRotateSpeedY = 0.12;
const autoRotateSpeedX = 0.025;
const particleCount = window.innerWidth < 720 ? 3600 : 6400;
const goldenAngle = Math.PI * (3 - Math.sqrt(5));
const basePositions = new Float32Array(particleCount * 3);
const positions = new Float32Array(particleCount * 3);
const baseColors = new Float32Array(particleCount * 3);
const colors = new Float32Array(particleCount * 3);
const particleSeeds = new Float32Array(particleCount);
const mainBaseOrigins = new Float32Array(particleCount * 3);
const mainBirthDelays = new Float32Array(particleCount);
const color = new THREE.Color();

// Deterministic per-particle random in [0, 1) — keeps the intro stable across frames.
function rand01(i, salt) {
  const v = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

// Intro origins live in a loose spherical nebula around each sphere; particles
// materialize there and spiral inward, so there is no fixed starting shape.
const CLOUD_INNER = 1.45;
const CLOUD_SPREAD = 2.3;

// Fraction of a layer's intro each particle spends in transit. Birth delays fill
// the remaining budget so the slowest particle lands exactly at progress 1.
const particleTransitFraction = 0.88;
const maxBirthDelay = 1 - particleTransitFraction;

for (let i = 0; i < particleCount; i += 1) {
  const stride = i * 3;
  const y = 1 - (i / (particleCount - 1)) * 2;
  const ringRadius = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = goldenAngle * i;
  const jitter = 1 + Math.sin(i * 12.9898) * 0.012;

  const x = Math.cos(theta) * ringRadius * sphereRadius * jitter;
  const z = Math.sin(theta) * ringRadius * sphereRadius * jitter;
  const py = y * sphereRadius * jitter;

  basePositions[stride] = x;
  basePositions[stride + 1] = py;
  basePositions[stride + 2] = z;
  positions[stride] = x;
  positions[stride + 1] = py;
  positions[stride + 2] = z;

  const cloudTheta = rand01(i, 1) * Math.PI * 2;
  const cloudCosPhi = rand01(i, 2) * 2 - 1;
  const cloudSinPhi = Math.sqrt(Math.max(0, 1 - cloudCosPhi * cloudCosPhi));
  const cloudRadius = sphereRadius * (CLOUD_INNER + rand01(i, 3) * CLOUD_SPREAD);
  mainBaseOrigins[stride] = Math.cos(cloudTheta) * cloudSinPhi * cloudRadius;
  mainBaseOrigins[stride + 1] = cloudCosPhi * cloudRadius * 0.8;
  mainBaseOrigins[stride + 2] = Math.sin(cloudTheta) * cloudSinPhi * cloudRadius;

  mainBirthDelays[i] = rand01(i, 4) * maxBirthDelay;

  const hueBand = (Math.sin(theta * 0.35) + 1) * 0.5;
  const verticalMix = (y + 1) * 0.5;
  const brightness = 0.74 + ringRadius * 0.18 + verticalMix * 0.06 + hueBand * 0.02;
  color.setRGB(brightness, brightness * 0.99, brightness * 0.98);

  baseColors[stride] = color.r;
  baseColors[stride + 1] = color.g;
  baseColors[stride + 2] = color.b;
  colors[stride] = color.r;
  colors[stride + 1] = color.g;
  colors[stride + 2] = color.b;

  particleSeeds[i] = Math.sin(i * 78.233) * 43758.5453;
}

const geometry = new THREE.BufferGeometry();
geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

const material = new THREE.PointsMaterial({
  size: window.innerWidth < 720 ? 0.09 : 0.041,
  sizeAttenuation: true,
  map: createParticleTexture(),
  transparent: true,
  opacity: MAIN_TARGET_OPACITY,
  vertexColors: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});

// Each maturation layer is a full sphere clipped to a visible fraction (25 / 50 / 75%).
// The clip plane keeps the +X cap: flat edge on the left, curved sphere edge on the right.
function visibleFractionToMinX(visibleFraction) {
  return sphereRadius * (1 - visibleFraction * 2);
}

function createSphereSliceGeometry(minX) {
  const slicePositions = [];
  const sliceColors = [];
  const sliceBasePositions = [];
  const sliceOriginPositions = [];
  const sliceSeeds = [];
  const sliceBirthDelays = [];

  for (let i = 0; i < particleCount; i += 1) {
    const stride = i * 3;
    if (basePositions[stride] >= minX) {
      const x = basePositions[stride];
      const y = basePositions[stride + 1];
      const z = basePositions[stride + 2];
      slicePositions.push(x, y, z);
      sliceBasePositions.push(x, y, z);
      const saltBase = 11 + minX * 5.13;
      const cloudTheta = rand01(i, saltBase) * Math.PI * 2;
      const cloudCosPhi = rand01(i, saltBase + 1) * 2 - 1;
      const cloudSinPhi = Math.sqrt(Math.max(0, 1 - cloudCosPhi * cloudCosPhi));
      const cloudRadius = sphereRadius * (CLOUD_INNER + rand01(i, saltBase + 2) * CLOUD_SPREAD);
      sliceOriginPositions.push(
        Math.cos(cloudTheta) * cloudSinPhi * cloudRadius,
        cloudCosPhi * cloudRadius * 0.8,
        Math.sin(cloudTheta) * cloudSinPhi * cloudRadius,
      );
      sliceSeeds.push(particleSeeds[i]);
      sliceBirthDelays.push(rand01(i, saltBase + 3) * maxBirthDelay);

      const edgeMix = (x - minX) / Math.max(sphereRadius - minX, 0.001);
      const brightness = 0.72 + edgeMix * 0.28;
      sliceColors.push(brightness, brightness * 0.99, brightness * 0.98);
    }
  }

  const sliceGeometry = new THREE.BufferGeometry();
  sliceGeometry.setAttribute("position", new THREE.Float32BufferAttribute(slicePositions, 3));
  sliceGeometry.setAttribute("color", new THREE.Float32BufferAttribute(sliceColors, 3));
  sliceGeometry.userData.basePositions = new Float32Array(sliceBasePositions);
  sliceGeometry.userData.baseColors = new Float32Array(sliceColors);
  sliceGeometry.userData.originPositions = new Float32Array(sliceOriginPositions);
  sliceGeometry.userData.seeds = new Float32Array(sliceSeeds);
  sliceGeometry.userData.birthDelays = new Float32Array(sliceBirthDelays);
  return sliceGeometry;
}

const boundsBox = new THREE.Box3();
const scratchBox = new THREE.Box3();
const scratchMatrix = new THREE.Matrix4();
const boundsCenter = new THREE.Vector3();
const boundsSize = new THREE.Vector3();
let emblemBounds = { width: 8, height: 4 };

function computeEmblemBounds() {
  boundsBox.makeEmpty();

  for (const entry of maturationLayers) {
    const { sliceParticles, group } = entry;
    sliceParticles.geometry.computeBoundingBox();
    scratchBox.copy(sliceParticles.geometry.boundingBox);
    scratchMatrix.copy(group.matrix);
    scratchBox.applyMatrix4(scratchMatrix);
    boundsBox.union(scratchBox);
  }

  particles.geometry.computeBoundingBox();
  scratchBox.copy(particles.geometry.boundingBox);
  scratchMatrix.copy(mainLayer.matrix);
  scratchBox.applyMatrix4(scratchMatrix);
  boundsBox.union(scratchBox);

  boundsBox.getCenter(boundsCenter);
  boundsBox.getSize(boundsSize);

  return {
    centerX: boundsCenter.x,
    centerY: boundsCenter.y,
    width: boundsSize.x,
    height: boundsSize.y,
  };
}

function centerEmblem() {
  emblemGroup.position.set(0, 0, 0);
  emblemGroup.updateMatrixWorld(true);
  emblemBounds = computeEmblemBounds();
  emblemGroup.position.set(-emblemBounds.centerX, -emblemBounds.centerY, 0);
  return emblemBounds;
}

function applyLayout() {
  mainLayer.position.set(layout.main.x, layout.main.y, layout.main.z);
  mainLayer.scale.setScalar(layout.main.scale);

  for (const entry of maturationLayers) {
    const { group, sliceMaterial, sliceParticles, config } = entry;
    group.position.set(config.x, config.y, config.z);
    group.scale.setScalar(config.scale);
    group.rotation.y = config.rotY ?? 0;
    sliceMaterial.opacity = config.opacity;

    const minX = visibleFractionToMinX(config.visible);
    if (entry.appliedVisible !== config.visible) {
      sliceParticles.geometry.dispose();
      sliceParticles.geometry = createSphereSliceGeometry(minX);
      entry.appliedVisible = config.visible;
    }
  }

  centerEmblem();
  resize();
}

function saveLayout() {
  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
}

function resetLayout() {
  Object.assign(layout.main, defaultLayout.main);
  layout.layers.forEach((layer, index) => {
    Object.assign(layer, defaultLayout.layers[index]);
  });
  applyLayout();
  saveLayout();
  document.dispatchEvent(new CustomEvent("layout:updated"));
}

function copyLayoutToClipboard() {
  const payload = JSON.stringify(layout, null, 2);
  navigator.clipboard?.writeText(payload);
  return payload;
}

function createLayoutControls() {
  if (!DEBUG) {
    applyLayout();
    return;
  }

  const showByDefault =
    new URLSearchParams(window.location.search).has("layout") ||
    new URLSearchParams(window.location.search).has("dev");

  const fab = document.createElement("button");
  fab.type = "button";
  fab.className = "layout-fab";
  fab.textContent = "Layout";
  fab.hidden = showByDefault;
  app.appendChild(fab);

  const panel = document.createElement("aside");
  panel.className = "layout-panel";
  panel.hidden = !showByDefault;
  panel.innerHTML = `
    <div class="layout-panel__header">
      <h2 class="layout-panel__title">Circle Layout</h2>
      <button type="button" class="layout-panel__toggle" data-action="close">Close</button>
    </div>
  `;
  app.appendChild(panel);

  const sections = [
    { key: "main", label: "Main Sphere", target: layout.main, fields: ["x", "y", "z", "scale"] },
    ...layout.layers.map((layer, index) => ({
      key: `layer-${index}`,
      label: layer.name,
      target: layer,
      fields: ["x", "y", "z", "scale", "visible", "rotY"],
    })),
  ];

  const sliderState = [];

  for (const section of sections) {
    const block = document.createElement("section");
    block.className = "layout-panel__section";
    block.innerHTML = `<h3 class="layout-panel__section-title">${section.label}</h3>`;
    panel.appendChild(block);

    for (const field of section.fields) {
      const limits =
        field === "scale"
          ? { min: 0.35, max: 1.8, step: 0.01 }
          : field === "visible"
            ? { min: 0.12, max: 0.92, step: 0.01 }
            : field === "rotY"
              ? { min: -3.14159, max: 3.14159, step: 0.01 }
              : field === "z"
                ? { min: -1.5, max: 1.5, step: 0.01 }
                : field === "y"
                  ? { min: -2, max: 2, step: 0.01 }
                  : { min: -8, max: 5, step: 0.01 };

      const fieldLabel = field === "rotY" ? "rot" : field;

      const row = document.createElement("div");
      row.className = "layout-panel__row";
      row.innerHTML = `
        <label for="${section.key}-${field}">${fieldLabel}</label>
        <input id="${section.key}-${field}" type="range" />
        <output for="${section.key}-${field}"></output>
      `;
      block.appendChild(row);

      const input = row.querySelector("input");
      const output = row.querySelector("output");
      input.min = String(limits.min);
      input.max = String(limits.max);
      input.step = String(limits.step);

      const sync = () => {
        const value = section.target[field] ?? 0;
        input.value = String(value);
        output.textContent =
          field === "rotY"
            ? `${((value * 180) / Math.PI).toFixed(0)}°`
            : Number(value).toFixed(2);
      };

      input.addEventListener("input", () => {
        section.target[field] = Number(input.value);
        output.textContent = Number(input.value).toFixed(2);
        applyLayout();
        saveLayout();
      });

      sliderState.push(sync);
    }
  }

  const actions = document.createElement("div");
  actions.className = "layout-panel__actions";
  actions.innerHTML = `
    <button type="button" data-action="reset">Reset</button>
    <button type="button" data-action="copy">Copy JSON</button>
  `;
  panel.appendChild(actions);

  const hint = document.createElement("p");
  hint.className = "layout-panel__hint";
  hint.textContent =
    "Drag sliders to nudge each circle. Values persist in localStorage. Set DEBUG = true in main.js to show this panel.";
  panel.appendChild(hint);

  const openPanel = () => {
    panel.hidden = false;
    fab.hidden = true;
    sliderState.forEach((sync) => sync());
  };

  const closePanel = () => {
    panel.hidden = true;
    fab.hidden = false;
  };

  fab.addEventListener("click", openPanel);
  panel.querySelector('[data-action="close"]').addEventListener("click", closePanel);
  panel.querySelector('[data-action="reset"]').addEventListener("click", () => {
    resetLayout();
    sliderState.forEach((sync) => sync());
  });
  panel.querySelector('[data-action="copy"]').addEventListener("click", () => {
    copyLayoutToClipboard();
  });

  document.addEventListener("layout:updated", () => {
    sliderState.forEach((sync) => sync());
  });

  applyLayout();
  sliderState.forEach((sync) => sync());
}

const emblemGroup = new THREE.Group();
scene.add(emblemGroup);

const maturationMaterials = [];
const maturationLayers = [];

for (const layer of layout.layers) {
  const layerGroup = new THREE.Group();
  const minX = visibleFractionToMinX(layer.visible);
  const sliceGeometry = createSphereSliceGeometry(minX);

  const sliceMaterial = new THREE.PointsMaterial({
    size: window.innerWidth < 720 ? 0.09 : 0.041,
    sizeAttenuation: true,
    map: material.map,
    transparent: true,
    opacity: layer.opacity,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  maturationMaterials.push(sliceMaterial);

  const sliceParticles = new THREE.Points(sliceGeometry, sliceMaterial);
  // Bounding spheres are computed on first render, when unborn particles are
  // parked far off-screen — culling would hide the whole layer permanently.
  sliceParticles.frustumCulled = false;
  layerGroup.add(sliceParticles);
  emblemGroup.add(layerGroup);

  maturationLayers.push({
    group: layerGroup,
    sliceMaterial,
    sliceParticles,
    config: layer,
    appliedVisible: layer.visible,
  });
}

const mainLayer = new THREE.Group();
emblemGroup.add(mainLayer);
mainLayer.position.set(layout.main.x, layout.main.y, layout.main.z);
mainLayer.scale.setScalar(layout.main.scale);

const particles = new THREE.Points(geometry, material);
particles.frustumCulled = false;
mainLayer.add(particles);

const hotspots = createRandomHotspots(annotationElements.length, hotspotMinSeparation);

for (let i = 0; i < hotspots.length; i += 1) {
  hotspots[i].labelEl = annotationElements[i] ?? null;
  hotspots[i].wasFacingCamera = false;
  hotspots[i].revealGeneration = 0;
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2(10, 10);
const targetHoverPoint = new THREE.Vector3();
const hoverPoint = new THREE.Vector3();
const localHoverPoint = new THREE.Vector3();
const localRayOrigin = new THREE.Vector3();
const localRayDirection = new THREE.Vector3();
const localRay = new THREE.Ray();
const inverseMatrix = new THREE.Matrix4();
const localRaycastSphere = new THREE.Sphere(new THREE.Vector3(), sphereRadius);
const labelWorldPosition = new THREE.Vector3();
const labelScreenPosition = new THREE.Vector3();
const sphereCenterWorld = new THREE.Vector3();
const sphereCenterScreen = new THREE.Vector3();
const hotspotWorldNormal = new THREE.Vector3();
const hotspotToCamera = new THREE.Vector3();

const annotationFacingThreshold = 0.18;
const annotationHideThreshold = 0.05;
const annotationEdgeMargin = 10;
const annotationLabelPad = 8;
const annotationHorizMin = 22;
const annotationHorizMax = 48;
const annotationMaxCharsPerLine = 18;

let pointerInside = false;
let targetHover = 0;
let hover = 0;
let isDragging = false;
let dragPointerId = null;
let lastDragX = 0;
let lastDragY = 0;
let lastDragTime = 0;
let lastFrame = performance.now();
let spinVelocityX = 0;
let spinVelocityY = 0;

// Intro time accumulates from rendered frames (not wall clock) so a hidden or
// throttled tab pauses the intro instead of silently skipping it.
let introClock = 0;
// Spheres condense left to right; each next one starts while the previous is
// still forming so the chain reads as one continuous growth (no dead pause).
const introLayerDuration = 2600;
const introStagger = Math.round(introLayerDuration * 0.5);
const introMainDelay = 0;
const mainIntroOffset = defaultLayout.layers.length * introStagger + introMainDelay;
// Once a layer finishes forming, its idle drift eases in over this window
// instead of snapping on when the whole intro ends.
const idleBlendMs = 1100;
let introComplete = false;
let introAnnotationsReady = false;
const layerIntroProgress = new Array(layout.layers.length).fill(0);
let mainIntroProgress = 0;

function easeOutCubic(t) {
  const x = 1 - t;
  return 1 - x * x * x;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

const dragRotationSpeed = 0.004;
const spinDamping = 2.6;
const maxSpinSpeed = 4.8;
const spinStopThreshold = 0.012;
const dragVelocitySmoothing = 0.32;

function createParticleTexture() {
  const size = 96;
  const spriteCanvas = document.createElement("canvas");
  spriteCanvas.width = size;
  spriteCanvas.height = size;
  const ctx = spriteCanvas.getContext("2d");
  const radius = size / 2;
  const glow = ctx.createRadialGradient(radius, radius, 0, radius, radius, radius);
  glow.addColorStop(0, "rgba(255, 255, 255, 1)");
  glow.addColorStop(0.34, "rgba(255, 255, 255, 0.86)");
  glow.addColorStop(0.72, "rgba(255, 255, 255, 0.2)");
  glow.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(spriteCanvas);
}

function createRandomHotspots(count, minAngle) {
  const list = [];
  const minDot = Math.cos(minAngle);
  const maxAttempts = count * 120;

  for (let attempt = 0; attempt < maxAttempts && list.length < count; attempt += 1) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const direction = new THREE.Vector3(
      Math.sin(phi) * Math.cos(theta),
      Math.cos(phi),
      Math.sin(phi) * Math.sin(theta),
    );

    const isSeparated = list.every((hotspot) => direction.dot(hotspot.direction) <= minDot);
    if (!isSeparated) {
      continue;
    }

    list.push({
      direction,
      seed: Math.random() * Math.PI * 2,
      labelEl: null,
    });
  }

  return list;
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
  const bounds = emblemBounds;
  const widthFitDistance = (bounds.width * 0.62) / Math.tan(horizontalFov / 2);
  const heightFitDistance = (bounds.height * 0.68) / Math.tan(verticalFov / 2);
  camera.position.z = Math.max(7.2, widthFitDistance, heightFitDistance);
  camera.position.x = 0;
  camera.position.y = 0;
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  material.size = width < 720 ? 0.09 : 0.041;
  const maturationSize = width < 720 ? 0.09 : 0.041;
  for (const maturationMaterial of maturationMaterials) {
    maturationMaterial.size = maturationSize;
  }
}

function projectToCanvas(worldPosition, rect) {
  labelScreenPosition.copy(worldPosition).project(camera);
  return {
    x: (labelScreenPosition.x * 0.5 + 0.5) * rect.width,
    y: (-labelScreenPosition.y * 0.5 + 0.5) * rect.height,
  };
}

function splitWordsByMaxChars(words, maxCharsPerLine) {
  const lines = [];
  let current = "";

  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }

    const candidate = `${current} ${word}`;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

function applyLabelContent(labelEl) {
  const rawText = (labelEl.dataset.fullText ?? labelEl.textContent).trim();
  labelEl.dataset.fullText = rawText;
  const words = rawText.split(/\s+/).filter(Boolean);
  const lines = splitWordsByMaxChars(words, annotationMaxCharsPerLine);
  const useStack = lines.length > 1;
  const layoutKey = useStack ? `${lines.join("|")}:stack` : rawText;

  if (labelEl.dataset.layoutKey === layoutKey) {
    return useStack;
  }

  labelEl.dataset.layoutKey = layoutKey;
  if (useStack) {
    labelEl.classList.add("annotation__label--stacked");
    labelEl.replaceChildren(
      ...lines.map((line) => {
        const span = document.createElement("span");
        span.className = "annotation__word";
        span.textContent = line;
        return span;
      }),
    );
  } else {
    labelEl.classList.remove("annotation__label--stacked");
    labelEl.textContent = rawText;
  }

  return useStack;
}

function measureLabelBox(labelEl, labelX, labelY, side) {
  labelEl.style.left = `${labelX}px`;
  labelEl.style.top = `${labelY}px`;

  const width = labelEl.offsetWidth;
  const height = labelEl.offsetHeight;
  const pad = annotationLabelPad;

  if (side === "right") {
    return {
      left: labelX + pad,
      right: labelX + pad + width,
      top: labelY - height * 0.5,
      bottom: labelY + height * 0.5,
      width,
      height,
    };
  }

  return {
    left: labelX - pad - width,
    right: labelX - pad,
    top: labelY - height * 0.5,
    bottom: labelY + height * 0.5,
    width,
    height,
  };
}

function labelFitsViewport(box, viewportW, viewportH) {
  return (
    box.left >= annotationEdgeMargin &&
    box.right <= viewportW - annotationEdgeMargin &&
    box.top >= annotationEdgeMargin &&
    box.bottom <= viewportH - annotationEdgeMargin
  );
}

function fitAnnotationLabel(annotationEl, elbow, preferredSide, viewportW, viewportH) {
  const labelEl = annotationEl.querySelector(".annotation__label");
  applyLabelContent(labelEl);

  const flippedSide = preferredSide === "right" ? "left" : "right";
  const tries = [
    { side: preferredSide, horizLen: annotationHorizMax },
    { side: preferredSide, horizLen: annotationHorizMin + 10 },
    { side: preferredSide, horizLen: annotationHorizMin },
    { side: flippedSide, horizLen: annotationHorizMax },
    { side: flippedSide, horizLen: annotationHorizMin + 10 },
    { side: flippedSide, horizLen: annotationHorizMin },
  ];

  let labelY = elbow.y;
  let fallback = null;

  for (const attempt of tries) {
    annotationEl.dataset.side = attempt.side;
    const labelX = elbow.x + (attempt.side === "right" ? attempt.horizLen : -attempt.horizLen);
    const box = measureLabelBox(labelEl, labelX, labelY, attempt.side);

    if (labelFitsViewport(box, viewportW, viewportH)) {
      return { x: labelX, y: labelY, side: attempt.side, horizLen: attempt.horizLen };
    }

    fallback = { x: labelX, y: labelY, side: attempt.side, horizLen: attempt.horizLen, box };
  }

  if (fallback) {
    let y = labelY;
    if (fallback.box.bottom > viewportH - annotationEdgeMargin) {
      y -= fallback.box.bottom - (viewportH - annotationEdgeMargin);
    }
    if (fallback.box.top < annotationEdgeMargin) {
      y += annotationEdgeMargin - fallback.box.top;
    }
    annotationEl.dataset.side = fallback.side;
    return { x: fallback.x, y, side: fallback.side, horizLen: fallback.horizLen };
  }

  return {
    x: elbow.x + (preferredSide === "right" ? annotationHorizMin : -annotationHorizMin),
    y: elbow.y,
    side: preferredSide,
    horizLen: annotationHorizMin,
  };
}

function setAnnotationGeometry(annotationEl, anchor, elbow, label, side) {
  annotationEl.style.setProperty("--anchor-x", `${anchor.x}px`);
  annotationEl.style.setProperty("--anchor-y", `${anchor.y}px`);
  annotationEl.style.setProperty("--delay", `${annotationEl.dataset.delay ?? "0s"}`);
  annotationEl.style.setProperty("--label-x", `${label.x}px`);
  annotationEl.style.setProperty("--label-y", `${label.y}px`);
  annotationEl.dataset.side = side;

  const pathEl = annotationEl.querySelector(".annotation__path");
  pathEl.setAttribute("d", `M ${anchor.x} ${anchor.y} L ${elbow.x} ${elbow.y} L ${label.x} ${label.y}`);
  const pathLen = pathEl.getTotalLength();
  annotationEl.style.setProperty("--path-len", String(pathLen));

  if (annotationEl.classList.contains("is-live")) {
    pathEl.style.strokeDashoffset = "0";
  } else {
    pathEl.style.strokeDashoffset = String(pathLen);
  }
}

function revealAnnotation(annotationEl) {
  annotationEl.classList.remove("is-exiting");
  annotationEl.classList.remove("is-live");
  void annotationEl.offsetWidth;
  annotationEl.classList.add("is-live");
}

function hideAnnotation(annotationEl) {
  annotationEl.classList.remove("is-live");
  annotationEl.classList.add("is-exiting");
}

function updateHotspots() {
  const rect = canvas.getBoundingClientRect();
  const { width, height } = rect;

  mainLayer.getWorldPosition(sphereCenterWorld);
  const sphereCenter = projectToCanvas(sphereCenterWorld, rect);

  for (let h = 0; h < hotspots.length; h += 1) {
    const hotspot = hotspots[h];

    labelWorldPosition
      .copy(hotspot.direction)
      .multiplyScalar(sphereRadius * 1.04)
      .applyMatrix4(particles.matrixWorld);
    hotspotWorldNormal.copy(hotspot.direction).transformDirection(particles.matrixWorld);
    hotspotToCamera.copy(camera.position).sub(labelWorldPosition);
    const facingDot = hotspotWorldNormal.dot(hotspotToCamera);
    hotspot.facingDot = facingDot;

    const annotationEl = hotspot.labelEl;
    if (!annotationEl) {
      continue;
    }

    const anchor = projectToCanvas(labelWorldPosition, rect);
    const onScreen =
      anchor.x >= -48 &&
      anchor.x <= width + 48 &&
      anchor.y >= -32 &&
      anchor.y <= height + 32;

    const canReveal =
      introAnnotationsReady && onScreen && facingDot > annotationFacingThreshold;
    const mustHide = !onScreen || facingDot < annotationHideThreshold;

    if (!hotspot.wasFacingCamera && canReveal) {
      revealAnnotation(annotationEl);
      hotspot.revealGeneration += 1;
      hotspot.wasFacingCamera = true;
    } else if (hotspot.wasFacingCamera && mustHide) {
      hideAnnotation(annotationEl);
      hotspot.wasFacingCamera = false;
    }

    hotspot.isFacingCamera = hotspot.wasFacingCamera;

    if (!hotspot.wasFacingCamera) {
      continue;
    }

    let outwardX = anchor.x - sphereCenter.x;
    let outwardY = anchor.y - sphereCenter.y;
    const outwardLen = Math.hypot(outwardX, outwardY) || 1;
    outwardX /= outwardLen;
    outwardY /= outwardLen;

    const diagLen = 22 + (h % 3) * 5;
    const diagDirX = outwardX * 0.82;
    const diagDirY = outwardY * 0.65 - 0.38;
    const diagDirLen = Math.hypot(diagDirX, diagDirY) || 1;
    const preferredSide = outwardX >= 0 ? "right" : "left";

    const elbow = {
      x: anchor.x + (diagDirX / diagDirLen) * diagLen,
      y: anchor.y + (diagDirY / diagDirLen) * diagLen,
    };

    annotationEl.dataset.side = preferredSide;
    const fitted = fitAnnotationLabel(annotationEl, elbow, preferredSide, width, height);
    const label = { x: fitted.x, y: fitted.y };

    if (!annotationEl.dataset.delay) {
      annotationEl.dataset.delay = `${(h % 5) * 0.06}s`;
    }

    setAnnotationGeometry(annotationEl, anchor, elbow, label, fitted.side);
  }
}

function setPointerFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width;
  const y = (event.clientY - rect.top) / rect.height;

  pointer.x = x * 2 - 1;
  pointer.y = -(y * 2 - 1);
  pointerInside = x >= 0 && x <= 1 && y >= 0 && y <= 1;
}

function updateHoverFromPointer() {
  if (!pointerInside || isDragging) {
    targetHover = 0;
    canvas.classList.remove("is-active");
    return;
  }

  particles.updateMatrixWorld();
  raycaster.setFromCamera(pointer, camera);
  inverseMatrix.copy(particles.matrixWorld).invert();
  localRayOrigin.copy(raycaster.ray.origin).applyMatrix4(inverseMatrix);
  localRayDirection.copy(raycaster.ray.direction).transformDirection(inverseMatrix);
  localRay.set(localRayOrigin, localRayDirection);
  const hit = localRay.intersectSphere(localRaycastSphere, targetHoverPoint);

  if (hit) {
    hoverPoint.copy(targetHoverPoint);
    targetHover = 1;
    canvas.classList.add("is-active");
  } else {
    targetHover = 0;
    canvas.classList.remove("is-active");
  }
}

function updatePointer(event) {
  setPointerFromEvent(event);
  updateHoverFromPointer();
}

function clampSpinVelocity() {
  spinVelocityX = Math.max(-maxSpinSpeed, Math.min(maxSpinSpeed, spinVelocityX));
  spinVelocityY = Math.max(-maxSpinSpeed, Math.min(maxSpinSpeed, spinVelocityY));
}

function onPointerDown(event) {
  isDragging = true;
  dragPointerId = event.pointerId;
  lastDragX = event.clientX;
  lastDragY = event.clientY;
  lastDragTime = performance.now();
  spinVelocityX = 0;
  spinVelocityY = 0;
  targetHover = 0;
  canvas.setPointerCapture(event.pointerId);
  canvas.classList.add("is-dragging");
}

function onPointerMove(event) {
  if (isDragging && event.pointerId === dragPointerId) {
    const dx = event.clientX - lastDragX;
    const dy = event.clientY - lastDragY;
    const now = performance.now();
    const dt = Math.max((now - lastDragTime) / 1000, 0.001);
    const instantVelY = (dx * dragRotationSpeed) / dt;
    const instantVelX = (dy * dragRotationSpeed) / dt;
    const blend = dragVelocitySmoothing;

    spinVelocityY = spinVelocityY * (1 - blend) + instantVelY * blend;
    spinVelocityX = spinVelocityX * (1 - blend) + instantVelX * blend;
    clampSpinVelocity();

    mainLayer.rotation.y += dx * dragRotationSpeed;
    mainLayer.rotation.x += dy * dragRotationSpeed;
    lastDragX = event.clientX;
    lastDragY = event.clientY;
    lastDragTime = now;
    return;
  }

  updatePointer(event);
}

function endDrag(event) {
  if (!isDragging || event.pointerId !== dragPointerId) {
    return;
  }

  isDragging = false;
  dragPointerId = null;
  canvas.releasePointerCapture(event.pointerId);
  canvas.classList.remove("is-dragging");
}

function onPointerUp(event) {
  endDrag(event);
  updatePointer(event);
}

function clearPointer(event) {
  if (event) {
    endDrag(event);
  }

  pointerInside = false;
  targetHover = 0;
  canvas.classList.remove("is-active");
}

function smoothstep(edge0, edge1, value) {
  const x = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1);
  return x * x * (3 - 2 * x);
}

function animate(now) {
  const elapsed = now * 0.001;
  const delta = Math.min((now - lastFrame) * 0.001, 0.05);
  lastFrame = now;
  introClock += delta * 1000;
  const introElapsed = introClock;

  if (!introComplete) {
    let allDone = true;

    for (let i = 0; i < maturationLayers.length; i += 1) {
      const t = clamp01((introElapsed - i * introStagger) / introLayerDuration);
      if (t < 1) allDone = false;
      layerIntroProgress[i] = t;
      const entry = maturationLayers[i];
      // Per-particle color fades carry the reveal; global opacity just ramps up fast.
      entry.sliceMaterial.opacity = entry.config.opacity * easeOutCubic(clamp01(t * 2.2));
    }

    const mt = clamp01((introElapsed - mainIntroOffset) / introLayerDuration);
    if (mt < 1) allDone = false;
    mainIntroProgress = mt;
    material.opacity = MAIN_TARGET_OPACITY * easeOutCubic(clamp01(mt * 2.2));

    if (!introAnnotationsReady && mt > 0.75) {
      introAnnotationsReady = true;
    }

    if (allDone) {
      introComplete = true;
      introAnnotationsReady = true;
      for (const entry of maturationLayers) {
        const geom = entry.sliceParticles.geometry;
        const baseCol = geom.userData.baseColors;
        if (baseCol) {
          geom.attributes.color.array.set(baseCol);
          geom.attributes.color.needsUpdate = true;
        }
        entry.sliceMaterial.opacity = entry.config.opacity;
      }
    }
  }

  hover += (targetHover - hover) * 0.11;

  if (
    !isDragging &&
    (Math.abs(spinVelocityY) > spinStopThreshold || Math.abs(spinVelocityX) > spinStopThreshold)
  ) {
    mainLayer.rotation.y += spinVelocityY * delta;
    mainLayer.rotation.x += spinVelocityX * delta;
    const damping = Math.exp(-spinDamping * delta);
    spinVelocityY *= damping;
    spinVelocityX *= damping;
  } else if (!isDragging) {
    spinVelocityX = 0;
    spinVelocityY = 0;
    mainLayer.rotation.y += delta * autoRotateSpeedY;
    mainLayer.rotation.x += delta * autoRotateSpeedX;
  }

  particles.updateMatrixWorld();
  updateHoverFromPointer();
  updateHotspots();

  localHoverPoint.copy(hoverPoint);

  const hoverLen =
    Math.hypot(localHoverPoint.x, localHoverPoint.y, localHoverPoint.z) || 1;
  const hoverUx = localHoverPoint.x / hoverLen;
  const hoverUy = localHoverPoint.y / hoverLen;
  const hoverUz = localHoverPoint.z / hoverLen;

  const settle = 0.17;
  const mainIdleBlend = smoothstep(
    0,
    1,
    clamp01((introElapsed - (mainIntroOffset + introLayerDuration)) / idleBlendMs),
  );

  for (let i = 0; i < particleCount; i += 1) {
    const stride = i * 3;
    const bx = basePositions[stride];
    const by = basePositions[stride + 1];
    const bz = basePositions[stride + 2];
    const normalScale = 1 / Math.hypot(bx, by, bz);
    const nx = bx * normalScale;
    const ny = by * normalScale;
    const nz = bz * normalScale;
    const seed = particleSeeds[i];

    let tx;
    let ty;
    let tz;
    let glow = 1;

    if (!introComplete) {
      const delay = mainBirthDelays[i];
      const pT = clamp01((mainIntroProgress - delay) / particleTransitFraction);

      if (pT <= 0) {
        // Park unborn particles far off-screen: even at zero color their sprite
        // alpha would still accumulate and show as dark dots over the background.
        positions[stride] = 0;
        positions[stride + 1] = -9999;
        positions[stride + 2] = 0;
        glow = 0;
      } else {
        const eased = easeOutCubic(pT);
        const seedA = seed * 0.00131;
        const seedB = seed * 0.00743;

        const ox = mainBaseOrigins[stride];
        const oy = mainBaseOrigins[stride + 1];
        const oz = mainBaseOrigins[stride + 2];

        let px = ox + (bx - ox) * eased;
        let py = oy + (by - oy) * eased;
        let pz = oz + (bz - oz) * eased;

        // Spiral inflow: the swirl unwinds to zero exactly as the particle lands.
        const swirlAngle = (1 - eased) * (1.35 + rand01(i, 5) * 0.9);
        const swirlCos = Math.cos(swirlAngle);
        const swirlSin = Math.sin(swirlAngle);
        const rx = px * swirlCos - pz * swirlSin;
        const rz = px * swirlSin + pz * swirlCos;
        px = rx;
        pz = rz;

        const drift = 1 - eased;
        px += (Math.sin(elapsed * 1.9 + seedA) * 0.46 + Math.sin(elapsed * 3.1 + seedB) * 0.2) * drift;
        py += (Math.sin(elapsed * 1.6 + seedB + 2.1) * 0.38 + Math.cos(elapsed * 2.7 + seedA) * 0.16) * drift;
        pz += (Math.cos(elapsed * 2.2 + seedA + 4.2) * 0.46 + Math.sin(elapsed * 1.3 + seedB + 1.1) * 0.18) * drift;

        positions[stride] = px;
        positions[stride + 1] = py;
        positions[stride + 2] = pz;

        // Fast fade-in, mid-flight sparkle, full brightness on arrival.
        const bell = pT * (1 - pT) * 4;
        glow = clamp01(pT * 4.5) * (0.55 + 0.45 * eased) + bell * 0.35;
      }
    } else {
      const pulse = Math.sin(elapsed * 1.45 + seed * 0.00015) * 0.025 * mainIdleBlend;
      tx = bx + nx * pulse;
      ty = by + ny * pulse;
      tz = bz + nz * pulse;
      let influence = 0;

      if (hover > 0.005) {
        const dot = Math.min(1, Math.max(-1, nx * hoverUx + ny * hoverUy + nz * hoverUz));
        const angularDistance = Math.acos(dot);

        if (angularDistance < hoverAngularRadius) {
          influence = 1 - smoothstep(0, hoverAngularRadius, angularDistance);
          const dx = bx - localHoverPoint.x;
          const dy = by - localHoverPoint.y;
          const dz = bz - localHoverPoint.z;
          const distance = Math.hypot(dx, dy, dz);
          const dirScale = 1 / Math.max(distance, 0.001);
          const ripple = Math.sin(angularDistance * 18.0 - elapsed * 5.5) * 0.07;
          const displacement = influence * hover * hoverPush;

          tx += dx * dirScale * displacement + nx * ripple * influence * hover;
          ty += dy * dirScale * displacement + ny * ripple * influence * hover;
          tz += dz * dirScale * displacement + nz * ripple * influence * hover;
        }
      }

      positions[stride] += (tx - positions[stride]) * settle;
      positions[stride + 1] += (ty - positions[stride + 1]) * settle;
      positions[stride + 2] += (tz - positions[stride + 2]) * settle;
    }

    colors[stride] = baseColors[stride] * glow;
    colors[stride + 1] = baseColors[stride + 1] * glow;
    colors[stride + 2] = baseColors[stride + 2] * glow;
  }

  geometry.attributes.position.needsUpdate = true;
  geometry.attributes.color.needsUpdate = true;

  for (let l = 0; l < maturationLayers.length; l += 1) {
    const entry = maturationLayers[l];
    const geom = entry.sliceParticles.geometry;
    const basePos = geom.userData.basePositions;
    const seeds = geom.userData.seeds;
    if (!basePos || !seeds) continue;

    const posArray = geom.attributes.position.array;
    const count = seeds.length;
    const timeOffset = l * 0.7;
    const pulseSpeed = 1.15 + l * 0.08;
    const swirlSpeed = 0.55 + l * 0.05;

    if (layerIntroProgress[l] < 1) {
      const layerT = layerIntroProgress[l];
      const origins = geom.userData.originPositions;
      const delays = geom.userData.birthDelays;
      const baseCol = geom.userData.baseColors;
      const colArray = geom.attributes.color.array;

      for (let i = 0; i < count; i += 1) {
        const s = i * 3;
        const bx = basePos[s];
        const by = basePos[s + 1];
        const bz = basePos[s + 2];

        const delay = delays[i];
        const pT = clamp01((layerT - delay) / particleTransitFraction);

        if (pT <= 0) {
          posArray[s] = 0;
          posArray[s + 1] = -9999;
          posArray[s + 2] = 0;
          colArray[s] = 0;
          colArray[s + 1] = 0;
          colArray[s + 2] = 0;
          continue;
        }

        const eased = easeOutCubic(pT);

        const seedRaw = seeds[i];
        const seedA = seedRaw * 0.00131 + l * 1.4;
        const seedB = seedRaw * 0.00743;

        const ox = origins[s];
        const oy = origins[s + 1];
        const oz = origins[s + 2];

        let px = ox + (bx - ox) * eased;
        let py = oy + (by - oy) * eased;
        let pz = oz + (bz - oz) * eased;

        const swirlAngle = (1 - eased) * (1.2 + rand01(i, 7 + l) * 0.9);
        const swirlCos = Math.cos(swirlAngle);
        const swirlSin = Math.sin(swirlAngle);
        const rx = px * swirlCos - pz * swirlSin;
        const rz = px * swirlSin + pz * swirlCos;
        px = rx;
        pz = rz;

        const drift = 1 - eased;
        px += (Math.sin(elapsed * 1.9 + seedA) * 0.42 + Math.sin(elapsed * 3.1 + seedB) * 0.18) * drift;
        py += (Math.sin(elapsed * 1.6 + seedB + 2.1) * 0.34 + Math.cos(elapsed * 2.7 + seedA) * 0.15) * drift;
        pz += (Math.cos(elapsed * 2.2 + seedA + 4.2) * 0.42 + Math.sin(elapsed * 1.3 + seedB + 1.1) * 0.17) * drift;

        posArray[s] = px;
        posArray[s + 1] = py;
        posArray[s + 2] = pz;

        const bell = pT * (1 - pT) * 4;
        const glow = clamp01(pT * 4.5) * (0.55 + 0.45 * eased) + bell * 0.35;
        colArray[s] = baseCol[s] * glow;
        colArray[s + 1] = baseCol[s + 1] * glow;
        colArray[s + 2] = baseCol[s + 2] * glow;
      }

      geom.attributes.color.needsUpdate = true;
      entry.group.rotation.y = entry.config.rotY ?? 0;
    } else {
      // This layer is fully formed; ease its idle drift in from perfect stillness
      // so there is no snap while later spheres are still condensing.
      const idleBlend = smoothstep(
        0,
        1,
        clamp01((introElapsed - (l * introStagger + introLayerDuration)) / idleBlendMs),
      );
      const pulseAmp = 0.028 * idleBlend;
      const swirlAmp = 0.014 * idleBlend;

      for (let i = 0; i < count; i += 1) {
        const stride = i * 3;
        const bx = basePos[stride];
        const by = basePos[stride + 1];
        const bz = basePos[stride + 2];
        const inv = 1 / Math.hypot(bx, by, bz);
        const nx = bx * inv;
        const ny = by * inv;
        const nz = bz * inv;
        const seed = seeds[i];
        const pulse = Math.sin(elapsed * pulseSpeed + seed * 0.00013 + timeOffset) * pulseAmp;
        const swirl = Math.sin(elapsed * swirlSpeed + seed * 0.00021) * swirlAmp;

        const tanX = -nz;
        const tanZ = nx;
        const tanLen = Math.hypot(tanX, tanZ) || 1;

        posArray[stride] = bx + nx * pulse + (tanX / tanLen) * swirl;
        posArray[stride + 1] = by + ny * pulse;
        posArray[stride + 2] = bz + nz * pulse + (tanZ / tanLen) * swirl;
      }

      entry.group.rotation.y =
        (entry.config.rotY ?? 0) + Math.sin(elapsed * 0.35 + l * 1.1) * 0.045 * idleBlend;
    }

    geom.attributes.position.needsUpdate = true;
  }

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

window.addEventListener("resize", resize);
canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerup", onPointerUp);
canvas.addEventListener("pointerleave", clearPointer);
canvas.addEventListener("pointercancel", clearPointer);
createLayoutControls();

for (const entry of maturationLayers) {
  entry.sliceMaterial.opacity = 0;
  const geom = entry.sliceParticles.geometry;
  const origins = geom.userData.originPositions;
  const posArr = geom.attributes.position.array;
  posArr.set(origins);
  geom.attributes.position.needsUpdate = true;
  geom.attributes.color.array.fill(0);
  geom.attributes.color.needsUpdate = true;
}
material.opacity = 0;
positions.set(mainBaseOrigins);
geometry.attributes.position.needsUpdate = true;
colors.fill(0);
geometry.attributes.color.needsUpdate = true;

requestAnimationFrame(animate);
