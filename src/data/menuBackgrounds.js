import commandIntroUrl from '../assets/video/intro.MOV?url';

export const MENU_BACKGROUNDS = Object.freeze([
  Object.freeze({
    id: 'COMMAND_INTRO_01',
    label: 'Command footage 01',
    videoUrl: commandIntroUrl,
    fallbackTone: '#071015',
    freezeOffsetSec: 0.08,
  }),
]);

export const DEFAULT_MENU_BACKGROUND = MENU_BACKGROUNDS[0];
