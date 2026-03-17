export async function isWebGPUSupported() {
  if (!navigator.gpu) return false;

  try {
    const adapter = await navigator.gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

export async function getDeviceTier() {
  if (!navigator.gpu) return "webgl";

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return "webgl";

  const limits = adapter.limits;

  if (limits.maxTextureDimension2D >= 8192) {
    return "webgpu-high";
  }

  return "webgpu-low";
}