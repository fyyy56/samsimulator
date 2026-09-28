import { BoundingSphere, Cartesian3, SceneTransforms, Texture } from 'cesium';

// A small screen-space depth/color proxy for the existing translucent puff
// billboards. Cesium's opaque depth texture does not contain those billboards.
export function createCloudSmokeOverlay(scene) {
  const layer = document.createElement('canvas');
  const depth = document.createElement('canvas');
  const layer2d = layer.getContext('2d');
  const depth2d = depth.getContext('2d');
  let colorTexture, depthTexture;
  const reset = (width, height) => {
    layer.width = depth.width = width;
    layer.height = depth.height = height;
    colorTexture?.destroy(); depthTexture?.destroy();
    colorTexture = new Texture({ context: scene.context, source: layer });
    depthTexture = new Texture({ context: scene.context, source: depth });
  };
  reset(1, 1);
  return {
    colorTexture: () => colorTexture,
    depthTexture: () => depthTexture,
    update(puffs, night) {
      const viewer = scene.camera;
      const scale = .25;
      const width = Math.max(1, Math.round(scene.canvas.clientWidth * scale));
      const height = Math.max(1, Math.round(scene.canvas.clientHeight * scale));
      if (layer.width !== width || layer.height !== height) reset(width, height);
      layer2d.clearRect(0, 0, width, height);
      depth2d.clearRect(0, 0, width, height);
      const visible = [];
      for (const puff of puffs) {
        const position = puff.entity.position?.getValue(scene.frameState.time);
        if (!position) continue;
        const delta = Cartesian3.subtract(position, viewer.positionWC, new Cartesian3());
        const distance = Cartesian3.magnitude(delta);
        if (distance < 2 || distance > 65000
          || Cartesian3.dot(viewer.directionWC, delta) <= 0) continue;
        const screen = SceneTransforms.worldToWindowCoordinates(scene, position);
        if (!screen) continue;
        const physicalSize = puff.entity.billboard.width.getValue(scene.frameState.time)
          * (puff.entity.billboard.scale?.getValue(scene.frameState.time) ?? 1);
        const pixelSize = viewer.getPixelSize(new BoundingSphere(position, physicalSize / 2),
          scene.canvas.clientWidth, scene.canvas.clientHeight);
        const radius = Math.min(160, physicalSize * .42 / Math.max(pixelSize, .02) * scale);
        const x = screen.x * scale, y = screen.y * scale;
        if (radius < .7 || x < -radius || x > width + radius
          || y < -radius || y > height + radius) continue;
        const opacity = puff.entity.billboard.color?.getValue(scene.frameState.time)?.alpha ?? 1;
        if (opacity < .002) continue;
        visible.push({x,y,radius,distance,opacity});
      }
      // Far to near: the last radial footprint is the nearest visible smoke.
      visible.sort((a,b) => b.distance - a.distance);
      for (const puff of visible.slice(-320)) {
        const {x,y,radius,distance,opacity} = puff;
        const normalized = Math.min(1, distance / 80000);
        const encoded = normalized * 255;
        const red = Math.floor(encoded), green = Math.floor((encoded - red) * 255);
        const shade = night ? 78 : 210;
        const color = layer2d.createRadialGradient(x,y,0,x,y,radius);
        color.addColorStop(0, 'rgba(' + shade + ',' + shade + ',' + shade + ',' + .86 * opacity + ')');
        color.addColorStop(.52, 'rgba(' + shade + ',' + shade + ',' + shade + ',' + .46 * opacity + ')');
        color.addColorStop(1, 'rgba(' + shade + ',' + shade + ',' + shade + ',0)');
        layer2d.fillStyle = color;
        layer2d.fillRect(x-radius,y-radius,radius*2,radius*2);
        const mask = depth2d.createRadialGradient(x,y,0,x,y,radius);
        const rgb = red + ',' + green + ',0,';
        mask.addColorStop(0, 'rgba(' + rgb + '1)');
        mask.addColorStop(.65, 'rgba(' + rgb + '.85)');
        mask.addColorStop(1, 'rgba(' + rgb + '0)');
        depth2d.fillStyle = mask;
        depth2d.fillRect(x-radius,y-radius,radius*2,radius*2);
      }
      colorTexture.copyFrom({source: layer});
      depthTexture.copyFrom({source: depth});
    },
    destroy() { colorTexture?.destroy(); depthTexture?.destroy(); },
  };
}
