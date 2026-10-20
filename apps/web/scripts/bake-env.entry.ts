// Page module for scripts/bake-env.mjs (build time only, never bundled): renders the engine's
// RoomEnvironment PMREM exactly as the engine did at runtime and reads the CubeUV texture back.
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { ENV_SIGMA } from "../src/features/scene/three/envMap";

(window as unknown as { __bakeEnv: () => unknown }).__bakeEnv = () => {
  const canvas = document.createElement("canvas");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const rt = pmrem.fromScene(room, ENV_SIGMA);
  const { width, height } = rt;
  const data = new Uint16Array(width * height * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, width, height, data);
  const out = { width, height, type: rt.texture.type, data: Array.from(data) };
  room.dispose();
  rt.dispose();
  pmrem.dispose();
  renderer.dispose();
  return out;
};
