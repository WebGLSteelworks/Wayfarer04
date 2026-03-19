import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.176.0/+esm';
import { WebGPURenderer } from 'https://cdn.jsdelivr.net/npm/three@0.176.0/webgpu/+esm';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.176.0/examples/jsm/controls/OrbitControls.js/+esm';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.176.0/examples/jsm/loaders/GLTFLoader.js/+esm';
import { EXRLoader } from 'https://cdn.jsdelivr.net/npm/three@0.176.0/examples/jsm/loaders/EXRLoader.js/+esm';

import { CAMERAS } from './utils/cameras.js';

async function isWebGPUSupported() {
  if (!navigator.gpu) return false;

  try {
    const adapter = await navigator.gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────
// GLOBAL VAR
// ─────────────────────────────────────────────

let scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);
const textureLoader = new THREE.TextureLoader();

const cameras = {};

const clock = new THREE.Clock();

let fps = 0;
let frames = 0;
let lastTime = performance.now();
let renderMode = 'auto'; // 'auto' | 'webgpu' | 'webgl'
let isRendererReady = false;
let animationId = null;

let currentConfig = {

  glbLow: './models/Standard_Wayfarer_loow.glb',
  glbHigh: './models/Standard_Wayfarer_high.glb',

  startCamera: 'Cam_Front',

  glass: {
    animate: false
  },

};

let currentModel = null;
let gltfData = null;
let variantsExtension = null;
const loader = new GLTFLoader();


let glassAnimationEnabled = true;
let activeCameraName = null;
let glassAnimateCamera = null;
let wasAnimatingGlass = false;


// ─────────────────────────────
// SELECT VARIANT
// ─────────────────────────────

function selectVariant(scene, variantName) {

  scene.traverse((obj) => {

    if (!obj.isMesh) return;

    const ext = obj.userData.gltfExtensions?.KHR_materials_variants;
    if (!ext) return;

    ext.mappings.forEach((map) => {

      map.variants.forEach((variantIndex) => {

        const variant = variantsExtension.variants[variantIndex];

        if (variant.name === variantName) {

          gltfData.parser.getDependency('material', map.material)
            .then((material) => {

              obj.material = material;

            });

        }

      });

    });

  });

}

// ─────────────────────────────
// UI FOR MODEL SELECTION
// ─────────────────────────────


function createVariantButtons(variants) {

  // borrar UI anterior
  const old = document.getElementById("variantsUI");
  if (old) old.remove();

  const container = document.createElement("div");
  container.id = "variantsUI";

  container.style.position = "fixed";
  container.style.right = "20px";
  container.style.top = "20px";
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.gap = "8px";
  container.style.zIndex = "20";

  document.body.appendChild(container);

  variants.forEach(v => {

    const btn = document.createElement("button");

    btn.textContent = v.name;

    btn.style.padding = "8px 12px";
    btn.style.border = "none";
    btn.style.borderRadius = "6px";
    btn.style.cursor = "pointer";
    btn.style.background = "#111";
    btn.style.color = "#fff";
    btn.style.fontSize = "12px";

	btn.onclick = () => {

	  if (!currentModel) return;

	  selectVariant(currentModel, v.name);

	};

    container.appendChild(btn);

  });

}



// ─────────────────────────────
// LOAD GLB MODEL
// ─────────────────────────────

function loadModel(config) {
	
  glassAnimationEnabled = config.glass?.animate === true;
  glassAnimateCamera = config.glass?.animateCamera || null;


  // ───── clean last model
  if (currentModel) {
    scene.remove(currentModel);
	const isWebGPU = renderer.isWebGPURenderer;

	currentModel.traverse(obj => {

	  if (obj.geometry) obj.geometry.dispose();

	  // ⚠️ SOLO WebGL
	  if (!isWebGPU && obj.material) {

		if (Array.isArray(obj.material)) {
		  obj.material.forEach(m => m.dispose());
		} else {
		  obj.material.dispose();
		}
	  }

	});
  }

  // state reset
  glassMaterials.length = 0;
  originalGlassColors.length = 0;
  armsTextMeshes.length = 0;
  glassAnim.state = 'waitGreen';
  glassAnim.timer = 0;
  Object.keys(cameraTargets).forEach(k => delete cameraTargets[k]);

	const isWebGPU = renderer.isWebGPURenderer;

	const modelPath = isWebGPU
	  ? config.glbHigh
	  : config.glbLow;

	console.log("Loading model:", modelPath);


  loader.load(modelPath, (gltf) => {

    gltfData = gltf;
	currentModel = gltf.scene;
	
    scene.add(currentModel);
	
	// ───── get variants from GLB
	variantsExtension = gltf.userData.gltfExtensions?.KHR_materials_variants;

	if (variantsExtension) {

	  const variants = variantsExtension.variants;
	  createVariantButtons(variants);
	  
	  if (variants.length > 0) {
		  selectVariant(currentModel, variants[0].name);
		}

	}
	
	// ───── calculate model pivot
	const box = new THREE.Box3().setFromObject(currentModel);
	const modelCenter = new THREE.Vector3();
	box.getCenter(modelCenter);


	// ───── load cameras from file
	Object.entries(CAMERAS).forEach(([name, cam]) => {

	  cameraTargets[name] = {

		position: new THREE.Vector3(...cam.position),

		quaternion: cam.quaternion
		  ? new THREE.Quaternion(...cam.quaternion)
		  : new THREE.Quaternion(),

		target: modelCenter.clone(),

		fov: cam.fov

	  };

	});

	currentModel.traverse(obj => {

	  if (!obj.isMesh) return;

	  const mat = obj.material;
	  if (!mat) return;

	  const isWebGPU = renderer.isWebGPURenderer;

	  // 🔥 REFLECTION BOOST 
	  if (mat.envMapIntensity !== undefined) {
		mat.envMapIntensity *= isWebGPU ? 1.5 : 1.0;
	  }

	  // 🔥 MICRO ROUGHNESS ADJ
	  if (mat.roughness !== undefined) {
		mat.roughness *= 0.95;
	  }

	});

    // load starting camera
    smoothSwitchCamera(config.startCamera);

  });
}


// ─────────────────────────────
// GLASS ANIMATION
// ─────────────────────────────
const glassAnim = {
  state: 'waitGreen',
  timer: 0,

  duration: 1.5,
  waitGreen: 1.0,
  waitClear: 1.0
};


// ─────────────────────────────
// GLASS MAT (GLOBAL)
// ─────────────────────────────
const glassMaterials = [];
let armsTextMeshes = [];
const originalGlassColors = [];
const originalGlassOpacities = [];



// ─────────────────────────────────────────────
// CAMERAS
// ─────────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(
  80,
  window.innerWidth / window.innerHeight,
  0.01,
  1000
);

const cameraTargets = {};
let pendingFreeCamera = false;



// ─────────────────────────────────────────────
// ACTIVE CAMERA + TRANSITION STATE
// ─────────────────────────────────────────────

let transition = {
  active: false,
  startTime: 0,
  duration: 0.8,
  fromPos: new THREE.Vector3(),
  toPos: new THREE.Vector3(),
  fromQuat: new THREE.Quaternion(),
  toQuat: new THREE.Quaternion()
};



// ─────────────────────────────────────────────
// RENDERER
// ─────────────────────────────────────────────
let renderer;

async function initRenderer() {
	
  isRendererReady = false;

  let useWebGPU;

	if (renderMode === 'webgpu') {
	  useWebGPU = true;

	} else if (renderMode === 'webgl') {
	  useWebGPU = false;

	} else {
	  useWebGPU = await isWebGPUSupported();
	}

  if (useWebGPU) {
    console.log("🚀 Using WebGPU");
    rendererLabel.textContent = `Renderer: WebGPU | DPR: ${window.devicePixelRatio}`;

    renderer = new WebGPURenderer({
      antialias: true
    });

    await renderer.init();

  } else {
    console.log("⚠ Using WebGL");
    rendererLabel.textContent = `Renderer: WebGL | ${window.innerWidth}x${window.innerHeight}`;

    renderer = new THREE.WebGLRenderer({
      antialias: true
    });
  }

  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.physicallyCorrectLights = true;

  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.3;

  document.body.appendChild(renderer.domElement);
  
  isRendererReady = true;
}


async function restartApp() {
	
  if (animationId) {
	  cancelAnimationFrame(animationId);
	  animationId = null;
	}	

  console.log("Restarting app with mode:", renderMode);

  // 🧹 clean renderer 
  if (renderer) {
    renderer.dispose();
    renderer.domElement.remove();
  }

  // 🧹 clean model
	if (currentModel) {
	  scene.remove(currentModel);
	  currentModel = null;
	}

  // 🧹 reset scene 
  scene = new THREE.Scene();

  await initRenderer();

  const isWebGPU = renderer.isWebGPURenderer;

	scene.background = new THREE.Color(
	  isWebGPU ? 0xffffff : 0xcccccc
	);

	// ambient LIGHTING
	scene.add(new THREE.AmbientLight(0xffffff, 5.0));

  // 🎮 controls 
  controls = new OrbitControls(camera, renderer.domElement);

  controls.enabled = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enableRotate = true;
  controls.enableZoom = true;
  controls.enablePan = false;
  controls.minDistance = 0.5;
  controls.maxDistance = 1.2;

  setupEnvironment();
  loadModel(currentConfig);
  animate();
}

// ─────────────────────────────────────────────
// CONTROLS
// ─────────────────────────────────────────────
let controls;

// ─────────────────────────────────────────────
// AMBIENT LIGHTING
// ─────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0xffffff, 5.0));

// ─────────────────────────────────────────────
// ENVIRONMENT
// ─────────────────────────────────────────────
function setupEnvironment() {

	new EXRLoader().load('./studio.exr', (hdr) => {

	  hdr.mapping = THREE.EquirectangularReflectionMapping;

	  if (renderer.isWebGPURenderer) {

		// ✅ WebGPU → usar directamente
		scene.environment = hdr;

	  } else {

		// ✅ WebGL → usar PMREM
		const pmrem = new THREE.PMREMGenerator(renderer);
		pmrem.compileEquirectangularShader();

		const envMap = pmrem.fromEquirectangular(hdr).texture;
		scene.environment = envMap;

		pmrem.dispose();
		hdr.dispose();
	  }

	  scene.environmentRotation = new THREE.Euler(0, Math.PI * 0, 0);
	  scene.environmentIntensity = 6.0;

	});
}
// ─────────────────────────────────────────────
// SMOOTH SWITCH CAMERAS
// ─────────────────────────────────────────────

function smoothSwitchCamera(name) {
  activeCameraName = name;

  const camData = cameraTargets[name];
  if (!camData) return;

  // ───── CAM_FREE (NO TRANSITION)
  if (name === 'Cam_Free') {

    transition.active = false;

    camera.position.copy(camData.position);
    controls.target.copy(camData.target);

    camera.lookAt(controls.target);
    camera.updateMatrixWorld();

    controls.update();
    controls.enabled = true;

    return;
  }

  // ───── CAMERA TRANSITION
  controls.enabled = false; 
  
  if (camData.fov !== undefined) {
    camera.fov = camData.fov;
    camera.updateProjectionMatrix();
  }

	transition.fromPos.copy(camera.position);
	transition.fromQuat.copy(camera.quaternion);

	transition.toPos.copy(camData.position);
	transition.toQuat.copy(camData.quaternion);

  transition.startTime = performance.now();
  transition.active = true;
}


// ─────────────────────────────────────────────
// RESIZE
// ─────────────────────────────────────────────
window.addEventListener('resize', () => {

  if (!renderer) return;

  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ─────────────────────────────────────────────
// LOOP ANIMATE
// ─────────────────────────────────────────────
function animate(time) {
	
	frames++;

	if (time > lastTime + 1000) {
	  fps = Math.round((frames * 1000) / (time - lastTime));
	  lastTime = time;
	  frames = 0;

	  fpsLabel.textContent = `FPS: ${fps}`;
	}
  animationId = requestAnimationFrame(animate);

  // ─────────────────────────────────────────
  // CAMERA TRANSITIONS (Still Cameras)
  // ─────────────────────────────────────────
  if (transition.active) {

    const elapsed = (time - transition.startTime) / 1000;
    const t = Math.min(elapsed / transition.duration, 1);
    const ease = t * t * (3 - 2 * t);

    camera.position.lerpVectors(
      transition.fromPos,
      transition.toPos,
      ease
    );

    if (activeCameraName !== 'Cam_Free') {
      camera.quaternion
        .copy(transition.fromQuat)
        .slerp(transition.toQuat, ease);
    }

    if (t >= 1) {
      transition.active = false;
    }
  }

  // ─────────────────────────────────────────
  // ORBIT CONTROLS (only Cam_Free)
  // ─────────────────────────────────────────
  if (controls.enabled) {
    controls.update();
  }

  // ─────────────────────────────────────────
  // GLASS ANIMATION (controlled by config)
  // ─────────────────────────────────────────
  
  const shouldAnimateGlass =
    glassAnimationEnabled &&
    glassMaterials.length > 0 &&
    activeCameraName === glassAnimateCamera;

  if (shouldAnimateGlass) {

    wasAnimatingGlass = true;

    const delta = clock.getDelta();
    glassAnim.timer += delta;

    glassMaterials.forEach((mat, i) => {

      const originalColor = originalGlassColors[i];

      switch (glassAnim.state) {

        case 'waitGreen':
          if (glassAnim.timer > glassAnim.waitGreen) {
            glassAnim.timer = 0;
            glassAnim.state = 'toClear';
          }
          break;

        case 'toClear': {
          const t = Math.min(glassAnim.timer / glassAnim.duration, 1);
          const ease = t * t * (3 - 2 * t);

          mat.color.lerpColors(
            originalColor,
            new THREE.Color(1, 1, 1),
            ease
          );

		  mat.opacity = THREE.MathUtils.lerp(
			originalGlassOpacities[i],
			0.0,
			ease
		  );

          if (t >= 1) {
            glassAnim.timer = 0;
            glassAnim.state = 'waitClear';
          }
          break;
        }

        case 'waitClear':
          if (glassAnim.timer > glassAnim.waitClear) {
            glassAnim.timer = 0;
            glassAnim.state = 'toGreen';
          }
          break;

        case 'toGreen': {
          const t = Math.min(glassAnim.timer / glassAnim.duration, 1);
          const ease = t * t * (3 - 2 * t);

          mat.color.lerpColors(
            new THREE.Color(1, 1, 1),
            originalColor,
            ease
          );

		  mat.opacity = THREE.MathUtils.lerp(
			0.0,
			originalGlassOpacities[i],
			ease
		  );


          if (t >= 1) {
            glassAnim.timer = 0;
            glassAnim.state = 'waitGreen';
          }
          break;
        }
      }
    });

  } else {

    // Reset ONLY when leave animate
    if (wasAnimatingGlass) {
      glassMaterials.forEach((mat, i) => {
        mat.color.copy(originalGlassColors[i]);
		mat.opacity = originalGlassOpacities[i];
      });

      glassAnim.state = 'waitGreen';
      glassAnim.timer = 0;
      wasAnimatingGlass = false;
    }
  }

  // ─────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────
  
	if (!isRendererReady) return;

	if (renderer.isWebGPURenderer) {
	  renderer.renderAsync(scene, camera);
	} else {
	  renderer.render(scene, camera);
	}
	}

// ─────────────────────────────────────────────
// CAMERA BUTTONS UI
// ─────────────────────────────────────────────
const ui = document.createElement('div');
ui.style.position = 'fixed';
ui.style.bottom = '20px';
ui.style.left = '50%';
ui.style.transform = 'translateX(-50%)';
ui.style.display = 'flex';
ui.style.gap = '10px';
ui.style.zIndex = '10';

document.body.appendChild(ui);

const cameraButtons = [
  { label: 'Front', name: 'Cam_Front' },
  { label: 'Side', name: 'Cam_Side' },
  { label: 'Camera', name: 'Cam_Camera' },
  { label: 'Capture', name: 'Cam_Capture' },
  { label: 'Power', name: 'Cam_Power' },
  { label: 'Lenses', name: 'Cam_Lenses' },
  { label: 'Free', name: 'Cam_Free' }
];

cameraButtons.forEach(({ label, name }) => {
  const btn = document.createElement('button');
  btn.textContent = label;

  btn.style.padding = '8px 14px';
  btn.style.border = 'none';
  btn.style.borderRadius = '6px';
  btn.style.cursor = 'pointer';
  btn.style.background = '#111';
  btn.style.color = '#fff';
  btn.style.fontSize = '13px';

  btn.addEventListener('click', () => smoothSwitchCamera(name));
  ui.appendChild(btn);
});

const rendererLabel = document.createElement('div');

rendererLabel.style.position = 'fixed';
rendererLabel.style.top = '20px';
rendererLabel.style.left = '20px';
rendererLabel.style.padding = '6px 10px';
rendererLabel.style.background = 'rgba(0,0,0,0.7)';
rendererLabel.style.color = '#fff';
rendererLabel.style.fontSize = '12px';
rendererLabel.style.fontFamily = 'monospace';
rendererLabel.style.borderRadius = '4px';
rendererLabel.style.zIndex = '100';

rendererLabel.textContent = 'Renderer: detecting...';

const fpsLabel = document.createElement('div');

fpsLabel.style.position = 'fixed';
fpsLabel.style.top = '50px';
fpsLabel.style.left = '20px';
fpsLabel.style.padding = '6px 10px';
fpsLabel.style.background = 'rgba(0,0,0,0.7)';
fpsLabel.style.color = '#0f0';
fpsLabel.style.fontSize = '12px';
fpsLabel.style.fontFamily = 'monospace';
fpsLabel.style.borderRadius = '4px';
fpsLabel.style.zIndex = '100';

fpsLabel.textContent = 'FPS: --';

document.body.appendChild(fpsLabel);

document.body.appendChild(rendererLabel);

const modeUI = document.createElement('div');

modeUI.style.position = 'fixed';
modeUI.style.top = '90px';
modeUI.style.left = '20px';
modeUI.style.display = 'flex';
modeUI.style.gap = '6px';
modeUI.style.zIndex = '100';

document.body.appendChild(modeUI);

const modes = [
  { label: 'AUTO', value: 'auto' },
  { label: 'WEBGPU', value: 'webgpu' },
  { label: 'WEBGL', value: 'webgl' }
];

modes.forEach(({ label, value }) => {

  const btn = document.createElement('button');
  btn.textContent = label;

  btn.style.padding = '6px 10px';
  btn.style.border = 'none';
  btn.style.borderRadius = '4px';
  btn.style.cursor = 'pointer';
  btn.style.background = '#222';
  btn.style.color = '#fff';
  btn.style.fontSize = '11px';

  btn.onclick = async () => {
    renderMode = value;
    await restartApp();
  };

  modeUI.appendChild(btn);
});

async function init() {
  await initRenderer();
  
  const isWebGPU = renderer.isWebGPURenderer;

	// 🎨 background color
	scene.background = new THREE.Color(
	  isWebGPU ? 0xffffff : 0x000000
	);

  // CONTROLS (ahora que renderer existe)
  controls = new OrbitControls(camera, renderer.domElement);

  controls.enabled = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enableRotate = true;
  controls.enableZoom = true;
  controls.enablePan = false;
  controls.minDistance = 0.5;
  controls.maxDistance = 1.2;

  // ENVIRONMENT (IMPORTANTE → depende de renderer)
  setupEnvironment();

  loadModel(currentConfig);
  animate();
}

init();




















