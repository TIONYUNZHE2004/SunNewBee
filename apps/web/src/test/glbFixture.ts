/** Builds tiny uncompressed glb files in memory (no meshopt) for tests. */
export interface FixtureNode {
  name: string;
  translation?: [number, number, number];
  /** Flat xyz triples; defaults to one triangle. */
  positions?: number[];
  /** Omit COLOR_0 entirely. */
  noColor?: boolean;
}

const TRI = [0, 0, 0, 1, 0, 0, 0, 1, 0];

function pad4(n: number): number {
  return (n + 3) & ~3;
}

export function makeGlb(nodes: FixtureNode[]): ArrayBuffer {
  const chunks: Float32Array[] = [];
  const bufferViews: unknown[] = [];
  const accessors: unknown[] = [];
  const meshes: unknown[] = [];
  const gltfNodes: unknown[] = [];
  let offset = 0;

  const addAccessor = (data: number[], type: string, min?: number[], max?: number[]): number => {
    const arr = new Float32Array(data);
    chunks.push(arr);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: arr.byteLength, target: 34962 });
    offset += arr.byteLength;
    accessors.push({
      bufferView: bufferViews.length - 1,
      componentType: 5126,
      count: data.length / (type === "VEC4" ? 4 : 3),
      type,
      ...(min ? { min, max } : {}),
    });
    return accessors.length - 1;
  };

  nodes.forEach((n, i) => {
    const pos = n.positions ?? TRI;
    const verts = pos.length / 3;
    const mins = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
    const maxs = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (let v = 0; v < verts; v++)
      for (let k = 0; k < 3; k++) {
        mins[k] = Math.min(mins[k] as number, pos[v * 3 + k] as number);
        maxs[k] = Math.max(maxs[k] as number, pos[v * 3 + k] as number);
      }
    const attributes: Record<string, number> = {
      POSITION: addAccessor(pos, "VEC3", mins, maxs),
      NORMAL: addAccessor(Array.from({ length: verts }, () => [0, 0, 1]).flat(), "VEC3"),
    };
    if (!n.noColor)
      attributes.COLOR_0 = addAccessor(
        Array.from({ length: verts }, () => [1, 0, 0.5, 1]).flat(),
        "VEC4",
      );
    meshes.push({ primitives: [{ attributes, material: 0 }] });
    gltfNodes.push({
      name: n.name,
      mesh: i,
      ...(n.translation ? { translation: n.translation } : {}),
    });
  });

  const json = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: gltfNodes.map((_, i) => i) }],
    nodes: gltfNodes,
    meshes,
    materials: [{ name: "tl_role" }],
    accessors,
    bufferViews,
    buffers: [{ byteLength: offset }],
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = pad4(jsonBytes.length);
  const binLen = pad4(offset);
  const total = 12 + 8 + jsonLen + 8 + binLen;
  const out = new ArrayBuffer(total);
  const dv = new DataView(out);
  const u8 = new Uint8Array(out);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true);
  dv.setUint32(16, 0x4e4f534a, true);
  u8.fill(0x20, 20, 20 + jsonLen);
  u8.set(jsonBytes, 20);
  const binHead = 20 + jsonLen;
  dv.setUint32(binHead, binLen, true);
  dv.setUint32(binHead + 4, 0x004e4942, true);
  let p = binHead + 8;
  for (const c of chunks) {
    u8.set(new Uint8Array(c.buffer, c.byteOffset, c.byteLength), p);
    p += c.byteLength;
  }
  return out;
}
