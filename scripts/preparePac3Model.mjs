import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Scene,
  Vector3,
} from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'

const DEFAULT_OUTPUT_DIRECTORY = path.resolve(
  'src/assets/icons/Air Defence/PAC-3 MSE FOR PATRIOT',
)
const DEFAULT_INPUT = path.join(DEFAULT_OUTPUT_DIRECTORY, 'PAC_3_mk1.stl')
const DEFAULT_REFERENCE = path.join(DEFAULT_OUTPUT_DIRECTORY, 'pac-3-mse-reference.jpg')

const REAL_LENGTH_METERS = 5.2
const MATERIAL_BOUNDARIES = [
  0, 0.018, 0.065, 0.115, 0.2, 0.245, 0.285, 0.325, 0.36,
  0.735, 0.758, 0.775, 0.792, 0.805, 0.892, 0.904, 1,
]

const MATERIALS = {
  warmWhite: {
    name: 'PAC-3 warm white ceramic coating',
    color: 0xd5d7d2,
    preview: [213, 216, 211],
    metalness: 0.05,
    roughness: 0.58,
  },
  fieldOlive: {
    name: 'PAC-3 olive grey motor casing',
    color: 0x77786e,
    preview: [119, 121, 111],
    metalness: 0.12,
    roughness: 0.64,
  },
  graphite: {
    name: 'PAC-3 graphite radome',
    color: 0x272a2c,
    preview: [39, 42, 44],
    metalness: 0.2,
    roughness: 0.38,
  },
  controlMetal: {
    name: 'PAC-3 control surfaces',
    color: 0x8c8e89,
    preview: [140, 143, 138],
    metalness: 0.58,
    roughness: 0.34,
  },
  seamSteel: {
    name: 'PAC-3 structural seams',
    color: 0x9b9c95,
    preview: [155, 157, 150],
    metalness: 0.48,
    roughness: 0.38,
  },
  exhaust: {
    name: 'PAC-3 exhaust interior',
    color: 0x17191a,
    preview: [23, 25, 26],
    metalness: 0.64,
    roughness: 0.31,
  },
  greenBand: {
    name: 'PAC-3 green service band',
    color: 0x566c50,
    preview: [86, 108, 80],
    metalness: 0.08,
    roughness: 0.52,
  },
  orangeBand: {
    name: 'PAC-3 orange radome band',
    color: 0xa96536,
    preview: [169, 101, 54],
    metalness: 0.06,
    roughness: 0.5,
  },
}

globalThis.FileReader ??= class FileReader {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = result
      this.onload?.({ target: this })
      this.onloadend?.({ target: this })
    })
  }

  readAsDataURL(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = `data:${blob.type};base64,${Buffer.from(result).toString('base64')}`
      this.onload?.({ target: this })
      this.onloadend?.({ target: this })
    })
  }
}

function interpolateVertex(start, end, amount) {
  return {
    position: start.position.clone().lerp(end.position, amount),
    normal: start.normal.clone().lerp(end.normal, amount).normalize(),
  }
}

function clipPolygonAtZ(polygon, planeZ, keepAbove) {
  if (polygon.length === 0) return polygon
  const result = []

  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index]
    const previous = polygon[(index + polygon.length - 1) % polygon.length]
    const currentInside = keepAbove
      ? current.position.z >= planeZ - 1e-7
      : current.position.z <= planeZ + 1e-7
    const previousInside = keepAbove
      ? previous.position.z >= planeZ - 1e-7
      : previous.position.z <= planeZ + 1e-7

    if (currentInside !== previousInside) {
      const amount = (planeZ - previous.position.z)
        / (current.position.z - previous.position.z)
      result.push(interpolateVertex(previous, current, amount))
    }
    if (currentInside) result.push(current)
  }

  return result
}

function splitTriangle(vertices, normals, minZ, rawLength) {
  const source = vertices.map((position, index) => ({ position, normal: normals[index] }))
  const triangles = []

  for (let zoneIndex = 0; zoneIndex < MATERIAL_BOUNDARIES.length - 1; zoneIndex += 1) {
    const lowerZ = minZ + MATERIAL_BOUNDARIES[zoneIndex] * rawLength
    const upperZ = minZ + MATERIAL_BOUNDARIES[zoneIndex + 1] * rawLength
    let polygon = clipPolygonAtZ(source, lowerZ, true)
    polygon = clipPolygonAtZ(polygon, upperZ, false)
    for (let index = 1; index < polygon.length - 1; index += 1) {
      triangles.push([polygon[0], polygon[index], polygon[index + 1]])
    }
  }

  return triangles
}

function selectMaterial(normalizedLength, radialDistance) {
  const t = normalizedLength
  const isControlSurface = radialDistance > 4.15
    && (t < 0.14 || (t > 0.265 && t < 0.345))

  if (t < 0.018) return 'exhaust'
  if (isControlSurface) return 'controlMetal'
  if ((t >= 0.065 && t < 0.078) || (t >= 0.285 && t < 0.298)) return 'seamSteel'
  if (t < 0.245) return 'warmWhite'
  if (t < 0.775) return 'fieldOlive'
  if (t < 0.792) return 'greenBand'
  if (t < 0.892) return 'warmWhite'
  if (t < 0.904) return 'orangeBand'
  return 'graphite'
}

function buildColoredModel(sourceGeometry) {
  const position = sourceGeometry.getAttribute('position')
  const normal = sourceGeometry.getAttribute('normal')
  sourceGeometry.computeBoundingBox()
  const bounds = sourceGeometry.boundingBox
  const center = bounds.getCenter(new Vector3())
  const rawLength = bounds.max.z - bounds.min.z
  const scale = REAL_LENGTH_METERS / rawLength

  // Source STL points nose-first along +Z. Game assets use nose-first +X.
  const transform = new Matrix4()
    .makeTranslation(-center.x, -center.y, -center.z)
    .premultiply(new Matrix4().makeScale(scale, scale, scale))
    .premultiply(new Matrix4().makeRotationY(Math.PI / 2))

  const buckets = Object.fromEntries(
    Object.keys(MATERIALS).map((key) => [key, { positions: [], normals: [], triangleCount: 0 }]),
  )
  const previewTriangles = []

  for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex += 3) {
    const vertices = [0, 1, 2].map((offset) =>
      new Vector3().fromBufferAttribute(position, vertexIndex + offset),
    )
    const normals = [0, 1, 2].map((offset) =>
      normal
        ? new Vector3().fromBufferAttribute(normal, vertexIndex + offset).normalize()
        : new Vector3(0, 0, 1),
    )
    const pieces = splitTriangle(vertices, normals, bounds.min.z, rawLength)

    for (const triangle of pieces) {
      const centroid = triangle.reduce(
        (sum, vertex) => sum.add(vertex.position),
        new Vector3(),
      ).multiplyScalar(1 / 3)
      const t = (centroid.z - bounds.min.z) / rawLength
      const radialDistance = Math.hypot(centroid.x - center.x, centroid.y - center.y)
      const materialKey = selectMaterial(t, radialDistance)
      const bucket = buckets[materialKey]
      const transformedVertices = triangle.map(({ position: vertex }) =>
        vertex.clone().applyMatrix4(transform),
      )

      transformedVertices.forEach((vertex) => bucket.positions.push(vertex.x, vertex.y, vertex.z))
      triangle.forEach(({ normal: vertexNormal }) => {
        const transformedNormal = vertexNormal.clone().transformDirection(transform)
        bucket.normals.push(transformedNormal.x, transformedNormal.y, transformedNormal.z)
      })
      bucket.triangleCount += 1
      previewTriangles.push({ materialKey, vertices: transformedVertices })
    }
  }

  const group = new Group()
  group.name = 'PAC-3 MSE'
  group.userData = {
    assetRole: 'interceptor',
    longitudinalAxis: '+X',
    realLengthMeters: REAL_LENGTH_METERS,
    sourceFormat: 'STL',
  }

  for (const [materialKey, bucket] of Object.entries(buckets)) {
    if (bucket.positions.length === 0) continue
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(bucket.positions, 3))
    geometry.setAttribute('normal', new Float32BufferAttribute(bucket.normals, 3))
    geometry.normalizeNormals()
    geometry.computeBoundingSphere()

    const definition = MATERIALS[materialKey]
    const material = new MeshStandardMaterial({
      color: definition.color,
      metalness: definition.metalness,
      roughness: definition.roughness,
    })
    material.name = definition.name
    const mesh = new Mesh(geometry, material)
    mesh.name = definition.name
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  }

  return { group, previewTriangles, buckets, rawLength, scale }
}

function renderPreview(triangles, outputPath) {
  const width = 1500
  const height = 560
  const padding = 65
  const pixels = Buffer.alloc(width * height * 3, 12)
  const depthBuffer = new Float64Array(width * height)
  depthBuffer.fill(Number.NEGATIVE_INFINITY)

  const toView = (point) => ({
    x: point.x,
    y: point.z * 0.82 + point.y * 0.28,
    depth: point.y * 0.82 - point.z * 0.28,
  })
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const triangle of triangles) {
    for (const point of triangle.vertices) {
      const view = toView(point)
      minX = Math.min(minX, view.x)
      maxX = Math.max(maxX, view.x)
      minY = Math.min(minY, view.y)
      maxY = Math.max(maxY, view.y)
    }
  }
  const viewScale = Math.min(
    (width - padding * 2) / (maxX - minX),
    (height - padding * 2) / (maxY - minY),
  )
  const offsetX = (width - (maxX - minX) * viewScale) / 2
  const offsetY = (height - (maxY - minY) * viewScale) / 2
  const light = new Vector3(-0.3, 0.72, 0.62).normalize()

  const project = (point) => {
    const view = toView(point)
    return {
      x: offsetX + (view.x - minX) * viewScale,
      y: height - (offsetY + (view.y - minY) * viewScale),
      depth: view.depth,
    }
  }

  for (const triangle of triangles) {
    const [a3, b3, c3] = triangle.vertices
    const [a, b, c] = triangle.vertices.map(project)
    const denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y)
    if (Math.abs(denominator) < 1e-8) continue
    const normal = new Vector3().subVectors(b3, a3)
      .cross(new Vector3().subVectors(c3, a3)).normalize()
    const base = MATERIALS[triangle.materialKey].preview
    const illumination = Math.max(0.38, Math.min(1.12, 0.6 + Math.abs(normal.dot(light)) * 0.52))
    const color = base.map((channel) => Math.min(255, Math.round(channel * illumination)))
    const minPixelX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)))
    const maxPixelX = Math.min(width - 1, Math.ceil(Math.max(a.x, b.x, c.x)))
    const minPixelY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)))
    const maxPixelY = Math.min(height - 1, Math.ceil(Math.max(a.y, b.y, c.y)))

    for (let y = minPixelY; y <= maxPixelY; y += 1) {
      for (let x = minPixelX; x <= maxPixelX; x += 1) {
        const sampleX = x + 0.5
        const sampleY = y + 0.5
        const wa = ((b.y - c.y) * (sampleX - c.x) + (c.x - b.x) * (sampleY - c.y)) / denominator
        const wb = ((c.y - a.y) * (sampleX - c.x) + (a.x - c.x) * (sampleY - c.y)) / denominator
        const wc = 1 - wa - wb
        if (wa < -0.001 || wb < -0.001 || wc < -0.001) continue
        const depth = wa * a.depth + wb * b.depth + wc * c.depth
        const pixelIndex = y * width + x
        if (depth <= depthBuffer[pixelIndex]) continue
        depthBuffer[pixelIndex] = depth
        const colorIndex = pixelIndex * 3
        pixels[colorIndex] = color[0]
        pixels[colorIndex + 1] = color[1]
        pixels[colorIndex + 2] = color[2]
      }
    }
  }

  const ppmPath = `${outputPath}.ppm`
  fs.writeFileSync(ppmPath, Buffer.concat([
    Buffer.from(`P6\n${width} ${height}\n255\n`),
    pixels,
  ]))
  try {
    execFileSync('/usr/bin/sips', ['-s', 'format', 'png', ppmPath, '--out', outputPath], {
      stdio: 'ignore',
    })
  } finally {
    fs.unlinkSync(ppmPath)
  }
}

async function main() {
  const inputPath = path.resolve(process.argv[2] ?? DEFAULT_INPUT)
  const referencePath = path.resolve(process.argv[3] ?? DEFAULT_REFERENCE)
  const outputDirectory = path.resolve(process.argv[4] ?? DEFAULT_OUTPUT_DIRECTORY)
  if (!fs.existsSync(inputPath)) throw new Error(`STL not found: ${inputPath}`)
  if (!fs.existsSync(referencePath)) throw new Error(`Reference image not found: ${referencePath}`)
  fs.mkdirSync(outputDirectory, { recursive: true })

  const sourceBuffer = fs.readFileSync(inputPath)
  const sourceArrayBuffer = sourceBuffer.buffer.slice(
    sourceBuffer.byteOffset,
    sourceBuffer.byteOffset + sourceBuffer.byteLength,
  )
  const sourceGeometry = new STLLoader().parse(sourceArrayBuffer)
  const result = buildColoredModel(sourceGeometry)
  const scene = new Scene()
  scene.name = 'PAC-3 MSE colored game asset'
  scene.add(result.group)

  const exporter = new GLTFExporter()
  const binary = await exporter.parseAsync(scene, {
    binary: true,
    onlyVisible: true,
    truncateDrawRange: true,
  })

  const modelPath = path.join(outputDirectory, 'pac-3-mse-colored.glb')
  const previewPath = path.join(outputDirectory, 'pac-3-mse-colored-preview.png')
  const sourceCopyPath = path.join(outputDirectory, 'PAC_3_mk1.stl')
  const referenceCopyPath = path.join(outputDirectory, 'pac-3-mse-reference.jpg')
  fs.writeFileSync(modelPath, Buffer.from(binary))
  renderPreview(result.previewTriangles, previewPath)
  fs.copyFileSync(inputPath, sourceCopyPath)
  fs.copyFileSync(referencePath, referenceCopyPath)

  const summary = Object.entries(result.buckets)
    .filter(([, bucket]) => bucket.triangleCount > 0)
    .map(([material, bucket]) => `${material}: ${bucket.triangleCount}`)
    .join(', ')
  console.log(`PAC-3 MSE GLB: ${modelPath}`)
  console.log(`Preview: ${previewPath}`)
  console.log(`Raw length: ${result.rawLength.toFixed(3)}; scale: ${result.scale.toFixed(6)} m/unit`)
  console.log(`Materials: ${summary}`)
}

await main()
