export const THEATER_OBJECTS = Object.freeze([
  { id: 'KYIV', name: 'Kyiv', category: 'MAJOR CITY', protectionPriority: 1, description: 'Столица и крупнейший административный центр.', position: { lat: 50.4501, lng: 30.5234 } },
  { id: 'ODESA_PORT', name: 'Odesa Port', category: 'PORT AREA', protectionPriority: 0.9, description: 'Крупный портовый и логистический узел.', position: { lat: 46.4886, lng: 30.7414 } },
  { id: 'KHARKIV', name: 'Kharkiv', category: 'MAJOR CITY', protectionPriority: 0.88, description: 'Крупный промышленный и городской район.', position: { lat: 49.9935, lng: 36.2304 } },
  { id: 'DNIPRO', name: 'Dnipro', category: 'INDUSTRIAL OBJECT', protectionPriority: 0.86, description: 'Промышленный и транспортный узел.', position: { lat: 48.4647, lng: 35.0462 } },
  { id: 'MYKOLAIV_PORT', name: 'Mykolaiv Port', category: 'PORT AREA', protectionPriority: 0.82, description: 'Портовая инфраструктура Южного театра.', position: { lat: 46.975, lng: 31.9946 } },
  { id: 'CHORNOMORSK_PORT', name: 'Chornomorsk Port', category: 'PORT AREA', protectionPriority: 0.76, description: 'Морской транспортный узел.', position: { lat: 46.3017, lng: 30.6569 } },
  { id: 'VINNYTSIA', name: 'Vinnytsia', category: 'MAJOR CITY', protectionPriority: 0.72, description: 'Региональный административный центр.', position: { lat: 49.2331, lng: 28.4682 } },
  { id: 'KREMENCHUK', name: 'Kremenchuk Industrial Area', category: 'INDUSTRIAL OBJECT', protectionPriority: 0.78, description: 'Промышленная и энергетическая зона.', position: { lat: 49.067, lng: 33.423 } },
  { id: 'STAROKOSTIANTYNIV', name: 'Starokostiantyniv Airfield', category: 'AIR BASE', protectionPriority: 0.9, description: 'Военный аэродром.', position: { lat: 49.748, lng: 27.273 } },
  { id: 'MYRHOROD', name: 'Myrhorod Airfield', category: 'AIR BASE', protectionPriority: 0.86, description: 'Военный аэродром.', position: { lat: 49.93, lng: 33.641 } },
]);

export const getTheaterObject = objectiveId => (
  THEATER_OBJECTS.find(objective => objective.id === objectiveId) ?? THEATER_OBJECTS[0]
);
