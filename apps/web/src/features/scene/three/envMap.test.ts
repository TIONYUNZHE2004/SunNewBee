import { existsSync, readFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  createEnvTexture,
  ENV_HEIGHT,
  ENV_URL,
  ENV_WIDTH,
  fillEnvTexture,
  loadEnvFile,
  parseEnvFile,
} from "./envMap";

/** ITER2 AC-D18: the PMREM environment is baked at build time, never rendered at page load. */
const file = (w = ENV_WIDTH, h = ENV_HEIGHT, magic = "TLEN") => {
  const head = Buffer.alloc(16);
  head.write(magic, 0, "ascii");
  head.writeUInt32LE(w, 4);
  head.writeUInt32LE(h, 8);
  head.writeUInt32LE(1, 12);
  const px = new Uint16Array(w * h * 4);
  px[0] = 15360; // 1.0 in half float
  return Buffer.concat([head, Buffer.from(px.buffer)]);
};
const ab = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

describe("baked environment", () => {
  it("the texture is PMREM's CubeUV output from the first frame (its size is a shader define)", () => {
    const t = createEnvTexture();
    expect(t.mapping).toBe(THREE.CubeUVReflectionMapping);
    expect(t.type).toBe(THREE.HalfFloatType);
    expect([t.image.width, t.image.height]).toEqual([ENV_WIDTH, ENV_HEIGHT]);
    expect(t.generateMipmaps).toBe(false);
    expect(t.minFilter).toBe(THREE.LinearFilter);
    // no pixels yet: nothing uploaded until the file arrives
    expect(t.version).toBe(0);
    fillEnvTexture(t, new Uint16Array(4));
    expect(t.version).toBe(1);
  });

  it("parses the header and refuses a wrong size or magic", () => {
    expect(parseEnvFile(ab(file()))[0]).toBe(15360);
    expect(() => parseEnvFile(ab(file(512, 512)))).toThrow();
    expect(() => parseEnvFile(ab(file(ENV_WIDTH, ENV_HEIGHT, "XXXX")))).toThrow();
  });

  it("loads the gzip file, or a body the server already decoded", async () => {
    const gz = gzipSync(file());
    const asIs = await loadEnvFile(async () => new Response(gz));
    expect(asIs[0]).toBe(15360);
    const decoded = await loadEnvFile(async () => new Response(file()));
    expect(decoded[0]).toBe(15360);
    await expect(loadEnvFile(async () => new Response("", { status: 404 }))).rejects.toThrow();
  });

  it("the committed bake matches the expected size", () => {
    const p = new URL(`../../../../public${ENV_URL}`, import.meta.url);
    expect(existsSync(p)).toBe(true);
    const px = parseEnvFile(ab(gunzipSync(readFileSync(p))));
    expect(px.length).toBe(ENV_WIDTH * ENV_HEIGHT * 4);
    expect(px.some((v) => v !== 0)).toBe(true);
  });
});
