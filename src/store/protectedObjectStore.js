import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const PROTECTED_OBJECT_STORAGE_KEY = 'samSimulator.protectedObjects.v1';
export const PROTECTED_OBJECT_SCHEMA_VERSION = 1;

export const PROTECTED_OBJECT_TYPE = Object.freeze({
  ENERGY: 'ENERGY',
  LOGISTICS: 'LOGISTICS',
  AIRFIELD: 'AIRFIELD',
  PORT: 'PORT',
  INDUSTRIAL: 'INDUSTRIAL',
  COMMAND: 'COMMAND',
  RADAR: 'RADAR',
  CIVIL: 'CIVIL',
  OTHER: 'OTHER',
});

export const PROTECTED_OBJECT_TYPES = Object.freeze(Object.values(PROTECTED_OBJECT_TYPE));

const DEFAULT_CAMERA = Object.freeze({ longitude: 31.2, latitude: 48.7, zoom: 5.2, mapStyle: 'SATELLITE_LABELS' });
const isFiniteCoordinate = value => Number.isFinite(Number(value));

export const normalizeProtectedObject = (object, fallbackId) => {
  if (!object || typeof object !== 'object') return null;
  const type = PROTECTED_OBJECT_TYPES.includes(object.type) ? object.type : PROTECTED_OBJECT_TYPE.OTHER;
  const lat = Number(object.lat);
  const lon = Number(object.lon ?? object.lng);
  if (!isFiniteCoordinate(lat) || !isFiniteCoordinate(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const now = new Date().toISOString();
  return {
    id: String(object.id || fallbackId),
    name: String(object.name ?? '').trim() || 'Безымянный объект',
    settlement: String(object.settlement ?? '').trim(),
    region: String(object.region ?? '').trim(),
    type,
    lat,
    lon,
    notes: String(object.notes ?? '').trim(),
    enabled: object.enabled !== false,
    createdAt: object.createdAt ?? now,
    updatedAt: object.updatedAt ?? now,
  };
};

const idNumber = id => Number(String(id).match(/^OBJ-(\d+)$/)?.[1] ?? 0);
export const nextProtectedObjectId = objects => {
  const next = objects.reduce((maximum, object) => Math.max(maximum, idNumber(object.id)), 0) + 1;
  return `OBJ-${String(next).padStart(4, '0')}`;
};

export const validateProtectedObjectImport = payload => {
  if (!payload || typeof payload !== 'object' || payload.version !== PROTECTED_OBJECT_SCHEMA_VERSION || !Array.isArray(payload.objects)) {
    throw new Error('Неверная схема файла. Ожидается version: 1 и массив objects.');
  }
  const normalized = payload.objects.map((object, index) => normalizeProtectedObject(object, `IMPORT-${index + 1}`));
  if (normalized.some(object => object === null)) throw new Error('Файл содержит объект с некорректными координатами.');
  return normalized;
};

export const mergeImportedObjects = (currentObjects, importedObjects) => {
  const result = [...currentObjects];
  const usedIds = new Set(result.map(object => object.id));
  importedObjects.forEach(imported => {
    let candidate = imported.id;
    if (usedIds.has(candidate)) candidate = nextProtectedObjectId(result);
    const object = { ...imported, id: candidate };
    usedIds.add(candidate);
    result.push(object);
  });
  return result;
};

export const useProtectedObjectStore = create(persist((set, get) => ({
  objects: [],
  editorCamera: { ...DEFAULT_CAMERA },
  addObject: draft => {
    const id = nextProtectedObjectId(get().objects);
    const object = normalizeProtectedObject({ ...draft, id }, id);
    if (!object) return null;
    set(state => ({ objects: [...state.objects, object] }));
    return id;
  },
  updateObject: (id, patch) => set(state => ({
    objects: state.objects.map(object => object.id === id
      ? normalizeProtectedObject({ ...object, ...patch, id, updatedAt: new Date().toISOString() }, id)
      : object),
  })),
  deleteObject: id => set(state => ({ objects: state.objects.filter(object => object.id !== id) })),
  importObjects: imported => set(state => ({ objects: mergeImportedObjects(state.objects, imported) })),
  setEditorCamera: editorCamera => set(state => ({ editorCamera: { ...state.editorCamera, ...editorCamera } })),
}), {
  name: PROTECTED_OBJECT_STORAGE_KEY,
  version: PROTECTED_OBJECT_SCHEMA_VERSION,
  storage: createJSONStorage(() => localStorage),
  partialize: state => ({ objects: state.objects, editorCamera: state.editorCamera }),
}));

export const getProtectedObject = id => useProtectedObjectStore.getState().objects.find(object => object.id === id) ?? null;
export const getEnabledProtectedObjects = () => useProtectedObjectStore.getState().objects.filter(object => object.enabled);
export const getObjectsByType = type => getEnabledProtectedObjects().filter(object => object.type === type);
export const getProtectedObjectAimPoint = id => {
  const object = getProtectedObject(id);
  return object ? { lat: object.lat, lon: object.lon } : null;
};
