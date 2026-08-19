import { useMemo, useState } from 'react';
import ContentShell from '../ui/ContentShell.jsx';
import {
  CONTENT_CATEGORIES,
  getContentAsset,
  getContentModelAsset,
  PACKAGED_CONTENT,
  POPULAR_TARGETS,
} from '../content/contentRegistry.js';
import DesignableSurface from '../ui/DesignableSurface.jsx';
import { DesignModeButton } from '../ui/DesignModeOverlay.jsx';
import ReferenceModelViewport from '../ui/ReferenceModelViewport.jsx';

function ContentArtwork({ item }) {
  const asset = getContentAsset(item);
  return asset ? <img src={asset.src} alt="" /> : <span>{item.name.slice(0, 2).toUpperCase()}</span>;
}

function ReferenceCard({ item, objective = false, onSelect }) {
  return <DesignableSurface as="button" designId={`reference-card-${item.id}`} designName={item.name} className={`reference-card ${objective ? 'reference-card--objective' : ''}`} onClick={() => onSelect(item)}>
    {!objective && <div className="reference-card__art"><ContentArtwork item={item} /></div>}
    <span>{objective ? item.type : item.category}</span><strong>{item.name}</strong><p>{item.role ?? item.description}</p>
    <small>{objective ? `ПРИОРИТЕТ: ${item.priorityLabel}` : item.country || item.type}</small>
    {objective && <code>{item.position.lat.toFixed(4)} / {item.position.lng.toFixed(4)}</code>}
  </DesignableSurface>;
}

export default function ReferenceScene() {
  const [section, setSection] = useState('CATALOG');
  const [category, setCategory] = useState('Все');
  const [selected, setSelected] = useState(null);
  const visible = useMemo(() => (
    category === 'Все' ? PACKAGED_CONTENT : PACKAGED_CONTENT.filter(item => item.category === category)
  ), [category]);

  return (
    <ContentShell eyebrow="База знаний" title="Справочник">
      <nav className="content-tabs">
        <button className={section === 'CATALOG' ? 'is-active' : ''} onClick={() => setSection('CATALOG')}>Техника и угрозы</button>
        <button className={section === 'TARGETS' ? 'is-active' : ''} onClick={() => setSection('TARGETS')}>Популярные цели</button>
      </nav>
      {section === 'CATALOG' ? <>
        <div className="filter-chips">{CONTENT_CATEGORIES.map(value => <button key={value} className={category === value ? 'is-active' : ''} onClick={() => setCategory(value)}>{value}</button>)}</div>
        <div className="reference-grid">{visible.map(item => <ReferenceCard key={item.id} item={item} onSelect={setSelected} />)}</div>
      </> : <div className="reference-grid reference-grid--targets">{POPULAR_TARGETS.map(item => <ReferenceCard key={item.id} item={item} objective onSelect={setSelected} />)}</div>}
      {selected && <div className="content-modal" role="dialog" aria-modal="true" onMouseDown={() => setSelected(null)}>
        <DesignableSurface as="article" designId={`reference-detail-${selected.id}`} designName={`Карточка ${selected.name}`} className="reference-detail" onMouseDown={event => event.stopPropagation()}>
          <div className="content-modal__toolbar" data-design-ui>
            <DesignModeButton compact />
            <button className="content-modal__close" onClick={() => setSelected(null)}>×</button>
          </div>
          <ReferenceModelViewport
            item={selected}
            modelUrl={getContentModelAsset(selected)}
            fallbackAsset={getContentAsset(selected)}
          />
          <div className="reference-detail__info">
            <span>{selected.category ?? selected.type}</span><h2>{selected.name}</h2><p>{selected.role ?? selected.description}</p>
            {selected.type && <dl><dt>Тип</dt><dd>{selected.type}</dd>{selected.rangeKm && <><dt>Дальность</dt><dd>{selected.rangeKm}</dd></>}</dl>}
            {selected.features?.length > 0 && <ul>{selected.features.map(feature => <li key={feature}>{feature}</li>)}</ul>}
            {selected.position && <code>{selected.position.lat.toFixed(5)}, {selected.position.lng.toFixed(5)}</code>}
          </div>
        </DesignableSurface>
      </div>}
    </ContentShell>
  );
}
