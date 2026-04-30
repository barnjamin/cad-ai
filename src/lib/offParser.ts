export type OffFace = {
  vertices: [number, number, number];
  color: [number, number, number, number] | null;
};

export type ParsedOff = {
  vertices: [number, number, number][];
  faces: OffFace[];
};

export function parseColoredOff(text: string): ParsedOff {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  if (lines.length === 0) throw new Error('Empty OFF file');

  let headerLine: string;
  let cursor = 0;
  if (/^OFF(\s|$)/.test(lines[0])) {
    const rest = lines[0].substring(3).trim();
    if (rest.length > 0) {
      headerLine = rest;
      cursor = 1;
    } else {
      headerLine = lines[1];
      cursor = 2;
    }
  } else {
    throw new Error('Missing OFF header');
  }

  const [numVertices, numFaces] = headerLine.split(/\s+/).map(Number);
  if (!Number.isFinite(numVertices) || !Number.isFinite(numFaces)) {
    throw new Error('Invalid OFF header');
  }
  if (lines.length < cursor + numVertices + numFaces) {
    throw new Error('OFF file truncated');
  }

  const vertices: [number, number, number][] = new Array(numVertices);
  for (let i = 0; i < numVertices; i++) {
    const parts = lines[cursor + i].split(/\s+/).map(Number);
    vertices[i] = [parts[0], parts[1], parts[2]];
  }
  cursor += numVertices;

  const faces: OffFace[] = [];
  for (let i = 0; i < numFaces; i++) {
    const parts = lines[cursor + i].split(/\s+/).map(Number);
    const n = parts[0];
    const verts = parts.slice(1, n + 1);
    const trailing = parts.slice(n + 1);
    let color: [number, number, number, number] | null = null;
    if (trailing.length >= 4) {
      color = [
        trailing[0] / 255,
        trailing[1] / 255,
        trailing[2] / 255,
        trailing[3] / 255,
      ];
    } else if (trailing.length >= 3) {
      color = [trailing[0] / 255, trailing[1] / 255, trailing[2] / 255, 1];
    }

    if (
      verts.length !== n ||
      verts.some((v) => !Number.isInteger(v) || v < 0 || v >= numVertices)
    ) {
      continue;
    }

    if (n === 3) {
      faces.push({ vertices: [verts[0], verts[1], verts[2]], color });
    } else if (n > 3) {
      for (let j = 1; j < n - 1; j++) {
        faces.push({ vertices: [verts[0], verts[j], verts[j + 1]], color });
      }
    }
  }

  return { vertices, faces };
}
