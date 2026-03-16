import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.176.0/+esm';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.176.0/examples/jsm/controls/OrbitControls.js/+esm';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.176.0/examples/jsm/loaders/GLTFLoader.js/+esm';
import { EXRLoader } from 'https://cdn.jsdelivr.net/npm/three@0.176.0/examples/jsm/loaders/EXRLoader.js/+esm';

import { CAMERAS } from './configs/cameras.js';

// ─────────────────────────────────────────────
// GLOBAL VAR
// ─────────────────────────────────────────────

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf2f2f2); 

const textureLoader = new THREE.TextureLoader();

const cameras = {};

const clock = new THREE.Clock();

let currentConfig = {
  glb: './models/Standard_Wayfarer.glb',
  
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
// POSTPRODUCTION FOR MORE CONTRAST
// ─────────────────────────────

const ContrastShader = {
  uniforms: {
    tDiffuse: { value: null },
    contrast: { value: 1.0 } // 1.0 = neutro
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float contrast;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      color.rgb = (color.rgb - 0.5) * contrast + 0.5;
      gl_FragColor = color;
    }
  `
};


// ─────────────────────────────
// LOAD GLB MODEL
// ─────────────────────────────

function loadModel(config) {
	
  glassAnimationEnabled = config.glass?.animate === true;
  glassAnimateCamera = config.glass?.animateCamera || null;


  // ───── clean last model
  if (currentModel) {
    scene.remove(currentModel);
    currentModel.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
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

  loader.load(config.glb, (gltf) => {

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
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.physicallyCorrectLights = true;

renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.25;

document.body.appendChild(renderer.domElement);


// ─────────────────────────────────────────────
// CONTROLS
// ─────────────────────────────────────────────
const controls = new OrbitControls(camera, renderer.domElement);
controls.enabled = false; 

controls.enableDamping = true;
controls.dampingFactor = 0.08;

controls.enableRotate = true;
controls.enableZoom = true;
controls.enablePan = false;

controls.minDistance = 0.5;
controls.maxDistance = 1.2;


// ─────────────────────────────────────────────
// AMBIENT LIGHTING
// ─────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0xffffff, 5.0));

// ─────────────────────────────────────────────
// ENVIRONMENT
// ─────────────────────────────────────────────
const pmrem = new THREE.PMREMGenerator(renderer);

new EXRLoader().load('./studio.exr', (hdr) => {
	
  hdr.mapping = THREE.EquirectangularReflectionMapping;

  const tempScene = new THREE.Scene();

  const saturation = 0.0; // remove color from HDRI

  const material = new THREE.ShaderMaterial({
    uniforms: {
      tMap: { value: hdr },
	  saturation: { value: saturation },
	  contrast: { value: 2.15 } 
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tMap;
      uniform float saturation;
	  uniform float contrast;
      varying vec2 vUv;

      void main() {
        vec4 color = texture2D(tMap, vUv);

        float luminance = dot(color.rgb, vec3(0.299, 0.587, 0.114));
        vec3 grey = vec3(luminance);

        color.rgb = mix(grey, color.rgb, saturation);
		
		color.rgb = (color.rgb - 0.5) * contrast + 0.5;

        gl_FragColor = color;
      }
    `,
    side: THREE.DoubleSide
  });

  const quad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    material
  );

  tempScene.add(quad);

  const renderTarget = new THREE.WebGLRenderTarget(
    hdr.image.width,
    hdr.image.height
  );

  renderer.setRenderTarget(renderTarget);
  renderer.render(tempScene, new THREE.Camera());
  renderer.setRenderTarget(null);

  const processedEnvMap = pmrem.fromEquirectangular(renderTarget.texture).texture;

  scene.environment = processedEnvMap;
  scene.environmentRotation = new THREE.Euler(0, Math.PI * 0.5, 0);
  scene.environmentIntensity = 7.5;

  hdr.dispose();
  renderTarget.dispose();
});



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
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ─────────────────────────────────────────────
// LOOP ANIMATE
// ─────────────────────────────────────────────
function animate(time) {
  requestAnimationFrame(animate);

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
  renderer.render(scene, camera);
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


loadModel(currentConfig);
animate();




















