export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const valA = a[i] as number;
    const valB = b[i] as number;
    dotProduct += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) {
    return 0;
  }

  return dotProduct / denominator;
}

export function vectorToBlob(vec: number[] | Float32Array): Uint8Array {
  const arr = vec instanceof Float32Array ? vec : new Float32Array(vec);
  return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
}

export function blobToVector(blob: Uint8Array | Buffer): Float32Array {
  const arrayBuffer = blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength);
  return new Float32Array(arrayBuffer);
}
