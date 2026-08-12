export const TEST_RAID_SCENARIO = Object.freeze({
  id: 'SCENARIO-01',
  name: 'TEST RAID',
  startTimeSeconds: 20 * 3600,
  targets: [
    {
      id: 'AIR-001', spawnOffsetSeconds: 3, type: 'CRUISE_TARGET',
      speedKmh: 820, altitudeM: 80,
      spawnPosition: { lat: 49.4, lng: 34.8 },
      route: [{ lat: 49.0, lng: 33.2 }, { lat: 48.5, lng: 31.0 }],
    },
    {
      id: 'AIR-002', spawnOffsetSeconds: 12, type: 'UAV_TARGET',
      speedKmh: 260, altitudeM: 140,
      spawnPosition: { lat: 50.0, lng: 36.0 },
      route: [{ lat: 49.5, lng: 34.0 }, { lat: 48.8, lng: 31.2 }],
    },
    {
      id: 'AIR-003', spawnOffsetSeconds: 22, type: 'UNKNOWN',
      speedKmh: 620, altitudeM: 900,
      spawnPosition: { lat: 51.0, lng: 34.2 },
      route: [{ lat: 50.4, lng: 32.8 }, { lat: 49.2, lng: 30.5 }],
    },
    {
      id: 'AIR-004', spawnOffsetSeconds: 34, type: 'CRUISE_TARGET',
      speedKmh: 900, altitudeM: 110,
      spawnPosition: { lat: 49.6, lng: 31.8 },
      route: [{ lat: 48.8, lng: 32.5 }, { lat: 47.8, lng: 31.0 }],
    },
    {
      id: 'AIR-005', spawnOffsetSeconds: 48, type: 'UAV_TARGET',
      speedKmh: 230, altitudeM: 170,
      spawnPosition: { lat: 50.8, lng: 31.0 },
      route: [{ lat: 50.2, lng: 30.5 }, { lat: 48.8, lng: 31.5 }],
    },
  ],
});
