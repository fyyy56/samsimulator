import { create } from 'zustand';

export function getDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))); 
}

export function getBearing(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;
  const dLon = (lon2 - lon1) * toRad;
  const y = Math.sin(dLon) * Math.cos(lat2 * toRad);
  const x = Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) - Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos(dLon);
  return ((Math.atan2(y, x) * toDeg) + 360) % 360;
}

export function generateRadarPolygon(lat, lng, radiusKm, sector = 360, heading = 0) {
  const points = 64;
  const coords = [];
  const R = 6371;
  const startAngle = heading - sector / 2;
  coords.push([lng, lat]);
  const steps = sector === 360 ? points : Math.max(10, Math.floor(points * (sector/360)));
  for (let i = 0; i <= steps; i++) {
    const brng = (startAngle + (sector * i / steps)) * Math.PI / 180;
    const d = radiusKm / R;
    const lat1 = lat * Math.PI / 180;
    const lon1 = lng * Math.PI / 180;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
    const lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    coords.push([lon2 * 180 / Math.PI, lat2 * 180 / Math.PI]);
  }
  coords.push([lng, lat]);
  return coords;
}

export function generateRadarBeam(lat, lng, radiusKm, currentAngle) {
  const R = 6371;
  const brng = currentAngle * Math.PI / 180;
  const d = radiusKm / R;
  const lat1 = lat * Math.PI / 180;
  const lon1 = lng * Math.PI / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
  const lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return [[lng, lat], [lon2 * 180 / Math.PI, lat2 * 180 / Math.PI]];
}

export const SYSTEM_CATALOG = {
  SHORT:  { type: 'IRIS-T SLS', radarRangeKm: 40,  missilesLeft: 4,  maxSpeedKmh: 2500, scanRateSec: 2.0, radarSector: 360 },
  MEDIUM: { type: 'NASAMS',     radarRangeKm: 80,  missilesLeft: 6,  maxSpeedKmh: 3600, scanRateSec: 3.0, radarSector: 360 },
  LONG:   { type: 'PATRIOT',    radarRangeKm: 150, missilesLeft: 16, maxSpeedKmh: 4200, scanRateSec: 0.1, radarSector: 120 }
};

export const useEngine = create((set, get) => ({
  simulationTime: 20 * 3600, 
  timeScale: 1,              
  hoveredTrackId: null,   
  selectedTrackId: null,  
  
  batteries: [],
  tracks: [
    { 
      id: 'TRK-001', type: 'CRUISE_MISSILE', status: 'PENDING', 
      baseHeading: 315, heading: 315, speed_kmh: 800, alt: 50,
      realLat: 45.0, realLng: 35.0, lat: 45.0, lng: 35.0,         
      distanceToSam: 0, visible: false 
    }
  ],
  missiles: [],

  deployPhase: null, draftBattery: null, buildMenuOpen: false, selectedCategory: null,
  
  toggleBuildMenu: () => set(state => ({ buildMenuOpen: !state.buildMenuOpen, selectedCategory: null })),
  setCategory: (cat) => set(state => ({ selectedCategory: state.selectedCategory === cat ? null : cat })),
  closeBuildMenu: () => set({ buildMenuOpen: false, selectedCategory: null }),

  startDeploy: (categoryKey) => {
    const template = SYSTEM_CATALOG[categoryKey];
    set({
      buildMenuOpen: false, selectedCategory: null, deployPhase: 'FDC',
      draftBattery: {
        id: `${template.type.split(' ')[0]}-${Math.floor(Math.random()*1000)}`,
        type: template.type, status: 'DEPLOYING',
        missilesLeft: template.missilesLeft, radarRangeKm: template.radarRangeKm,
        maxSpeedKmh: template.maxSpeedKmh, scanRateSec: template.scanRateSec,
        radarSector: template.radarSector, radarHeading: 0, 
        timeSinceLastScan: 0, currentAngle: 0, 
        components: { fdc: null, radar: null, launchers: [] }
      }
    });
  },

  handleMapClick: (lat, lng) => {
    const state = get();
    if (!state.deployPhase || state.deployPhase === 'RADAR_HEADING') {
      if (!state.deployPhase) state.clearSelection();
      return;
    }
    const draft = { ...state.draftBattery };
    let nextPhase = state.deployPhase;
    if (state.deployPhase === 'FDC') {
      draft.components.fdc = { lat, lng }; nextPhase = 'RADAR';
    } else if (state.deployPhase === 'RADAR') {
      draft.components.radar = { lat, lng };
      nextPhase = draft.radarSector < 360 ? 'RADAR_HEADING' : 'LAUNCHER';
    } else if (state.deployPhase === 'LAUNCHER') {
      draft.components.launchers.push({ lat, lng });
      if (draft.components.launchers.length >= 2) {
        draft.status = 'ACTIVE';
        set({ batteries: [...state.batteries, draft], deployPhase: null, draftBattery: null });
        return;
      }
    }
    set({ draftBattery: draft, deployPhase: nextPhase });
  },

  rotateRadar: (deg) => set(state => ({ draftBattery: { ...state.draftBattery, radarHeading: (state.draftBattery.radarHeading + deg + 360) % 360 } })),
  confirmRadarHeading: () => set({ deployPhase: 'LAUNCHER' }),

  setHoveredTrack: (id) => set({ hoveredTrackId: id }),
  setSelectedTrack: (id) => set(state => ({ selectedTrackId: state.selectedTrackId === id ? null : id })),
  clearSelection: () => set({ selectedTrackId: null }),
  setTimeScale: (scale) => set({ timeScale: scale }),

  fireMissile: () => {
    const state = get();
    const target = state.tracks.find(t => t.id === state.selectedTrackId);
    if (!target || !target.visible) return;

    let closestBattery = null; let minDistance = Infinity;
    state.batteries.forEach(b => {
      if (b.missilesLeft > 0 && b.components.radar) {
        const dist = getDistanceKm(target.lat, target.lng, b.components.radar.lat, b.components.radar.lng);
        if (dist <= b.radarRangeKm && dist < minDistance) { minDistance = dist; closestBattery = b; }
      }
    });
    if (!closestBattery) return; 

    const newMissile = {
      id: `MSL-${Date.now().toString().slice(-4)}`, targetId: target.id,
      realLat: closestBattery.components.launchers[0].lat, realLng: closestBattery.components.launchers[0].lng,
      lat: closestBattery.components.launchers[0].lat, lng: closestBattery.components.launchers[0].lng,
      speed_kmh: 600, // Ракета стартует с 600 км/ч
      maxSpeed: closestBattery.maxSpeedKmh,
      flightTime: 0   
    };
    set({ missiles: [...state.missiles, newMissile], batteries: state.batteries.map(b => b.id === closestBattery.id ? { ...b, missilesLeft: b.missilesLeft - 1 } : b) });
  },

  tick: () => set((state) => {
    if (state.timeScale === 0) return {};
    const deltaTimeSec = (1 / 30) * state.timeScale;
    
    const updatedBatteries = state.batteries.map(b => {
      if (!b.components.radar) return b;
      let newTimer = b.timeSinceLastScan + deltaTimeSec;
      if (newTimer >= b.scanRateSec) newTimer = 0;
      
      let angle = 0;
      if (b.radarSector === 360) {
        angle = (newTimer / b.scanRateSec) * 360;
      } else {
        const start = b.radarHeading - b.radarSector / 2;
        angle = start + (newTimer / b.scanRateSec) * b.radarSector;
      }

      return { ...b, timeSinceLastScan: newTimer, currentAngle: angle };
    });

    const newTracks = state.tracks.map(track => {
      const dynamicHeading = track.baseHeading + Math.sin(state.simulationTime / 30) * 25;
      const rad = dynamicHeading * (Math.PI / 180);
      const degreesPerTick = ((track.speed_kmh / 3600) / 111 / 30) * state.timeScale; 
      const newRealLat = track.realLat + Math.cos(rad) * degreesPerTick;
      const newRealLng = track.realLng + Math.sin(rad) * degreesPerTick;
      
      let isTracked = false; let minDist = Infinity; let updateDisplay = false;
      
      updatedBatteries.forEach(b => {
        if (!b.components.radar) return;
        const dist = getDistanceKm(newRealLat, newRealLng, b.components.radar.lat, b.components.radar.lng);
        if (dist > b.radarRangeKm) return;
        if (b.radarSector < 360) {
          const targetBrng = getBearing(b.components.radar.lat, b.components.radar.lng, newRealLat, newRealLng);
          let diff = Math.abs(targetBrng - b.radarHeading);
          if (diff > 180) diff = 360 - diff;
          if (diff > b.radarSector / 2) return; 
        }
        if (dist < minDist) minDist = dist;
        isTracked = true;
        if (b.timeSinceLastScan === 0 || b.scanRateSec <= 0.1) updateDisplay = true;
      });

      return { 
        ...track, heading: dynamicHeading, realLat: newRealLat, realLng: newRealLng, 
        lat: updateDisplay ? newRealLat : track.lat, lng: updateDisplay ? newRealLng : track.lng, 
        distanceToSam: Math.round(minDist), status: isTracked ? 'TRACKED' : 'PENDING', visible: isTracked 
      };
    });

    let activeMissiles = [];
    state.missiles.forEach(missile => {
      const target = newTracks.find(t => t.id === missile.targetId);
      if (!target) return; 

      let currentSpeed = missile.speed_kmh;
      let fTime = missile.flightTime + deltaTimeSec;
      
      if (fTime <= 8.0) {
        // Ускоряем ракету на 800 км/ч каждую секунду
        currentSpeed = Math.min(missile.maxSpeed, currentSpeed + 800 * deltaTimeSec);
      } else {
        // Торможение по инерции
        currentSpeed -= 200 * deltaTimeSec; 
      }

      // ИСПРАВЛЕНИЕ: Сваливание только если топливо кончилось И скорость упала ниже 400
      if (fTime > 8.0 && currentSpeed < 400) {
        set(st => st.selectedTrackId === target.id ? { selectedTrackId: null } : {});
        return; 
      }

      const angle = Math.atan2(target.lng - missile.realLng, target.lat - missile.realLat); 
      const degreesPerTick = ((currentSpeed / 3600) / 111 / 30) * state.timeScale;
      const nextRealLat = missile.realLat + Math.cos(angle) * degreesPerTick;
      const nextRealLng = missile.realLng + Math.sin(angle) * degreesPerTick;

      if (getDistanceKm(nextRealLat, nextRealLng, target.realLat, target.realLng) < 1.0) {
        newTracks.splice(newTracks.findIndex(t => t.id === target.id), 1);
        set(st => st.selectedTrackId === target.id ? { selectedTrackId: null } : {});
      } else {
        activeMissiles.push({ 
          ...missile, speed_kmh: currentSpeed, flightTime: fTime,
          realLat: nextRealLat, realLng: nextRealLng, lat: nextRealLat, lng: nextRealLng 
        });
      }
    });

    return { simulationTime: state.simulationTime + deltaTimeSec, batteries: updatedBatteries, tracks: newTracks, missiles: activeMissiles };
  })
}));
