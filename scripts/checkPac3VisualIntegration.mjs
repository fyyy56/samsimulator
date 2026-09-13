import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import {
  Cartesian3,
  Math as CesiumMath,
  Matrix3,
  Matrix4,
  Transforms,
} from 'cesium'
import ModelUtility from '@cesium/engine/Source/Scene/Model/ModelUtility.js'
import Axis from '@cesium/engine/Source/Scene/Axis.js'
import { createOrientation } from '../src/scenes/advanced/modelOrientation.js'

const ROOT = process.cwd()
const MODEL_PATH = path.join(
  ROOT,
  'src/assets/icons/Air Defence/PAC-3 MSE FOR PATRIOT/pac-3-mse-colored.glb',
)
const REGISTRY_PATH = path.join(ROOT, 'src/data/advanced3dRegistry.js')
const CATALOG_PATH = path.join(ROOT, 'src/content/catalog/interceptors.json')
const EXPECTED_LENGTH_METERS = 5.2
const YAW_OFFSET_DEG = 0

function parseGlb(buffer) {
  assert.equal(buffer.toString('ascii', 0, 4), 'glTF', 'Expected a binary glTF asset')
  assert.equal(buffer.readUInt32LE(4), 2, 'Expected GLB v2')
  const jsonLength = buffer.readUInt32LE(12)
  return JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength))
}

function getModelBounds(gltf) {
  const minimum = [Infinity, Infinity, Infinity]
  const maximum = [-Infinity, -Infinity, -Infinity]
  gltf.meshes.forEach(mesh => mesh.primitives.forEach(primitive => {
    const accessor = gltf.accessors[primitive.attributes.POSITION]
    for (let axis = 0; axis < 3; axis += 1) {
      minimum[axis] = Math.min(minimum[axis], accessor.min[axis])
      maximum[axis] = Math.max(maximum[axis], accessor.max[axis])
    }
  }))
  return { minimum, maximum, size: maximum.map((value, axis) => value - minimum[axis]) }
}

function expectedForward(headingDeg, pitchDeg) {
  const heading = CesiumMath.toRadians(headingDeg)
  const pitch = CesiumMath.toRadians(pitchDeg)
  return new Cartesian3(
    Math.sin(heading) * Math.cos(pitch),
    Math.cos(heading) * Math.cos(pitch),
    Math.sin(pitch),
  )
}

function transformedForward(position, headingDeg, pitchDeg) {
  const orientation = createOrientation(position, { headingDeg, pitchDeg, rollDeg: 0 },
    { yawOffsetDeg: YAW_OFFSET_DEG })
  const modelNose = Matrix4.multiplyByPointAsVector(
    ModelUtility.getAxisCorrectionMatrix(Axis.Y, Axis.Z, new Matrix4()),
    Cartesian3.UNIT_X, new Cartesian3())
  const worldForward = Matrix3.multiplyByVector(
    Matrix3.fromQuaternion(orientation),
    modelNose,
    new Cartesian3(),
  )
  return Matrix4.multiplyByPointAsVector(
    Matrix4.inverseTransformation(
      Transforms.eastNorthUpToFixedFrame(position),
      new Matrix4(),
    ),
    worldForward,
    new Cartesian3(),
  )
}

const buffer = fs.readFileSync(MODEL_PATH)
const parseStartedAt = performance.now()
let gltf = null
for (let index = 0; index < 10; index += 1) gltf = parseGlb(buffer)
const tenAssetParseMs = performance.now() - parseStartedAt
const bounds = getModelBounds(gltf)

assert.ok(Math.abs(bounds.size[0] - EXPECTED_LENGTH_METERS) < 0.001)
assert.ok(bounds.size[0] > bounds.size[1] * 8, 'PAC-3 forward axis must be +X')
assert.ok(Math.abs(bounds.minimum[0] + bounds.maximum[0]) < 0.001, 'Pivot must be centered on X')
assert.ok(Math.abs(bounds.minimum[1] + bounds.maximum[1]) < 0.001, 'Pivot must be centered on Y')
assert.ok(Math.abs(bounds.minimum[2] + bounds.maximum[2]) < 0.001, 'Pivot must be centered on Z')
assert.equal(gltf.materials.length, 8, 'All authored PBR materials must be preserved')

const registrySource = fs.readFileSync(REGISTRY_PATH, 'utf8')
const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'))
const catalogPac3 = catalog.find(item => item.id === 'pac-3-mse')
assert.ok(registrySource.includes("key: 'PAC3_CRI_VISUAL'"))
assert.ok(registrySource.includes('exhaustOffsetMeters: 3.77'))
assert.equal(catalogPac3.name, 'PAC-3 MSE')
assert.equal(catalogPac3.model3dAsset, 'pac-3-mse-colored.glb')

const position = Cartesian3.fromDegrees(30.5, 49.1, 10_000)
const cases = [
  { id: 'NORTH_LEVEL', headingDeg: 0, pitchDeg: 0 },
  { id: 'EAST_LEVEL', headingDeg: 90, pitchDeg: 0 },
  { id: 'CLIMB', headingDeg: 35, pitchDeg: 34 },
  { id: 'STEEP_DESCENT', headingDeg: 210, pitchDeg: -48 },
  { id: 'STRONG_TURN', headingDeg: 300, pitchDeg: 9 },
]
const orientationResults = cases.map(testCase => {
  const actual = Cartesian3.normalize(
    transformedForward(position, testCase.headingDeg, testCase.pitchDeg),
    new Cartesian3(),
  )
  const expected = Cartesian3.normalize(
    expectedForward(testCase.headingDeg, testCase.pitchDeg),
    new Cartesian3(),
  )
  const alignment = Cartesian3.dot(actual, expected)
  assert.ok(alignment > 0.999999, `${testCase.id} nose alignment failed: ${alignment}`)
  return { ...testCase, alignment }
})

const triangleCount = gltf.meshes.reduce((total, mesh) => total + mesh.primitives.reduce(
  (meshTotal, primitive) => {
    const indexAccessor = primitive.indices != null ? gltf.accessors[primitive.indices] : null
    const positionAccessor = gltf.accessors[primitive.attributes.POSITION]
    return meshTotal + (indexAccessor?.count ?? positionAccessor.count) / 3
  },
0), 0)

console.log(JSON.stringify({
  asset: path.relative(ROOT, MODEL_PATH),
  format: 'GLB 2.0',
  dimensionsMeters: bounds.size,
  pivot: bounds.minimum.map((value, axis) => (value + bounds.maximum[axis]) / 2),
  forwardAxis: '+X',
  yawOffsetDeg: YAW_OFFSET_DEG,
  materialCount: gltf.materials.length,
  meshCount: gltf.meshes.length,
  triangleCount,
  tenInstances: {
    approximateTriangles: triangleCount * 10,
    approximateMeshPrimitives: gltf.meshes.length * 10,
    repeatedJsonParseMs: tenAssetParseMs,
  },
  orientationResults,
}, null, 2))
