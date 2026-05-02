import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import type { RenderResult, RenderedView } from '../core/types.ts';
import { compileOpenScad } from './compileOpenScad.ts';
import { hashProgram } from './hashProgram.ts';

const IMAGE_SIZE = 512;
const VIEW_PADDING = 0.12;
const BACKGROUND = { r: 248, g: 250, b: 252, a: 255 };

type Vec3 = {
  x: number;
  y: number;
  z: number;
};

type Vec2 = {
  x: number;
  y: number;
};

type Triangle = [Vec3, Vec3, Vec3];

type CameraBasis = {
  right: Vec3;
  up: Vec3;
  depth: Vec3;
};

type ViewSpec = {
  name: RenderedView['name'];
  depth: Vec3;
  nominalUp: Vec3;
};

type CameraTriangle = {
  points: [Vec3, Vec3, Vec3];
  shade: number;
};

const VIEW_SPECS: ViewSpec[] = [
  { name: 'front', depth: { x: 0, y: 1, z: 0 }, nominalUp: { x: 0, y: 0, z: 1 } },
  { name: 'top', depth: { x: 0, y: 0, z: 1 }, nominalUp: { x: 0, y: -1, z: 0 } },
  { name: 'right', depth: { x: 1, y: 0, z: 0 }, nominalUp: { x: 0, y: 0, z: 1 } },
  { name: 'iso', depth: normalize({ x: 1.2, y: -1, z: 0.9 }), nominalUp: { x: 0, y: 0, z: 1 } },
];

const CRC_TABLE = buildCrcTable();

export async function renderViews(args: { code: string; cwd: string; stlPath?: string }): Promise<RenderResult> {
  const artifactDir = path.join(args.cwd, '.artifacts');
  const codeHash = hashProgram(args.code);
  let stlPath = args.stlPath ?? path.join(artifactDir, `${codeHash}.stl`);

  await fs.mkdir(artifactDir, { recursive: true });

  if (!(await fileExists(stlPath))) {
    const compile = await compileOpenScad({ code: args.code, cwd: args.cwd });
    if (!compile.ok || !compile.outputPath) {
      return {
        ok: false,
        available: compile.available,
        summary: 'Preview image generation could not produce a mesh artifact from the bundled OpenSCAD WASM compiler.',
        views: [],
        stderr: compile.stderr,
      };
    }

    stlPath = compile.outputPath;
  }

  try {
    const triangles = parseStl(await fs.readFile(stlPath));
    if (triangles.length === 0) {
      return {
        ok: false,
        available: true,
        summary: 'Preview image generation found no triangles in the compiled mesh artifact.',
        views: [],
        stderr: ['renderViews: compiled STL contained zero triangles'],
      };
    }

    const normalizedTriangles = normalizeTriangles(triangles);
    const views: RenderedView[] = [];

    for (const viewSpec of VIEW_SPECS) {
      const imagePath = path.join(artifactDir, `${codeHash}.${viewSpec.name}.png`);
      const png = renderPng(normalizedTriangles, viewSpec, IMAGE_SIZE);
      await fs.writeFile(imagePath, png);
      views.push({ name: viewSpec.name, imagePath });
    }

    return {
      ok: true,
      available: true,
      summary: `Rendered ${views.length} preview view(s) from the WASM-generated mesh artifact.`,
      views,
      stderr: [],
    };
  } catch (error) {
    return {
      ok: false,
      available: true,
      summary: 'Preview image generation from the WASM-generated mesh artifact failed.',
      views: [],
      stderr: [error instanceof Error ? error.message : 'Unknown render error'],
    };
  }
}

async function fileExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function parseStl(buffer: Buffer): Triangle[] {
  if (looksLikeBinaryStl(buffer)) {
    return parseBinaryStl(buffer);
  }

  return parseAsciiStl(buffer.toString('utf8'));
}

function looksLikeBinaryStl(buffer: Buffer) {
  if (buffer.length < 84) return false;
  const triangleCount = buffer.readUInt32LE(80);
  return 84 + triangleCount * 50 === buffer.length;
}

function parseBinaryStl(buffer: Buffer): Triangle[] {
  const triangleCount = buffer.readUInt32LE(80);
  const triangles: Triangle[] = [];
  let offset = 84;

  for (let index = 0; index < triangleCount; index += 1) {
    offset += 12;
    const v0 = readVec3(buffer, offset);
    const v1 = readVec3(buffer, offset + 12);
    const v2 = readVec3(buffer, offset + 24);
    triangles.push([v0, v1, v2]);
    offset += 38;
  }

  return triangles;
}

function parseAsciiStl(source: string): Triangle[] {
  const matches = [...source.matchAll(/vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g)];
  const triangles: Triangle[] = [];

  for (let index = 0; index + 2 < matches.length; index += 3) {
    triangles.push([
      {
        x: Number(matches[index][1]),
        y: Number(matches[index][2]),
        z: Number(matches[index][3]),
      },
      {
        x: Number(matches[index + 1][1]),
        y: Number(matches[index + 1][2]),
        z: Number(matches[index + 1][3]),
      },
      {
        x: Number(matches[index + 2][1]),
        y: Number(matches[index + 2][2]),
        z: Number(matches[index + 2][3]),
      },
    ]);
  }

  return triangles;
}

function readVec3(buffer: Buffer, offset: number): Vec3 {
  return {
    x: buffer.readFloatLE(offset),
    y: buffer.readFloatLE(offset + 4),
    z: buffer.readFloatLE(offset + 8),
  };
}

function normalizeTriangles(triangles: Triangle[]) {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (const triangle of triangles) {
    for (const point of triangle) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      minZ = Math.min(minZ, point.z);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
      maxZ = Math.max(maxZ, point.z);
    }
  }

  const center = {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    z: (minZ + maxZ) / 2,
  };

  return triangles.map((triangle) => triangle.map((point) => sub(point, center)) as Triangle);
}

function renderPng(triangles: Triangle[], viewSpec: ViewSpec, imageSize: number) {
  const basis = buildBasis(viewSpec);
  const cameraTriangles = triangles
    .map((triangle) => projectTriangle(triangle, basis))
    .filter((triangle): triangle is CameraTriangle => triangle !== null);

  if (cameraTriangles.length === 0) {
    throw new Error(`No triangles were visible in the ${viewSpec.name} preview.`);
  }

  const bounds = computeBounds(cameraTriangles);
  const scale = buildScale(bounds, imageSize);
  const offsetX = imageSize / 2 - ((bounds.minX + bounds.maxX) / 2) * scale;
  const offsetY = imageSize / 2 + ((bounds.minY + bounds.maxY) / 2) * scale;
  const colorBuffer = new Uint8Array(imageSize * imageSize * 4);
  const depthBuffer = new Float64Array(imageSize * imageSize);
  depthBuffer.fill(-Infinity);

  fillBackground(colorBuffer, BACKGROUND);

  for (const triangle of cameraTriangles) {
    rasterizeTriangle(colorBuffer, depthBuffer, imageSize, triangle, scale, offsetX, offsetY);
  }

  return encodePng(imageSize, imageSize, colorBuffer);
}

function buildBasis(viewSpec: ViewSpec): CameraBasis {
  const depth = normalize(viewSpec.depth);
  let right = cross(depth, viewSpec.nominalUp);
  if (length(right) < 1e-6) {
    right = cross(depth, { x: 0, y: 1, z: 0 });
  }
  right = normalize(right);
  const up = normalize(cross(right, depth));
  return { right, up, depth };
}

function projectTriangle(triangle: Triangle, basis: CameraBasis): CameraTriangle | null {
  const points = triangle.map((point) => ({
    x: dot(point, basis.right),
    y: dot(point, basis.up),
    z: dot(point, basis.depth),
  })) as [Vec3, Vec3, Vec3];

  const edgeA = sub(points[1], points[0]);
  const edgeB = sub(points[2], points[0]);
  const normal = normalize(cross(edgeA, edgeB));
  const area = Math.abs(cross2d(toVec2(points[1], points[0]), toVec2(points[2], points[0])));

  if (!Number.isFinite(area) || area < 1e-8) {
    return null;
  }

  const lightDir = normalize({ x: -0.4, y: 0.6, z: 1.2 });
  const diffuse = Math.abs(dot(normal, lightDir));
  const facing = Math.max(0, normal.z);
  const shade = clamp(0.35 + diffuse * 0.35 + facing * 0.3, 0, 1);

  return { points, shade };
}

function computeBounds(triangles: CameraTriangle[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const triangle of triangles) {
    for (const point of triangle.points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }

  return { minX, minY, maxX, maxY };
}

function buildScale(bounds: { minX: number; minY: number; maxX: number; maxY: number }, imageSize: number) {
  const width = Math.max(bounds.maxX - bounds.minX, 1e-6);
  const height = Math.max(bounds.maxY - bounds.minY, 1e-6);
  const usable = imageSize * (1 - VIEW_PADDING * 2);
  return usable / Math.max(width, height);
}

function rasterizeTriangle(
  colorBuffer: Uint8Array,
  depthBuffer: Float64Array,
  imageSize: number,
  triangle: CameraTriangle,
  scale: number,
  offsetX: number,
  offsetY: number,
) {
  const [p0, p1, p2] = triangle.points;
  const s0 = toScreen(p0, scale, offsetX, offsetY);
  const s1 = toScreen(p1, scale, offsetX, offsetY);
  const s2 = toScreen(p2, scale, offsetX, offsetY);
  const area = edgeFunction(s0, s1, s2);

  if (Math.abs(area) < 1e-6) {
    return;
  }

  const minX = clampInt(Math.floor(Math.min(s0.x, s1.x, s2.x)), 0, imageSize - 1);
  const maxX = clampInt(Math.ceil(Math.max(s0.x, s1.x, s2.x)), 0, imageSize - 1);
  const minY = clampInt(Math.floor(Math.min(s0.y, s1.y, s2.y)), 0, imageSize - 1);
  const maxY = clampInt(Math.ceil(Math.max(s0.y, s1.y, s2.y)), 0, imageSize - 1);
  const color = shadeToColor(triangle.shade);

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const sample = { x: x + 0.5, y: y + 0.5 };
      const w0 = edgeFunction(s1, s2, sample) / area;
      const w1 = edgeFunction(s2, s0, sample) / area;
      const w2 = edgeFunction(s0, s1, sample) / area;

      if (w0 < 0 || w1 < 0 || w2 < 0) {
        continue;
      }

      const depth = p0.z * w0 + p1.z * w1 + p2.z * w2;
      const index = y * imageSize + x;
      if (depth <= depthBuffer[index]) {
        continue;
      }

      depthBuffer[index] = depth;
      setPixel(colorBuffer, index * 4, color.r, color.g, color.b, 255);
    }
  }
}

function toScreen(point: Vec3, scale: number, offsetX: number, offsetY: number): Vec2 {
  return {
    x: point.x * scale + offsetX,
    y: offsetY - point.y * scale,
  };
}

function shadeToColor(shade: number) {
  const base = 70 + Math.round(150 * shade);
  return {
    r: base,
    g: base + 6,
    b: base + 12,
  };
}

function fillBackground(buffer: Uint8Array, color: { r: number; g: number; b: number; a: number }) {
  for (let index = 0; index < buffer.length; index += 4) {
    buffer[index] = color.r;
    buffer[index + 1] = color.g;
    buffer[index + 2] = color.b;
    buffer[index + 3] = color.a;
  }
}

function setPixel(buffer: Uint8Array, offset: number, r: number, g: number, b: number, a: number) {
  buffer[offset] = r;
  buffer[offset + 1] = g;
  buffer[offset + 2] = b;
  buffer[offset + 3] = a;
}

function encodePng(width: number, height: number, rgba: Uint8Array) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (stride + 1);
    raw[rowOffset] = 0;
    rgba.subarray(y * stride, (y + 1) * stride).forEach((value, index) => {
      raw[rowOffset + 1 + index] = value;
    });
  }

  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw);

  return Buffer.concat([
    header,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeChunk(type: string, data: Buffer) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(data.length, 0);

  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);

  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
}

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function buildCrcTable() {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let crc = index;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[index] = crc >>> 0;
  }

  return table;
}

function dot(left: Vec3, right: Vec3) {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function cross(left: Vec3, right: Vec3): Vec3 {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  };
}

function sub(left: Vec3, right: Vec3): Vec3 {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
    z: left.z - right.z,
  };
}

function length(vector: Vec3) {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function normalize(vector: Vec3): Vec3 {
  const magnitude = length(vector);
  if (magnitude < 1e-12) {
    return { x: 0, y: 0, z: 0 };
  }

  return {
    x: vector.x / magnitude,
    y: vector.y / magnitude,
    z: vector.z / magnitude,
  };
}

function toVec2(point: Vec3, origin: Vec3): Vec2 {
  return {
    x: point.x - origin.x,
    y: point.y - origin.y,
  };
}

function cross2d(left: Vec2, right: Vec2) {
  return left.x * right.y - left.y * right.x;
}

function edgeFunction(a: Vec2, b: Vec2, c: Vec2) {
  return (c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function clampInt(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
