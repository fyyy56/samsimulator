import {
  Viewer, Cartesian2, Cartesian3, Color, DistanceDisplayCondition, EllipsoidTerrainProvider,
  HeadingPitchRoll, HeightReference, HorizontalOrigin, LabelStyle, Math as CesiumMath,
  Matrix4, NearFarScalar, Transforms, VerticalOrigin,
} from 'cesium';
import {
  ADVANCED_GROUND_ASSETS,
  getAdvancedInterceptorPresentation,
  resolveAdvancedAssetPresentation,
} from '../src/data/advanced3dRegistry.js';
import { createOrientation } from '../src/scenes/advanced/modelOrientation.js';

const viewer = new Viewer('viewer', {
  baseLayer: false, terrainProvider: new EllipsoidTerrainProvider(), animation: false,
  timeline: false, baseLayerPicker: false, geocoder: false, homeButton: false,
  sceneModePicker: false, navigationHelpButton: false, infoBox: false, selectionIndicator: false,
});
viewer.scene.globe.baseColor = Color.fromCssColorString('#172a31');
viewer.scene.skyAtmosphere.show = false;
viewer.scene.backgroundColor = Color.fromCssColorString('#071118');

const controls = document.getElementById('controls');
const output = document.createElement('output');
const selector = document.createElement('select');
selector.innerHTML = '<option value="ALL">ALL ASSETS</option>';
selector.style.cssText = 'color:#cde7e2;background:#102833;border:1px solid #8dd8c544;padding:7px';
controls.append(selector);
const failures = [];
viewer.scene.renderError.addEventListener((_scene, error) => failures.push(String(error)));
const center = { lat: 50, lng: 30 };
const groundEntries = Object.values(ADVANCED_GROUND_ASSETS);
const missileEntries = [
  ['INT-9M331-V1', '9M331'],
  ['INT-LONG-V1', 'PAC-3'], ['INT-MEDIUM-V1', 'AIM-120'],
  ['INT-SHORT-V1', 'IRIS-T'], ['INT-ASTER30-V1', 'Aster 30'],
].map(([interceptorSpecId, displayName]) => ({
  ...getAdvancedInterceptorPresentation({ interceptorSpecId }), displayName,
}));
const placements = new Map();

const positionFor = (index, altitudeM = 0) => {
  const columns = 4;
  const row = Math.floor(index / columns);
  const column = index % columns;
  return { lat: center.lat + (1.5 - row) * 0.00032,
    lng: center.lng + (column - 1.5) * 0.00042, altitudeM };
};
const label = (text, offsetM) => ({
  text, font: '12px monospace', fillColor: Color.fromCssColorString('#d4f3e9'),
  outlineColor: Color.BLACK, outlineWidth: 3, style: LabelStyle.FILL_AND_OUTLINE,
  pixelOffset: new Cartesian2(0, -20), distanceDisplayCondition: new DistanceDisplayCondition(0, 12_000),
  heightReference: offsetM ? HeightReference.NONE : HeightReference.CLAMP_TO_GROUND,
});

groundEntries.forEach((presentation, index) => {
  const resolved = resolveAdvancedAssetPresentation(presentation);
  const placement = positionFor(index, presentation.groundOffsetM);
  const position = Cartesian3.fromDegrees(placement.lng, placement.lat, placement.altitudeM);
  const orientation = Transforms.headingPitchRollQuaternion(position, new HeadingPitchRoll(
    CesiumMath.toRadians(presentation.yawOffsetDeg),
    CesiumMath.toRadians(presentation.pitchOffsetDeg),
    CesiumMath.toRadians(presentation.rollOffsetDeg)));
  viewer.entities.add({
    id: `GROUND:${presentation.key}`, position, orientation,
    model: resolved.renderType === 'MODEL' ? {
      uri: resolved.modelUri, scale: resolved.uniformScale, minimumPixelSize: 0,
      maximumScale: resolved.uniformScale, runAnimations: false,
    } : undefined,
    billboard: resolved.renderType === 'BILLBOARD' ? {
      image: resolved.fallbackAsset, sizeInMeters: false,
      width: 112,
      height: Math.round(112 * presentation.billboardDimensionsM.height
        / presentation.billboardDimensionsM.width),
      verticalOrigin: VerticalOrigin.BOTTOM, horizontalOrigin: HorizontalOrigin.CENTER,
      heightReference: HeightReference.NONE,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      scaleByDistance: new NearFarScalar(40, 1, 80_000, 0.22),
    } : undefined,
    label: label(`${presentation.displayName} · ${resolved.renderType}`, presentation.labelOffsetM.z),
  });
  placements.set(`GROUND:${presentation.key}`, placement);
  selector.add(new Option(presentation.displayName, `GROUND:${presentation.key}`));
});

missileEntries.forEach((presentation, missileIndex) => {
  const index = groundEntries.length + missileIndex;
  const placement = positionFor(index, 8);
  const position = Cartesian3.fromDegrees(placement.lng, placement.lat, placement.altitudeM);
  const resolved = resolveAdvancedAssetPresentation(presentation);
  viewer.entities.add({
    id: `MISSILE:${presentation.key}`, position,
    orientation: createOrientation(position, { headingDeg: 0, pitchDeg: 0, rollDeg: 0 }, presentation),
    model: resolved.renderType === 'MODEL' ? {
      uri: resolved.modelUri, scale: resolved.uniformScale, minimumPixelSize: 0,
      maximumScale: resolved.uniformScale, runAnimations: false,
    } : undefined,
    billboard: resolved.renderType === 'BILLBOARD' ? {
      image: resolved.fallbackAsset, sizeInMeters: true,
      width: presentation.billboardDimensionsM?.width ?? presentation.physicalLengthMeters,
      height: presentation.billboardDimensionsM?.height ?? presentation.physicalLengthMeters / 6,
      alignedAxis: Cartesian3.UNIT_Z,
    } : undefined,
    label: label(`${presentation.displayName} · ${resolved.renderType}`, 10),
  });
  placements.set(`MISSILE:${presentation.key}`, placement);
  selector.add(new Option(presentation.displayName, `MISSILE:${presentation.key}`));
});

const setView = view => {
  const selected = placements.get(selector.value);
  const focus = selected ?? { ...center, altitudeM: 0 };
  const target = Cartesian3.fromDegrees(focus.lng, focus.lat, focus.altitudeM);
  const distance = selected ? 34 : 310;
  const enu = Transforms.eastNorthUpToFixedFrame(target);
  const localOffset = view === 'TOP' ? new Cartesian3(0, 0, distance)
    : view === 'FRONT' ? new Cartesian3(0, -distance, distance * 0.22)
      : view === 'REAR' ? new Cartesian3(0, distance, distance * 0.22)
        : new Cartesian3(-distance, 0, distance * 0.22);
  const destination = Matrix4.multiplyByPoint(enu, localOffset, new Cartesian3());
  const localUp = view === 'TOP' ? Cartesian3.UNIT_Y : Cartesian3.UNIT_Z;
  const worldUp = Matrix4.multiplyByPointAsVector(enu, localUp, new Cartesian3());
  viewer.camera.setView({ destination, orientation: {
    direction: Cartesian3.normalize(Cartesian3.subtract(target, destination, new Cartesian3()), new Cartesian3()),
    up: worldUp,
  } });
};
for (const view of ['SIDE', 'FRONT', 'REAR', 'TOP']) {
  const button = document.createElement('button');
  button.textContent = view; button.onclick = () => setView(view); controls.append(button);
}
selector.onchange = () => {
  for (const entity of viewer.entities.values) {
    if (!entity.id.startsWith('GROUND:') && !entity.id.startsWith('MISSILE:')) continue;
    entity.show = selector.value === 'ALL' || entity.id === selector.value;
  }
  setView('SIDE');
};
controls.append(output);
viewer.scene.postRender.addEventListener(() => {
  const models = groundEntries.filter(item => item.modelUri).length + missileEntries.filter(item => item.modelUri).length;
  const fallbacks = groundEntries.length + missileEntries.length - models;
  output.textContent = `${models} GLB · ${fallbacks} BILLBOARD · ${failures.length ? failures.join('; ') : 'NO RENDER ERRORS'}`;
});
setView('SIDE');
