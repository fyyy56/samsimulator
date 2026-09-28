import { CallbackPositionProperty } from 'cesium';

// Tor's small depth-tested flame lobes, shared with terminal control jets.
// Consumers own the force/event direction and buffered model attachment.
export const createMiniControlJet = (viewer, image, getPosition, count = 8) => (
  Array.from({ length: count }, (_, index) => viewer.entities.add({
    position: new CallbackPositionProperty((time, result) => getPosition(index, time, result), false),
    billboard: { image, sizeInMeters: true, width: 1, height: 1, disableDepthTestDistance: 0 },
  }))
);
