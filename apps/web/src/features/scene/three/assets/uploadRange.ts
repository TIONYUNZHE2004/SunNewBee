import type * as THREE from "three";

/**
 * Marks only the first `count` items of an instance attribute for upload (ITER2 AC-D18: a LOD
 * re-bucket at the dive start re-uploaded whole 128 KB instance buffers, 2048 slots x 64 B, while
 * the GPU was backed up, and the main thread blocked 234-358 ms in `bufferSubData`). The drawn
 * instances are always packed at the front, so the rest of the buffer is never read. With no item
 * drawn nothing is uploaded at all.
 */
export function markUsed(attr: THREE.BufferAttribute, count: number): void {
  attr.clearUpdateRanges();
  if (count <= 0) return;
  attr.addUpdateRange(0, Math.min(count, attr.count) * attr.itemSize);
  attr.needsUpdate = true;
}
