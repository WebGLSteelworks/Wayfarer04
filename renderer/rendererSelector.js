import { getDeviceTier } from "../utils/deviceDetection.js";

export async function selectRenderer() {
  const tier = await getDeviceTier();

  if (tier === "webgpu-high") return "webgpu";
  if (tier === "webgpu-low") return "webgpu-lite";

  return "webgl";
}