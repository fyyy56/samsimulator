import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const SIZE = 512;
const MARGIN = 34;

export const ICON_CAMERA_PRESET = Object.freeze({
  TOP_VIEW_MISSILE: 'TOP_VIEW_MISSILE',
  TOP_VIEW_UAV: 'TOP_VIEW_UAV',
  ISOMETRIC_GROUND: 'ISOMETRIC_GROUND',
  ISOMETRIC_GROUND_Z_UP: 'ISOMETRIC_GROUND_Z_UP',
  ISOMETRIC_GROUND_X_UP_TOP: 'ISOMETRIC_GROUND_X_UP_TOP',
});

const JOBS = Object.freeze([
  {
    id: 'KH_555',
    model: 'src/assets/icons/Cruise MIssiles/X-555/kh-555_missile_high-poly_fbx.glb',
    output: 'src/assets/icons/Cruise MIssiles/X-555/kh-555-top.png',
    preset: ICON_CAMERA_PRESET.TOP_VIEW_MISSILE,
    baseColor: [211, 216, 213],
  },
  {
    id: 'GERAN_2',
    model: 'src/assets/icons/UAVS/GERAN-2-SHAHED-136/iranian_shahed-136_military_drone.glb',
    output: 'src/assets/icons/UAVS/GERAN-2-SHAHED-136/geran-2-top.png',
    preset: ICON_CAMERA_PRESET.TOP_VIEW_UAV,
    baseColor: [194, 184, 158],
  },
  {
    id: 'GERBERA',
    model: 'src/assets/icons/UAVS/GERBERA/uav_gerbera_low-poly.glb',
    output: 'src/assets/icons/UAVS/GERBERA/gerbera-top.png',
    preset: ICON_CAMERA_PRESET.TOP_VIEW_UAV,
    baseColor: [205, 210, 202],
  },
  {
    id: 'KALIBR',
    model: 'src/assets/icons/Cruise MIssiles/kalibr/kalibr3d.glb',
    output: 'src/assets/icons/Cruise MIssiles/kalibr/kalibr-top.png',
    preset: ICON_CAMERA_PRESET.TOP_VIEW_MISSILE,
    baseColor: [202, 207, 202],
  },
  {
    id: 'HUMVEE_MWG',
    model: 'src/assets/icons/Air Defence/HAMVEE WIHT GUN/ukrainian_modified_humvee.glb',
    output: 'src/assets/icons/Air Defence/HAMVEE WIHT GUN/humvee-mwg-isometric.png',
    preset: ICON_CAMERA_PRESET.ISOMETRIC_GROUND,
    baseColor: [119, 126, 91],
  },
  {
    id: 'SAMP_T_LAUNCHER',
    model: 'src/assets/icons/Air Defence/SAMP-T LAUNCHER/italian_fsaf_sampt_tel_war_thunder.glb',
    output: 'src/assets/icons/Air Defence/SAMP-T LAUNCHER/samp-t-launcher-isometric.png',
    preset: ICON_CAMERA_PRESET.ISOMETRIC_GROUND_X_UP_TOP,
    baseColor: [119, 126, 91],
  },
  {
    id: 'SAMP_T_RADAR',
    model: 'src/assets/icons/Air Defence/SAMP-T RADAR/italian_fsaf_sampt_tads_war_thunder.glb',
    output: 'src/assets/icons/Air Defence/SAMP-T RADAR/samp-t-radar-isometric.png',
    preset: ICON_CAMERA_PRESET.ISOMETRIC_GROUND_X_UP_TOP,
    baseColor: [119, 126, 91],
  },
]);

const COMPONENT_SIZE = Object.freeze({ 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 });
const COMPONENT_READER = Object.freeze({
  5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32',
});
const TYPE_SIZE = Object.freeze({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 });

function multiplyMatrix(a, b) {
  const out = new Array(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let inner = 0; inner < 4; inner += 1) out[column * 4 + row] += a[inner * 4 + row] * b[column * 4 + inner];
    }
  }
  return out;
}

function composeNodeMatrix(node) {
  if (node.matrix) return node.matrix;
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const x2 = x + x; const y2 = y + y; const z2 = z + z;
  const xx = x * x2; const xy = x * y2; const xz = x * z2;
  const yy = y * y2; const yz = y * z2; const zz = z * z2;
  const wx = w * x2; const wy = w * y2; const wz = w * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function transformPoint(matrix, point) {
  const [x, y, z] = point;
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  ];
}

function parseGlb(filePath) {
  const file = fs.readFileSync(filePath);
  if (file.toString('utf8', 0, 4) !== 'glTF') throw new Error(`${filePath} is not a binary glTF`);
  let offset = 12;
  let json = null;
  let binary = null;
  while (offset < file.length) {
    const length = file.readUInt32LE(offset);
    const type = file.readUInt32LE(offset + 4);
    const data = file.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8').replace(/\0+$/, ''));
    if (type === 0x004e4942) binary = data;
    offset += 8 + length;
  }
  if (!json || !binary) throw new Error(`Missing JSON/BIN chunk in ${filePath}`);
  return { json, binary };
}

function readAccessor(document, accessorIndex) {
  const { json, binary } = document;
  const accessor = json.accessors[accessorIndex];
  const view = json.bufferViews[accessor.bufferView];
  const componentCount = TYPE_SIZE[accessor.type];
  const componentSize = COMPONENT_SIZE[accessor.componentType];
  const stride = view.byteStride ?? componentCount * componentSize;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const data = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  const reader = COMPONENT_READER[accessor.componentType];
  const values = new Array(accessor.count);
  for (let index = 0; index < accessor.count; index += 1) {
    const entry = new Array(componentCount);
    for (let component = 0; component < componentCount; component += 1) {
      entry[component] = data[reader](start + index * stride + component * componentSize, true);
    }
    values[index] = componentCount === 1 ? entry[0] : entry;
  }
  return values;
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function extractTriangles(document, fallbackColor) {
  const { json } = document;
  const triangles = [];
  const scene = json.scenes[json.scene ?? 0];
  const worldMatrices = new Array(json.nodes.length);
  const collectMatrices = (nodeIndex, parentMatrix) => {
    const node = json.nodes[nodeIndex];
    const worldMatrix = multiplyMatrix(parentMatrix, composeNodeMatrix(node));
    worldMatrices[nodeIndex] = worldMatrix;
    for (const child of node.children ?? []) collectMatrices(child, worldMatrix);
  };
  for (const node of scene.nodes) collectMatrices(node, IDENTITY);

  const addNodeMesh = (nodeIndex) => {
    const node = json.nodes[nodeIndex];
    const worldMatrix = worldMatrices[nodeIndex];
    if (!worldMatrix) return;
    if (Number.isInteger(node.mesh)) {
      for (const primitive of json.meshes[node.mesh].primitives) {
        if ((primitive.mode ?? 4) !== 4 || primitive.attributes.POSITION == null) continue;
        const sourcePositions = readAccessor(document, primitive.attributes.POSITION);
        let positions;
        if (Number.isInteger(node.skin) && primitive.attributes.JOINTS_0 != null && primitive.attributes.WEIGHTS_0 != null) {
          const skin = json.skins[node.skin];
          const inverseBindMatrices = readAccessor(document, skin.inverseBindMatrices);
          const jointMatrices = skin.joints.map((jointNode, index) => multiplyMatrix(worldMatrices[jointNode], inverseBindMatrices[index]));
          const joints = readAccessor(document, primitive.attributes.JOINTS_0);
          const weights = readAccessor(document, primitive.attributes.WEIGHTS_0);
          positions = sourcePositions.map((point, vertexIndex) => {
            const transformed = [0, 0, 0];
            let totalWeight = 0;
            for (let influence = 0; influence < joints[vertexIndex].length; influence += 1) {
              const weight = weights[vertexIndex][influence];
              if (weight <= 0) continue;
              const candidate = transformPoint(jointMatrices[joints[vertexIndex][influence]], point);
              transformed[0] += candidate[0] * weight;
              transformed[1] += candidate[1] * weight;
              transformed[2] += candidate[2] * weight;
              totalWeight += weight;
            }
            return totalWeight > 0 ? transformed.map(value => value / totalWeight) : transformPoint(worldMatrix, point);
          });
        } else {
          positions = sourcePositions.map(point => transformPoint(worldMatrix, point));
        }
        const indices = primitive.indices == null
          ? Array.from({ length: positions.length }, (_, index) => index)
          : readAccessor(document, primitive.indices);
        const factor = json.materials?.[primitive.material]?.pbrMetallicRoughness?.baseColorFactor;
        const materialColor = factor
          ? factor.slice(0, 3).map(value => Math.round(value * 255))
          : fallbackColor;
        for (let index = 0; index + 2 < indices.length; index += 3) {
          triangles.push({ points: [positions[indices[index]], positions[indices[index + 1]], positions[indices[index + 2]]], color: materialColor });
        }
      }
    }
  };
  for (let nodeIndex = 0; nodeIndex < json.nodes.length; nodeIndex += 1) addNodeMesh(nodeIndex);
  return triangles;
}

function normalize(vector) {
  const length = Math.hypot(...vector) || 1;
  return vector.map(value => value / length);
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function getCameraBasis(preset) {
  if (preset === ICON_CAMERA_PRESET.ISOMETRIC_GROUND_X_UP_TOP) {
    const direction = normalize([0.9, 1.08, -1]);
    const right = normalize(cross(direction, [1, 0, 0]));
    return { right, up: normalize(cross(right, direction)), direction, autoOrient: false };
  }
  if (preset === ICON_CAMERA_PRESET.ISOMETRIC_GROUND_Z_UP) {
    const direction = normalize([0.85, -1, -0.62]);
    const right = normalize(cross(direction, [0, 0, 1]));
    return { right, up: normalize(cross(right, direction)), direction, autoOrient: false };
  }
  if (preset === ICON_CAMERA_PRESET.ISOMETRIC_GROUND) {
    // Sketchfab FBX exports in this content pack use +X as their vertical axis.
    const direction = normalize([0.9, -1.08, -1]);
    const right = normalize(cross(direction, [1, 0, 0]));
    return { right, up: normalize(cross(right, direction)), direction, autoOrient: false };
  }
  // Aircraft/missile models use a thin Y axis, so strict top view looks down Y.
  return { right: [1, 0, 0], up: [0, 0, 1], direction: [0, 1, 0], autoOrient: true };
}

function autoOrientTopView(triangles, basis) {
  const points = triangles.flatMap(triangle => triangle.points.map(point => [dot(point, basis.right), dot(point, basis.up)]));
  const center = points.reduce((sum, point) => [sum[0] + point[0], sum[1] + point[1]], [0, 0]).map(value => value / points.length);
  let xx = 0; let xy = 0; let yy = 0;
  for (const point of points) {
    const x = point[0] - center[0]; const y = point[1] - center[1];
    xx += x * x; xy += x * y; yy += y * y;
  }
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  const major = [Math.cos(angle), Math.sin(angle)];
  const minor = [-major[1], major[0]];
  const projected = points.map(point => ({ longitudinal: point[0] * major[0] + point[1] * major[1], lateral: point[0] * minor[0] + point[1] * minor[1] }));
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const point of projected) {
    minimum = Math.min(minimum, point.longitudinal);
    maximum = Math.max(maximum, point.longitudinal);
  }
  const endWidth = (start, end) => {
    const endPoints = projected.filter(point => point.longitudinal >= start && point.longitudinal <= end);
    let smallest = Number.POSITIVE_INFINITY;
    let largest = Number.NEGATIVE_INFINITY;
    for (const point of endPoints) {
      smallest = Math.min(smallest, point.lateral);
      largest = Math.max(largest, point.lateral);
    }
    return largest - smallest;
  };
  const range = maximum - minimum;
  const minimumWidth = endWidth(minimum, minimum + range * 0.13);
  const maximumWidth = endWidth(maximum - range * 0.13, maximum);
  const noseSign = maximumWidth <= minimumWidth ? 1 : -1;
  return {
    right: normalize([basis.right[0] * minor[0] + basis.up[0] * minor[1], basis.right[1] * minor[0] + basis.up[1] * minor[1], basis.right[2] * minor[0] + basis.up[2] * minor[1]]),
    up: normalize([basis.right[0] * major[0] * noseSign + basis.up[0] * major[1] * noseSign, basis.right[1] * major[0] * noseSign + basis.up[1] * major[1] * noseSign, basis.right[2] * major[0] * noseSign + basis.up[2] * major[1] * noseSign]),
    direction: basis.direction,
  };
}

function colorWithLight(color, normal, preset) {
  const light = preset === ICON_CAMERA_PRESET.ISOMETRIC_GROUND
    || preset === ICON_CAMERA_PRESET.ISOMETRIC_GROUND_Z_UP
    || preset === ICON_CAMERA_PRESET.ISOMETRIC_GROUND_X_UP_TOP
    ? normalize([1, -0.55, -0.7]) : normalize([-0.35, 1, 0.45]);
  const intensity = Math.max(0.48, Math.min(1.08, 0.58 + Math.abs(dot(normal, light)) * 0.5));
  return `rgb(${color.map(value => Math.max(0, Math.min(255, Math.round(value * intensity)))).join(' ')})`;
}

function renderSvg(triangles, preset) {
  let basis = getCameraBasis(preset);
  if (basis.autoOrient) basis = autoOrientTopView(triangles, basis);
  const projected = triangles.map(triangle => ({
    ...triangle,
    projected: triangle.points.map(point => [dot(point, basis.right), dot(point, basis.up)]),
    depth: triangle.points.reduce((sum, point) => sum + dot(point, basis.direction), 0) / 3,
  }));
  const allPoints = projected.flatMap(triangle => triangle.projected);
  let minimumX = Number.POSITIVE_INFINITY; let maximumX = Number.NEGATIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY; let maximumY = Number.NEGATIVE_INFINITY;
  for (const point of allPoints) {
    minimumX = Math.min(minimumX, point[0]); maximumX = Math.max(maximumX, point[0]);
    minimumY = Math.min(minimumY, point[1]); maximumY = Math.max(maximumY, point[1]);
  }
  const scale = Math.min((SIZE - MARGIN * 2) / (maximumX - minimumX), (SIZE - MARGIN * 2) / (maximumY - minimumY));
  const centerX = (minimumX + maximumX) / 2; const centerY = (minimumY + maximumY) / 2;
  projected.sort((a, b) => preset === ICON_CAMERA_PRESET.ISOMETRIC_GROUND_X_UP_TOP
    ? b.depth - a.depth
    : a.depth - b.depth);
  const paths = [];
  for (const triangle of projected) {
    const points = triangle.projected.map(point => [(point[0] - centerX) * scale + SIZE / 2, SIZE / 2 - (point[1] - centerY) * scale]);
    const twiceArea = Math.abs((points[1][0] - points[0][0]) * (points[2][1] - points[0][1]) - (points[2][0] - points[0][0]) * (points[1][1] - points[0][1]));
    if (twiceArea < 0.035) continue;
    const normal = normalize(cross(
      triangle.points[1].map((value, index) => value - triangle.points[0][index]),
      triangle.points[2].map((value, index) => value - triangle.points[0][index]),
    ));
    const fill = colorWithLight(triangle.color, normal, preset);
    paths.push(`<path d="M${points.map(point => `${point[0].toFixed(2)} ${point[1].toFixed(2)}`).join('L')}Z" fill="${fill}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">${paths.join('')}</svg>`;
}

async function loadSharp() {
  try {
    return (await import('sharp')).default;
  } catch {
    const bundledSharp = path.join(
      process.env.HOME ?? '',
      '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp/dist/index.mjs',
    );
    if (fs.existsSync(bundledSharp)) return (await import(pathToFileURL(bundledSharp))).default;
    throw new Error('Icon rendering requires the dev dependency "sharp". Run npm install --save-dev sharp.');
  }
}

async function renderJob(job, sharp) {
  const modelPath = path.join(ROOT, job.model);
  const outputPath = path.join(ROOT, job.output);
  const triangles = extractTriangles(parseGlb(modelPath), job.baseColor);
  const bounds = triangles.flatMap(triangle => triangle.points).reduce((result, point) => ({
    minimum: result.minimum.map((value, index) => Math.min(value, point[index])),
    maximum: result.maximum.map((value, index) => Math.max(value, point[index])),
  }), { minimum: [Infinity, Infinity, Infinity], maximum: [-Infinity, -Infinity, -Infinity] });
  const extents = bounds.maximum.map((value, index) => value - bounds.minimum[index]);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await sharp(Buffer.from(renderSvg(triangles, job.preset))).png().toFile(outputPath);
  console.log(`${job.id}: ${triangles.length.toLocaleString()} triangles · extents ${extents.map(value => value.toFixed(2)).join(' / ')} -> ${path.relative(ROOT, outputPath)} (${job.preset})`);
}

const requestedIds = process.argv.slice(2).filter(argument => !argument.startsWith('-'));
const selectedJobs = requestedIds.length > 0 ? JOBS.filter(job => requestedIds.includes(job.id)) : JOBS;
if (selectedJobs.length === 0) throw new Error(`No matching icon jobs: ${requestedIds.join(', ')}`);
const sharp = await loadSharp();
for (const job of selectedJobs) await renderJob(job, sharp);
