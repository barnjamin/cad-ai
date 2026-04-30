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
  if (!/^OFF(\s|$)/.test(lines[0])) throw new Error('Missing OFF header');

  let cursor = 1;
  const headerLine = lines[0].slice(3).trim() || lines[cursor++];
  const [vertexCount, faceCount] = headerLine.split(/\s+/).map(Number);

  if (!Number.isFinite(vertexCount) || !Number.isFinite(faceCount)) {
    throw new Error('Invalid OFF header');
  }

  if (lines.length < cursor + vertexCount + faceCount) {
    throw new Error('OFF file truncated');
  }

  const vertices: [number, number, number][] = [];
  for (let index = 0; index < vertexCount; index += 1) {
    const [x, y, z] = lines[cursor + index].split(/\s+/).map(Number);
    vertices.push([x, y, z]);
  }
  cursor += vertexCount;

  const faces: OffFace[] = [];
  for (let index = 0; index < faceCount; index += 1) {
    const parts = lines[cursor + index].split(/\s+/).map(Number);
    const polygonSize = parts[0];
    const vertexIndexes = parts.slice(1, polygonSize + 1);
    const colorParts = parts.slice(polygonSize + 1);

    if (
      vertexIndexes.length !== polygonSize ||
      vertexIndexes.some((value) => !Number.isInteger(value) || value < 0 || value >= vertexCount)
    ) {
      continue;
    }

    const color = parseColor(colorParts);
    if (polygonSize === 3) {
      faces.push({
        vertices: [vertexIndexes[0], vertexIndexes[1], vertexIndexes[2]],
        color,
      });
      continue;
    }

    for (let fanIndex = 1; fanIndex < polygonSize - 1; fanIndex += 1) {
      faces.push({
        vertices: [vertexIndexes[0], vertexIndexes[fanIndex], vertexIndexes[fanIndex + 1]],
        color,
      });
    }
  }

  return { vertices, faces };
}

function parseColor(values: number[]): [number, number, number, number] | null {
  if (values.length >= 4) {
    return [values[0] / 255, values[1] / 255, values[2] / 255, values[3] / 255];
  }

  if (values.length >= 3) {
    return [values[0] / 255, values[1] / 255, values[2] / 255, 1];
  }

  return null;
}
