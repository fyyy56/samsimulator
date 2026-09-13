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

const DEFAULT_INPUT = '/Users/enot/Downloads/cad_aster_30.stl'
const DEFAULT_REFERENCE = '/Users/enot/Downloads/aster_30.png.webp'
const DEFAULT_OUTPUT_DIRECTORY = path.resolve(
  'src/assets/icons/Air Defence/ASTER-30 FOR SAMP-T',
)
const REAL_LENGTH_METERS = 4.9
const LONGITUDINAL_MATERIAL_BOUNDARIES = [
  0,
  0.075,
  0.255,
  0.49,
  0.57,
  0.66,
  0.715,
  0.735,
  0.805,
  0.825,
  0.895,
  0.918,
  0.965,
  1,
]

const MATERIAL_DEFINITIONS = {
  ceramicWhite: {
    name: 'Aster 30 warm white coating',
    color: 0xd9dad7,
    preview: [218, 220, 217],
    metalness: 0.08,
    roughness: 0.52,
  },
  charcoal: {
    name: 'Aster 30 matte charcoal coating',
    color: 0x202326,
    preview: [39, 43, 47],
    metalness: 0.2,
    roughness: 0.46,
  },
  graphite: {
    name: 'Aster 30 graphite details',
    color: 0x111417,
    preview: [22, 26, 29],
    metalness: 0.3,
    roughness: 0.4,
  },
  transitionMetal: {
    name: 'Aster 30 transition metal',
    color: 0x747b7e,
    preview: [118, 126, 129],
    metalness: 0.72,
    roughness: 0.3,
  },
  steelBand: {
    name: 'Aster 30 steel bands and exhaust',
    color: 0x8b8d8b,
    preview: [145, 147, 145],
    metalness: 0.86,
    roughness: 0.24,
  },
}

// Three's exporter uses FileReader in browsers. This small adapter keeps the
// asset-preparation script runnable in Node without adding another dependency.
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

function selectMaterial({ normalizedLength, radialDistance }) {
  const t = normalizedLength

  if (t < 0.075) return 'ceramicWhite'
  if (t < 0.255) return 'charcoal'
  if (t < 0.49) return 'ceramicWhite'
  if (t < 0.57) return radialDistance > 6.1 ? 'graphite' : 'ceramicWhite'
  if (t < 0.66) return radialDistance > 5.75 ? 'graphite' : 'transitionMetal'

  const isSteelBand =
    (t > 0.715 && t < 0.735) ||
    (t > 0.805 && t < 0.825) ||
    (t > 0.895 && t < 0.918)

  if (t > 0.965) return 'steelBand'
  if (isSteelBand && radialDistance < 5.9) return 'steelBand'
  if (radialDistance > 6.0) return 'ceramicWhite'
  return 'charcoal'
}

function interpolateVertex(start, end, amount) {
  return {
    position: start.position.clone().lerp(end.position, amount),
    normal: start.normal.clone().lerp(end.normal, amount).normalize(),
  }
}

function clipPolygonAtY(polygon, planeY, keepAbove) {
  if (polygon.length === 0) return polygon
  const result = []

  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index]
    const previous = polygon[(index + polygon.length - 1) % polygon.length]
    const currentInside = keepAbove
      ? current.position.y >= planeY - 1e-7
      : current.position.y <= planeY + 1e-7
    const previousInside = keepAbove
      ? previous.position.y >= planeY - 1e-7
      : previous.position.y <= planeY + 1e-7

    if (currentInside !== previousInside) {
      const amount = (planeY - previous.position.y) / (current.position.y - previous.position.y)
      result.push(interpolateVertex(previous, current, amount))
    }
    if (currentInside) result.push(current)
  }

  return result
}

function splitTriangleIntoMaterialZones(vertices, normals, minY, rawLength) {
  const sourcePolygon = vertices.map((position, index) => ({
    position,
    normal: normals[index],
  }))
  const triangles = []

  for (let zoneIndex = 0; zoneIndex < LONGITUDINAL_MATERIAL_BOUNDARIES.length - 1; zoneIndex += 1) {
    const lowerBoundary = LONGITUDINAL_MATERIAL_BOUNDARIES[zoneIndex]
    const upperBoundary = LONGITUDINAL_MATERIAL_BOUNDARIES[zoneIndex + 1]
    const lowerY = minY + lowerBoundary * rawLength
    const upperY = minY + upperBoundary * rawLength
    let polygon = clipPolygonAtY(sourcePolygon, lowerY, true)
    polygon = clipPolygonAtY(polygon, upperY, false)

    for (let index = 1; index < polygon.length - 1; index += 1) {
      triangles.push([polygon[0], polygon[index], polygon[index + 1]])
    }
  }

  return triangles
}

function buildColoredMeshes(sourceGeometry) {
  const position = sourceGeometry.getAttribute('position')
  const normal = sourceGeometry.getAttribute('normal')
  sourceGeometry.computeBoundingBox()

  const bounds = sourceGeometry.boundingBox
  const center = bounds.getCenter(new Vector3())
  const rawLength = bounds.max.y - bounds.min.y
  const scale = REAL_LENGTH_METERS / rawLength
  const transform = new Matrix4()
    .makeTranslation(-center.x, -center.y, -center.z)
    .premultiply(new Matrix4().makeScale(scale, scale, scale))
    .premultiply(new Matrix4().makeRotationZ(Math.PI / 2))

  const buckets = Object.fromEntries(
    Object.keys(MATERIAL_DEFINITIONS).map((key) => [
      key,
      { positions: [], normals: [], triangleCount: 0 },
    ]),
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
    const zoneTriangles = splitTriangleIntoMaterialZones(
      vertices,
      normals,
      bounds.min.y,
      rawLength,
    )

    for (const zoneTriangle of zoneTriangles) {
      const centroid = zoneTriangle
        .reduce((sum, vertex) => sum.add(vertex.position), new Vector3())
        .multiplyScalar(1 / 3)
      const normalizedLength = (centroid.y - bounds.min.y) / rawLength
      const radialDistance = Math.hypot(centroid.x - center.x, centroid.z - center.z)
      const materialKey = selectMaterial({ normalizedLength, radialDistance })
      const bucket = buckets[materialKey]
      const transformedVertices = zoneTriangle.map((vertex) =>
        vertex.position.clone().applyMatrix4(transform),
      )

      transformedVertices.forEach((vertex) => {
        bucket.positions.push(vertex.x, vertex.y, vertex.z)
      })
      zoneTriangle.forEach((vertex) => {
        const transformedNormal = vertex.normal.clone().transformDirection(transform)
        bucket.normals.push(transformedNormal.x, transformedNormal.y, transformedNormal.z)
      })

      bucket.triangleCount += 1
      previewTriangles.push({ materialKey, vertices: transformedVertices })
    }
  }

  const group = new Group()
  group.name = 'Aster 30'

  for (const [materialKey, bucket] of Object.entries(buckets)) {
    if (bucket.positions.length === 0) continue

    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(bucket.positions, 3))
    if (bucket.normals.length > 0) {
      geometry.setAttribute('normal', new Float32BufferAttribute(bucket.normals, 3))
      geometry.normalizeNormals()
    } else {
      geometry.computeVertexNormals()
    }

    const definition = MATERIAL_DEFINITIONS[materialKey]
    const material = new MeshStandardMaterial({
      color: definition.color,
      metalness: definition.metalness,
      roughness: definition.roughness,
    })
    material.name = definition.name

    const mesh = new Mesh(geometry, material)
    mesh.name = material.name
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  }

  return { group, previewTriangles, buckets, rawLength, scale }
}

function renderPreview(triangles, outputPath) {
  const width = 1400
  const height = 520
  const padding = 54
  const pixels = Buffer.alloc(width * height * 3, 11)
  const depthBuffer = new Float64Array(width * height)
  depthBuffer.fill(Number.NEGATIVE_INFINITY)

  const viewAngle = Math.PI / 7
  const toViewSpace = (point) => ({
    x: point.x,
    y: point.y * Math.cos(viewAngle) + point.z * Math.sin(viewAngle),
    z: -point.y * Math.sin(viewAngle) + point.z * Math.cos(viewAngle),
  })

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const triangle of triangles) {
    for (const point of triangle.vertices) {
      const viewPoint = toViewSpace(point)
      minX = Math.min(minX, viewPoint.x)
      maxX = Math.max(maxX, viewPoint.x)
      minZ = Math.min(minZ, viewPoint.z)
      maxZ = Math.max(maxZ, viewPoint.z)
    }
  }
  const scale = Math.min(
    (width - padding * 2) / (maxX - minX),
    (height - padding * 2) / (maxZ - minZ),
  )
  const offsetX = (width - (maxX - minX) * scale) / 2
  const offsetY = (height - (maxZ - minZ) * scale) / 2
  const light = new Vector3(0.25, 0.9, 0.55).normalize()

  const project = (point) => ({
    ...toViewSpace(point),
    x: offsetX + (point.x - minX) * scale,
    y: height - (offsetY + (toViewSpace(point).z - minZ) * scale),
    depth: toViewSpace(point).y,
  })

  for (const triangle of triangles) {
    const [a3, b3, c3] = triangle.vertices
    const [a, b, c] = triangle.vertices.map(project)
    const signedArea = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
    if (Math.abs(signedArea) < 0.01) continue

    const faceNormal = new Vector3()
      .subVectors(b3, a3)
      .cross(new Vector3().subVectors(c3, a3))
      .normalize()
    const viewFacing = faceNormal.y * Math.cos(viewAngle) + faceNormal.z * Math.sin(viewAngle)
    if (viewFacing <= 0.001) continue
    const lighting = Math.min(1.12, Math.max(0.44, 0.7 + Math.abs(faceNormal.dot(light)) * 0.42))
    const baseColor = MATERIAL_DEFINITIONS[triangle.materialKey].preview
    const color = baseColor.map((channel) => Math.min(255, Math.round(channel * lighting)))

    const minPixelX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)))
    const maxPixelX = Math.min(width - 1, Math.ceil(Math.max(a.x, b.x, c.x)))
    const minPixelY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)))
    const maxPixelY = Math.min(height - 1, Math.ceil(Math.max(a.y, b.y, c.y)))
    const denominator =
      (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y)
    if (Math.abs(denominator) < Number.EPSILON) continue

    for (let y = minPixelY; y <= maxPixelY; y += 1) {
      for (let x = minPixelX; x <= maxPixelX; x += 1) {
        const sampleX = x + 0.5
        const sampleY = y + 0.5
        const wa =
          ((b.y - c.y) * (sampleX - c.x) + (c.x - b.x) * (sampleY - c.y)) /
          denominator
        const wb =
          ((c.y - a.y) * (sampleX - c.x) + (a.x - c.x) * (sampleY - c.y)) /
          denominator
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
  fs.writeFileSync(ppmPath, Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), pixels]))
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
  const { group, previewTriangles, buckets, rawLength, scale } = buildColoredMeshes(sourceGeometry)
  const scene = new Scene()
  scene.name = 'Aster 30 colored asset'
  scene.add(group)

  const exporter = new GLTFExporter()
  const binary = await exporter.parseAsync(scene, {
    binary: true,
    onlyVisible: true,
    truncateDrawRange: true,
  })

  const modelPath = path.join(outputDirectory, 'aster-30-colored.glb')
  const previewPath = path.join(outputDirectory, 'aster-30-colored-preview.png')
  const sourceCopyPath = path.join(outputDirectory, 'cad_aster_30.stl')
  const referenceCopyPath = path.join(outputDirectory, 'aster_30_reference.webp')

  fs.writeFileSync(modelPath, Buffer.from(binary))
  renderPreview(previewTriangles, previewPath)
  fs.copyFileSync(inputPath, sourceCopyPath)
  fs.copyFileSync(referencePath, referenceCopyPath)

  const materialSummary = Object.entries(buckets)
    .filter(([, bucket]) => bucket.triangleCount > 0)
    .map(([material, bucket]) => `${material}: ${bucket.triangleCount}`)
    .join(', ')

  console.log(`Aster 30 GLB: ${modelPath}`)
  console.log(`Preview: ${previewPath}`)
  console.log(`Raw length: ${rawLength.toFixed(3)} units; scale: ${scale.toFixed(6)} m/unit`)
  console.log(`Materials: ${materialSummary}`)
}

await main()
