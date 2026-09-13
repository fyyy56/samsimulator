import { UI_LANGUAGE, useGameStore } from '../store/gameStore.js';
import ContentShell from '../ui/ContentShell.jsx';
import DesignableSurface from '../ui/DesignableSurface.jsx';

export default function SettingsScene() {
  const language = useGameStore(state => state.language);
  const setLanguage = useGameStore(state => state.setLanguage);
  return <ContentShell eyebrow="SYSTEM" title={language === UI_LANGUAGE.RU ? 'Настройки' : 'Settings'}>
    <DesignableSurface as="section" designId="settings-panel" designName="Панель настроек" className="settings-panel">
      <nav>{['GRAPHICS', 'AUDIO', 'INTERFACE', 'LANGUAGE', 'CONTROLS'].map(value => <button className={value === 'LANGUAGE' ? 'is-active' : ''} key={value}>{value}</button>)}</nav>
      <div><span>LANGUAGE</span><h2>{language === UI_LANGUAGE.RU ? 'Язык интерфейса' : 'Interface language'}</h2><p>{language === UI_LANGUAGE.RU ? 'Выберите язык меню и тактического HUD.' : 'Choose the language used by menus and the tactical HUD.'}</p><div className="settings-language">{[UI_LANGUAGE.RU, UI_LANGUAGE.EN].map(value => <button key={value} className={language === value ? 'is-active' : ''} onClick={() => setLanguage(value)}>{value}</button>)}</div></div>
    </DesignableSurface>
  </ContentShell>;
}
