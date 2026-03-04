/* ---------------- CAMERA ---------------- */
const videoElement = document.getElementById("video");

/* ---------------- THREE.JS ---------------- */
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x020712, 0.004);

const camera3D = new THREE.PerspectiveCamera(
  65,
  window.innerWidth / window.innerHeight,
  0.1,
  1200
);
camera3D.position.set(0, 0, 170);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x01040b, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
document.body.appendChild(renderer.domElement);

/* ---------------- DOTS ---------------- */
const DOTS = 15000;
const geometry = new THREE.BufferGeometry();
const positions = new Float32Array(DOTS * 3);
const basePositions = new Float32Array(DOTS * 3);
const colors = new Float32Array(DOTS * 3);
const sizes = new Float32Array(DOTS);
const phases = new Float32Array(DOTS);

const palette = [
  new THREE.Color("#6ee7ff"),
  new THREE.Color("#38bdf8"),
  new THREE.Color("#a78bfa"),
  new THREE.Color("#34d399"),
  new THREE.Color("#f59e0b"),
  new THREE.Color("#f43f5e")
];

for (let i = 0; i < DOTS; i++) {
  const idx = i * 3;
  const radius = 40 + Math.pow(Math.random(), 0.7) * 150;
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  const swirl = (Math.random() - 0.5) * 24;

  const x = Math.sin(phi) * Math.cos(theta) * radius + swirl;
  const y = Math.cos(phi) * radius * 0.92;
  const z = Math.sin(phi) * Math.sin(theta) * radius + swirl * 0.5;

  positions[idx] = x;
  positions[idx + 1] = y;
  positions[idx + 2] = z;

  basePositions[idx] = x;
  basePositions[idx + 1] = y;
  basePositions[idx + 2] = z;

  const first = palette[Math.floor(Math.random() * palette.length)];
  const second = palette[Math.floor(Math.random() * palette.length)];
  const color = first.clone().lerp(second, Math.random() * 0.5 + 0.2);
  colors[idx] = color.r;
  colors[idx + 1] = color.g;
  colors[idx + 2] = color.b;

  sizes[i] = 0.8 + Math.random() * 2.2;
  phases[i] = Math.random() * Math.PI * 2;
}

geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));

const material = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uPixelRatio: { value: renderer.getPixelRatio() },
    uAlpha: { value: 0.95 }
  },
  vertexColors: true,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  vertexShader: `
    attribute float aSize;
    attribute float aPhase;
    varying vec3 vColor;
    varying float vPulse;
    uniform float uTime;
    uniform float uPixelRatio;

    void main() {
      vColor = color;
      float pulse = 0.85 + 0.15 * sin(uTime * 1.8 + aPhase);
      vPulse = pulse;

      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      float pointSize = aSize * pulse * uPixelRatio * (280.0 / max(10.0, -mvPosition.z));
      gl_PointSize = clamp(pointSize, 1.0, 16.0);
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: `
    varying vec3 vColor;
    varying float vPulse;
    uniform float uAlpha;

    void main() {
      float dist = length(gl_PointCoord - vec2(0.5));
      float strength = smoothstep(0.5, 0.4, dist);
      if (strength < 0.01) discard;
      
      vec3 finalColor = vColor * (0.85 + 0.3 * vPulse);
      gl_FragColor = vec4(finalColor, strength * uAlpha);
    }
  `
});

const dots = new THREE.Points(geometry, material);
dots.frustumCulled = false;
scene.add(dots);

/* ---------------- HAND DATA ---------------- */
const handRaw = new THREE.Vector2(0, 0);
const handFiltered = new THREE.Vector2(0, 0);
const measuredHand = new THREE.Vector2(0, 0);
const cameraTarget = new THREE.Vector3(0, 0, 170);
let handDetected = false;
let lastHandSeen = 0;
let handDepth = 0.5; // Normalized hand depth (0 far, 1 close)

/* ---------------- MEDIAPIPE ---------------- */
const hands = new Hands({
  locateFile: (file) =>
    `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 1,
  minDetectionConfidence: 0.75,
  minTrackingConfidence: 0.75
});

hands.onResults((results) => {
  const landmarks = results.multiHandLandmarks;

  if (landmarks && landmarks.length > 0) {
    const lms = landmarks[0];
    const palm = lms[9];
    measuredHand.set(
      THREE.MathUtils.clamp((palm.x - 0.5) * 2, -1, 1) * 95,
      THREE.MathUtils.clamp((0.5 - palm.y) * 2, -1, 1) * 75
    );

    // Calculate hand depth based on the distance between wrist (0) and middle finger mcp (9)
    const wrist = lms[0];
    const mcp = lms[9];
    const dx = wrist.x - mcp.x;
    const dy = wrist.y - mcp.y;
    const currentDist = Math.sqrt(dx * dx + dy * dy);

    // Normalize depth: 0.1 (far) to 0.4 (close) mapped to 0-1
    const rawDepth = THREE.MathUtils.clamp((currentDist - 0.08) / 0.25, 0, 1);
    handDepth = handDepth * 0.8 + rawDepth * 0.2; // Smooth depth

    const distance = measuredHand.distanceTo(handRaw);
    if (distance < 1) {
      handRaw.lerp(measuredHand, 0.28);
    } else {
      handRaw.copy(measuredHand);
    }

    handDetected = true;
    lastHandSeen = performance.now();
  } else if (performance.now() - lastHandSeen > 180) {
    handDetected = false;
    handDepth = handDepth * 0.95; // Reset depth slowly
  }
});

/* ---------------- CAMERA FEED ---------------- */
const cam = new Camera(videoElement, {
  onFrame: async () => {
    await hands.send({ image: videoElement });
  },
  width: 640,
  height: 480
});
cam.start();

/* ---------------- ANIMATION ---------------- */
const clock = new THREE.Clock();
let lastFrame = performance.now();

function animate(now = performance.now()) {
  requestAnimationFrame(animate);

  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  const t = clock.getElapsedTime();
  material.uniforms.uTime.value = t;

  if (!handDetected) {
    handRaw.multiplyScalar(0.96);
  }

  const handSmoothing = 1 - Math.exp(-dt * (handDetected ? 15 : 6));
  handFiltered.lerp(handRaw, handSmoothing);

  // Attraction force increases as handDepth increases (hand closer)
  const forceMultiplier = 0.5 + handDepth * 4.5;

  for (let i = 0; i < DOTS; i++) {
    const idx = i * 3;
    const baseX = basePositions[idx];
    const baseY = basePositions[idx + 1];
    const baseZ = basePositions[idx + 2];
    const phase = phases[i];

    const waveX = Math.sin(t * 0.9 + phase) * 2.4;
    const waveY = Math.cos(t * 1.1 + phase * 1.4) * 2.1;
    const waveZ = Math.sin(t * 1.3 + phase * 0.8) * 2.8;

    let x = baseX + waveX;
    let y = baseY + waveY;
    let z = baseZ + waveZ;

    const dx = x - handFiltered.x;
    const dy = y - handFiltered.y;
    const dz = z;
    const distSq = dx * dx + dy * dy + dz * dz + 80;
    const force = (2400 * forceMultiplier) / distSq;

    x += dx * force;
    y += dy * force;
    z += dz * force * 0.28;

    positions[idx] = x;
    positions[idx + 1] = y;
    positions[idx + 2] = z;
  }

  geometry.attributes.position.needsUpdate = true;
  dots.rotation.y = t * 0.14 + handFiltered.x * 0.0009;
  dots.rotation.x = Math.sin(t * 0.35) * 0.22 + handFiltered.y * 0.0005;
  dots.position.z = Math.sin(t * 0.7) * 5;

  // Zoom animation: tie rhythmic zoom to handDepth for extra impact
  const baseZoom = 170 + Math.sin(t * 0.5) * 45;
  const zoomFactor = baseZoom - handDepth * 60; // Zoom in more when hand is close

  cameraTarget.set(
    handFiltered.x * 0.65,
    handFiltered.y * 0.55,
    zoomFactor + Math.sin(t * 0.45) * 8
  );
  const cameraSmoothing = 1 - Math.exp(-dt * 6);
  camera3D.position.lerp(cameraTarget, cameraSmoothing);
  camera3D.lookAt(0, 0, 0);

  renderer.render(scene, camera3D);
}

animate();

/* ---------------- RESIZE ---------------- */
window.addEventListener("resize", () => {
  camera3D.aspect = window.innerWidth / window.innerHeight;
  camera3D.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  material.uniforms.uPixelRatio.value = renderer.getPixelRatio();
});
