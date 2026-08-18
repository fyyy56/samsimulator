const modules = import.meta.glob('./scenarios/**/*.json', { eager: true, import: 'default' });

export const PACKAGED_SCENARIOS = Object.freeze(
  Object.values(modules).filter(scenario => scenario?.id && scenario?.name),
);
