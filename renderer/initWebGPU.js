import * as THREE from "three/webgpu";

export async function initWebGPU(canvas) {
  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: true
  });

  await renderer.init();

  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);

  return renderer;
}