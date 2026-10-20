import * as THREE from "three";

/**
 * The scene environment (image-based light on the clay), baked at build time (ITER2 AC-D18).
 *
 * At runtime the engine used to render `RoomEnvironment` through `PMREMGenerator.fromScene(room,
 * ENV_SIGMA)` in its first frame: linking the PMREM convolution shaders waited 434-814 ms. The same
 * PMREM output (the CubeUV texture, RGBA half floats) is now baked by `scripts/bake-env.mjs` with
 * this three version and these parameters, into `public/city/env/room-pmrem.bin.gz`, and the
 * engine uploads it as a data texture: the same pixels, so the same look, and no PMREM programs.
 *
 * The texture exists from the engine's first frame with its final size (the CubeUV size is a
 * shader define, so materials compile once with the right variant); its pixels arrive with the
 * file. If the file cannot be loaded the engine falls back to the runtime PMREM, whose texture has
 * the same size (so nothing recompiles).
 */
export const ENV_SIGMA = 0.04;
/** CubeUV size of PMREMGenerator.fromScene at its default 256 cube size: 3 x 256 by 4 x 256. */
export const ENV_WIDTH = 768;
export const ENV_HEIGHT = 1024;
export const ENV_URL = "/city/env/room-pmrem.bin.gz";
const MAGIC = "TLEN";
const HEADER_BYTES = 16;

/** The environment texture with no pixels yet (they arrive with `fillEnvTexture`). */
export function createEnvTexture(): THREE.DataTexture {
  const t = new THREE.DataTexture(
    null,
    ENV_WIDTH,
    ENV_HEIGHT,
    THREE.RGBAFormat,
    THREE.HalfFloatType,
  );
  // CubeUV: as PMREMGenerator's output (the types list only the public mappings)
  t.mapping = THREE.CubeUVReflectionMapping as unknown as THREE.Mapping;
  // as PMREMGenerator's render target texture
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.flipY = false;
  t.colorSpace = THREE.LinearSRGBColorSpace;
  t.name = "tl-env-baked";
  return t;
}

/** The half-float pixels of a baked file (header checked: magic, size, version 1). */
export function parseEnvFile(buf: ArrayBuffer): Uint16Array {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  const w = dv.getUint32(4, true);
  const h = dv.getUint32(8, true);
  const version = dv.getUint32(12, true);
  if (magic !== MAGIC || w !== ENV_WIDTH || h !== ENV_HEIGHT || version !== 1)
    throw new Error(`environment file: ${magic} ${w}x${h} v${version}`);
  const n = w * h * 4;
  if (buf.byteLength < HEADER_BYTES + n * 2) throw new Error("environment file: truncated");
  return new Uint16Array(buf, HEADER_BYTES, n);
}

/** Gives the texture its pixels (uploaded with the next frame). */
export function fillEnvTexture(t: THREE.DataTexture, pixels: Uint16Array): void {
  t.image.data = pixels;
  t.needsUpdate = true;
}

/** Fetches the baked file and gunzips it (unless the server already did: Content-Encoding). */
export async function loadEnvFile(
  fetchFn: (url: string) => Promise<Response> = (u) => fetch(u),
): Promise<Uint16Array> {
  const res = await fetchFn(ENV_URL);
  if (!res.ok) throw new Error(`environment file: HTTP ${res.status}`);
  const raw = await res.arrayBuffer();
  const b = new Uint8Array(raw, 0, Math.min(2, raw.byteLength));
  if (b[0] !== 0x1f || b[1] !== 0x8b) return parseEnvFile(raw);
  const plain = new Blob([raw]).stream().pipeThrough(new DecompressionStream("gzip"));
  return parseEnvFile(await new Response(plain).arrayBuffer());
}
