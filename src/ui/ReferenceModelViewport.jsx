import { useEffect, useRef, useState } from 'react';

export default function ReferenceModelViewport({ item, modelUrl = null, fallbackAsset = null }) {
  const canvasRef = useRef(null);
  const autoRotateRef = useRef(true);
  const [autoRotate, setAutoRotate] = useState(true);
  const [uploadedModelUrl, setUploadedModelUrl] = useState(null);
  const [status, setStatus] = useState(modelUrl ? 'LOADING' : 'EMPTY');
  const activeModelUrl = uploadedModelUrl ?? modelUrl;

  useEffect(() => {
    autoRotateRef.current = autoRotate;
  }, [autoRotate]);

  useEffect(() => () => {
    if (uploadedModelUrl) URL.revokeObjectURL(uploadedModelUrl);
  }, [uploadedModelUrl]);

  useEffect(() => {
    if (!activeModelUrl || !canvasRef.current) {
      setStatus('EMPTY');
      return undefined;
    }

    let disposed = false;
    let frameId = 0;
    let scene = null;
    let resizeObserver = null;
    let model = null;
    let baseModelMatrix = null;
    let CesiumApi = null;
    let cameraFramed = false;
    let frameSphere = null;
    let removeInputListeners = null;
    let dragging = false;
    let dragX = 0;
    let dragY = 0;
    const missilePreview = item.previewCameraPreset === 'TOP_VIEW_MISSILE';
    const view = {
      heading: missilePreview ? 0.78 : 0.65,
      pitch: missilePreview ? -0.2 : -0.28,
      range: 45,
    };
    const startedAt = performance.now();

    const initialize = async () => {
      try {
        setStatus('LOADING');
        CesiumApi = await import('cesium');
        if (disposed) return;
        const canvas = canvasRef.current;
        scene = new CesiumApi.Scene({
          canvas,
          contextOptions: { webgl: { alpha: true, antialias: true } },
        });
        scene.backgroundColor = CesiumApi.Color.TRANSPARENT;
        scene.skyBox = undefined;
        scene.sun = undefined;
        scene.moon = undefined;
        scene.fog.enabled = false;
        const keyLightDirection = CesiumApi.Cartesian3.normalize(
          new CesiumApi.Cartesian3(-1, -0.55, -0.8),
          new CesiumApi.Cartesian3(),
        );
        scene.light = new CesiumApi.DirectionalLight({
          direction: keyLightDirection,
          color: CesiumApi.Color.fromCssColorString('#f4f7f2'),
          intensity: 2.15,
        });

        const origin = CesiumApi.Cartesian3.fromDegrees(0, 0, 0);
        baseModelMatrix = CesiumApi.Transforms.eastNorthUpToFixedFrame(origin);
        model = await CesiumApi.Model.fromGltfAsync({
          url: activeModelUrl,
          modelMatrix: CesiumApi.Matrix4.clone(baseModelMatrix),
          minimumPixelSize: 180,
          maximumScale: 20_000,
        });
        if (disposed) {
          model.destroy();
          return;
        }
        // A neutral studio-like fill keeps dark vehicle textures readable
        // without flattening their materials or washing out the camouflage.
        model.imageBasedLighting.imageBasedLightingFactor = new CesiumApi.Cartesian2(1, 1);
        model.imageBasedLighting.sphericalHarmonicCoefficients = [
          new CesiumApi.Cartesian3(0.55, 0.56, 0.58),
          new CesiumApi.Cartesian3(0, 0, 0),
          new CesiumApi.Cartesian3(0.045, 0.05, 0.058),
          new CesiumApi.Cartesian3(-0.022, -0.022, -0.018),
          new CesiumApi.Cartesian3(0, 0, 0),
          new CesiumApi.Cartesian3(0, 0, 0),
          new CesiumApi.Cartesian3(0, 0, 0),
          new CesiumApi.Cartesian3(0, 0, 0),
          new CesiumApi.Cartesian3(0, 0, 0),
        ];
        scene.primitives.add(model);
        scene.camera.lookAt(
          origin,
          new CesiumApi.HeadingPitchRange(0.65, -0.28, 45),
        );
        scene.screenSpaceCameraController.enableInputs = false;
        scene.screenSpaceCameraController.enableTranslate = false;
        setStatus('READY');

        const updateCamera = () => {
          if (!frameSphere) return;
          scene.camera.lookAt(
            frameSphere.center,
            new CesiumApi.HeadingPitchRange(view.heading, view.pitch, view.range),
          );
        };
        const pointerDown = event => {
          if (event.button !== 0) return;
          dragging = true;
          dragX = event.clientX;
          dragY = event.clientY;
          canvas.focus({ preventScroll: true });
          canvas.setPointerCapture(event.pointerId);
          event.preventDefault();
          event.stopPropagation();
        };
        const pointerMove = event => {
          if (!dragging) return;
          const deltaX = event.clientX - dragX;
          const deltaY = event.clientY - dragY;
          dragX = event.clientX;
          dragY = event.clientY;
          view.heading -= deltaX * 0.007;
          view.pitch = Math.max(-1.35, Math.min(0.15, view.pitch + deltaY * 0.005));
          updateCamera();
          event.preventDefault();
          event.stopPropagation();
        };
        const pointerUp = event => {
          dragging = false;
          if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
        };
        const wheel = event => {
          if (!frameSphere) return;
          const minimumRange = Math.max(frameSphere.radius * 1.15, 5);
          const maximumRange = Math.max(frameSphere.radius * 8, 80);
          view.range = Math.max(minimumRange, Math.min(maximumRange, view.range * Math.exp(event.deltaY * 0.001)));
          updateCamera();
          event.preventDefault();
          event.stopPropagation();
        };
        canvas.addEventListener('pointerdown', pointerDown);
        canvas.addEventListener('pointermove', pointerMove);
        canvas.addEventListener('pointerup', pointerUp);
        canvas.addEventListener('pointercancel', pointerUp);
        canvas.addEventListener('wheel', wheel, { passive: false });
        removeInputListeners = () => {
          canvas.removeEventListener('pointerdown', pointerDown);
          canvas.removeEventListener('pointermove', pointerMove);
          canvas.removeEventListener('pointerup', pointerUp);
          canvas.removeEventListener('pointercancel', pointerUp);
          canvas.removeEventListener('wheel', wheel);
        };

        const resize = () => {
          if (!canvas || !scene) return;
          const ratio = Math.min(window.devicePixelRatio || 1, 2);
          const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
          const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
          if (canvas.width !== width) canvas.width = width;
          if (canvas.height !== height) canvas.height = height;
          if ('aspectRatio' in scene.camera.frustum) {
            scene.camera.frustum.aspectRatio = width / height;
          }
        };
        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(canvas);

        const render = (time) => {
          if (disposed || !scene || scene.isDestroyed()) return;
          resize();
          if (autoRotateRef.current && model && baseModelMatrix) {
            const angle = (time - startedAt) * 0.00016;
            const rotation = CesiumApi.Matrix4.fromRotationTranslation(
              CesiumApi.Matrix3.fromRotationZ(angle),
              CesiumApi.Cartesian3.ZERO,
            );
            CesiumApi.Matrix4.multiply(baseModelMatrix, rotation, model.modelMatrix);
          }
          scene.render();
          if (!cameraFramed && model?.ready && model.boundingSphere) {
            frameSphere = CesiumApi.BoundingSphere.clone(model.boundingSphere);
            view.range = missilePreview
              ? Math.max(frameSphere.radius * 2.35, 6.2)
              : Math.max(frameSphere.radius * 3.2, 14);
            updateCamera();
            cameraFramed = true;
          }
          frameId = requestAnimationFrame(render);
        };
        frameId = requestAnimationFrame(render);
      } catch (error) {
        if (!disposed) {
          console.error('Reference 3D model failed to load', error);
          setStatus('ERROR');
        }
      }
    };

    initialize();
    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      removeInputListeners?.();
      if (scene && !scene.isDestroyed()) scene.destroy();
    };
  }, [activeModelUrl, item.previewCameraPreset]);

  const uploadModel = event => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (uploadedModelUrl) URL.revokeObjectURL(uploadedModelUrl);
    setUploadedModelUrl(URL.createObjectURL(file));
    event.target.value = '';
  };

  return <section className={`reference-model ${activeModelUrl ? 'has-model' : 'is-empty'}`}>
    <canvas ref={canvasRef} data-design-ui data-design-model-canvas tabIndex={-1} aria-label={`3D-модель ${item.name}`} />
    {!activeModelUrl && <div className="reference-model__placeholder">
      {fallbackAsset && <img src={fallbackAsset.src} alt="" />}
      <span>3D MODEL SLOT</span>
      <strong>{item.name}</strong>
      <small>Добавьте GLB в src/assets/models или откройте файл для проверки</small>
    </div>}
    {status === 'LOADING' && <div className="reference-model__status">ЗАГРУЗКА 3D…</div>}
    {status === 'ERROR' && <div className="reference-model__status is-error">МОДЕЛЬ НЕ ЗАГРУЖЕНА · РЕКОМЕНДУЕТСЯ GLB</div>}
    <div className="reference-model__controls">
      <label>Открыть GLB / GLTF<input type="file" accept=".glb,.gltf,model/gltf-binary,model/gltf+json" onChange={uploadModel} /></label>
      {activeModelUrl && <button onClick={() => setAutoRotate(value => !value)}>{autoRotate ? 'Автовращение: ON' : 'Автовращение: OFF'}</button>}
      {uploadedModelUrl && <button onClick={() => setUploadedModelUrl(null)}>Убрать тестовую модель</button>}
    </div>
    {status === 'READY' && <small className="reference-model__hint">Зажмите мышь, чтобы повернуть · колесо — масштаб</small>}
    {item.model3dCredit && <a
      className="reference-model__credit"
      href={item.model3dSource}
      target="_blank"
      rel="noreferrer"
    >
      3D: {item.model3dCredit}
    </a>}
  </section>;
}
