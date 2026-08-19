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
        scene.primitives.add(model);
        scene.camera.lookAt(
          origin,
          new CesiumApi.HeadingPitchRange(0.65, -0.28, 45),
        );
        scene.screenSpaceCameraController.enableZoom = true;
        scene.screenSpaceCameraController.enableRotate = true;
        scene.screenSpaceCameraController.enableTilt = true;
        scene.screenSpaceCameraController.enableTranslate = false;
        setStatus('READY');

        const resize = () => {
          if (!canvas || !scene) return;
          const ratio = Math.min(window.devicePixelRatio || 1, 2);
          const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
          const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
          if (canvas.width !== width) canvas.width = width;
          if (canvas.height !== height) canvas.height = height;
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
            const sphere = model.boundingSphere;
            scene.camera.lookAt(
              sphere.center,
              new CesiumApi.HeadingPitchRange(
                0.65,
                -0.28,
                Math.max(sphere.radius * 2.8, 12),
              ),
            );
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
      if (scene && !scene.isDestroyed()) scene.destroy();
    };
  }, [activeModelUrl]);

  const uploadModel = event => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (uploadedModelUrl) URL.revokeObjectURL(uploadedModelUrl);
    setUploadedModelUrl(URL.createObjectURL(file));
    event.target.value = '';
  };

  return <section className={`reference-model ${activeModelUrl ? 'has-model' : 'is-empty'}`}>
    <canvas ref={canvasRef} aria-label={`3D-модель ${item.name}`} />
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
