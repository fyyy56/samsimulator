import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_SURFACE_STYLE,
  selectActiveDesignProfile,
  useDesignStore,
} from '../store/designStore.js';

const NUMBER_FIELDS = [
  ['x', 'X', -2000, 2000, 1], ['y', 'Y', -2000, 2000, 1],
  ['width', 'Ширина (0 = авто)', 0, 2000, 1], ['height', 'Высота (0 = авто)', 0, 1600, 1],
  ['borderRadius', 'Скругление', 0, 80, 1], ['borderWidth', 'Рамка', 0, 8, 1],
  ['blur', 'Размытие', 0, 40, 1],
];

const TEXT_ELEMENT_SELECTOR = 'span,strong,b,small,p,h1,h2,h3,h4,label,button,code,time';

const originalTextByNode = new WeakMap();

const getDirectTextSegments = element => {
  const segments = [];
  let segment = [];
  const flush = () => {
    if (segment.length && (segment.some(node => node.textContent.trim()) || originalTextByNode.has(segment[0]))) segments.push(segment);
    segment = [];
  };
  [...element.childNodes].forEach(node => {
    if (node.nodeType === Node.TEXT_NODE) segment.push(node);
    else if (node.nodeType === Node.ELEMENT_NODE) flush();
  });
  flush();
  return segments;
};

const readTextSegment = nodes => nodes.map(node => node.textContent).join('').trim();

const writeTextSegment = (nodes, value) => {
  if (!nodes.length) return;
  if (nodes[0].textContent !== value) nodes[0].textContent = value;
  nodes.slice(1).forEach(node => { if (node.textContent) node.textContent = ''; });
};

const collectEditableText = surface => {
  const elements = [surface, ...surface.querySelectorAll(TEXT_ELEMENT_SELECTOR)]
    .filter(element => (
      !element.closest('[data-design-ui]')
      && element.closest('[data-design-id]') === surface
      && getDirectTextSegments(element).length > 0
    ));
  const occurrences = new Map();
  return elements.flatMap(element => {
    const classToken = [...element.classList].find(value => !value.startsWith('is-'));
    const baseKey = element.id || classToken || element.tagName.toLowerCase();
    const occurrence = occurrences.get(baseKey) ?? 0;
    occurrences.set(baseKey, occurrence + 1);
    const items = getDirectTextSegments(element).map((nodes, segmentIndex) => {
      const key = `${baseKey}-${occurrence}-${segmentIndex}`;
      if (!originalTextByNode.has(nodes[0])) originalTextByNode.set(nodes[0], readTextSegment(nodes));
      const originalText = originalTextByNode.get(nodes[0]);
      return {
        key,
        label: originalText.slice(0, 44),
        originalText,
        element,
        nodes,
        defaultFontSize: Math.round(Number.parseFloat(getComputedStyle(element).fontSize) || 10),
      };
    });
    element.dataset.designTextKey = items[0]?.key ?? '';
    return items;
  });
};

const applyTextConfiguration = profile => {
  document.querySelectorAll('[data-design-id]').forEach(surface => {
    const style = profile?.surfaces[surface.dataset.designId];
    const items = collectEditableText(surface);
    const elements = [...new Set(items.map(item => item.element))];
    elements.forEach(element => {
      const configuredItem = items.find(item => item.element === element && style?.textSizes?.[item.key]);
      const layoutItem = items.find(item => item.element === element && style?.textLayouts?.[item.key]);
      const layout = layoutItem ? style.textLayouts[layoutItem.key] : null;
      element.style.fontSize = configuredItem ? `${style.textSizes[configuredItem.key]}px` : '';
      element.style.maxWidth = style?.width > 0 ? '100%' : '';
      element.style.overflowWrap = style?.width > 0 ? 'anywhere' : '';
      element.style.whiteSpace = style?.width > 0 ? 'normal' : '';
      element.style.transform = layout ? `translate(${layout.x}px, ${layout.y}px)` : '';
      element.style.width = layout?.width > 0 ? `${layout.width}px` : '';
      element.style.height = layout?.height > 0 ? `${layout.height}px` : '';
      element.style.position = layout ? 'relative' : '';
      element.style.zIndex = layout ? '2' : '';
      element.style.display = layout?.width > 0 || layout?.height > 0 ? 'inline-block' : '';
    });
    items.forEach(item => {
      writeTextSegment(item.nodes, style?.textOverrides?.[item.key] ?? item.originalText);
    });
  });
};

export default function DesignModeOverlay() {
  const enabled = useDesignStore(state => state.enabled);
  const inspectorSide = useDesignStore(state => state.inspectorSide);
  const selectedSurfaceId = useDesignStore(state => state.selectedSurfaceId);
  const profile = useDesignStore(selectActiveDesignProfile);
  const profiles = useDesignStore(state => state.profiles);
  const selectSurface = useDesignStore(state => state.selectSurface);
  const updateSurface = useDesignStore(state => state.updateSurface);
  const resetSurface = useDesignStore(state => state.resetSurface);
  const setEnabled = useDesignStore(state => state.setEnabled);
  const setInspectorSide = useDesignStore(state => state.setInspectorSide);
  const createProfile = useDesignStore(state => state.createProfile);
  const renameActiveProfile = useDesignStore(state => state.renameActiveProfile);
  const setActiveProfile = useDesignStore(state => state.setActiveProfile);
  const exportConfiguration = useDesignStore(state => state.exportConfiguration);
  const importConfiguration = useDesignStore(state => state.importConfiguration);
  const [profileName, setProfileName] = useState(profile?.name ?? 'Мой дизайн');
  const [message, setMessage] = useState('');
  const [selectionRect, setSelectionRect] = useState(null);
  const [textSelectionRect, setTextSelectionRect] = useState(null);
  const [textOptions, setTextOptions] = useState([]);
  const [selectedTextKey, setSelectedTextKey] = useState(null);
  const dragRef = useRef(null);
  const selectedStyle = useMemo(() => ({ ...DEFAULT_SURFACE_STYLE, ...profile?.surfaces[selectedSurfaceId] }), [profile, selectedSurfaceId]);
  const selectedText = textOptions.find(item => item.key === selectedTextKey) ?? textOptions[0] ?? null;

  useEffect(() => {
    let scheduledFrame = 0;
    const apply = () => {
      scheduledFrame = 0;
      applyTextConfiguration(profile);
    };
    apply();
    const observer = new MutationObserver(() => {
      if (!scheduledFrame) scheduledFrame = window.requestAnimationFrame(apply);
    });
    observer.observe(document.getElementById('root'), { subtree: true, childList: true, characterData: true });
    return () => {
      observer.disconnect();
      if (scheduledFrame) window.cancelAnimationFrame(scheduledFrame);
    };
  }, [profile]);

  useEffect(() => {
    if (!enabled || !selectedSurfaceId) {
      window.requestAnimationFrame(() => setSelectionRect(null));
      return undefined;
    }
    const refresh = () => {
      const element = [...document.querySelectorAll('[data-design-id]')]
        .find(candidate => candidate.dataset.designId === selectedSurfaceId);
      if (!element) return;
      const rect = element.getBoundingClientRect();
      setSelectionRect({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    };
    const frame = window.requestAnimationFrame(refresh);
    window.addEventListener('resize', refresh);
    window.addEventListener('scroll', refresh, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', refresh);
      window.removeEventListener('scroll', refresh, true);
    };
  }, [enabled, selectedSurfaceId, profile]);

  useEffect(() => {
    if (!enabled || !selectedText?.element?.isConnected) {
      window.requestAnimationFrame(() => setTextSelectionRect(null));
      return undefined;
    }
    const refresh = () => {
      const rect = selectedText.element.getBoundingClientRect();
      setTextSelectionRect({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    };
    const frame = window.requestAnimationFrame(refresh);
    window.addEventListener('resize', refresh);
    window.addEventListener('scroll', refresh, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', refresh);
      window.removeEventListener('scroll', refresh, true);
    };
  }, [enabled, selectedText, profile]);

  useEffect(() => {
    document.documentElement.classList.toggle('design-mode-active', enabled);
    document.querySelectorAll('[data-design-selected="true"]').forEach(element => element.removeAttribute('data-design-selected'));
    if (enabled && selectedSurfaceId) {
      [...document.querySelectorAll('[data-design-id]')]
        .filter(element => element.dataset.designId === selectedSurfaceId)
        .forEach(element => element.setAttribute('data-design-selected', 'true'));
    }
    return () => document.documentElement.classList.remove('design-mode-active');
  }, [enabled, selectedSurfaceId]);

  useEffect(() => {
    if (!enabled) return undefined;
    const pointerDown = event => {
      if (event.target.closest('[data-design-ui]')) return;
      const surface = event.target.closest('[data-design-id]');
      if (!surface) return;
      event.preventDefault();
      event.stopPropagation();
      const id = surface.dataset.designId;
      selectSurface(id);
      const editableText = collectEditableText(surface);
      const clickedTextElement = event.target.closest('[data-design-text-key]');
      const clickedText = editableText.find(item => item.element === clickedTextElement) ?? null;
      setTextOptions(editableText);
      setSelectedTextKey(clickedText?.key ?? editableText[0]?.key ?? null);
      const current = useDesignStore.getState();
      const currentProfile = selectActiveDesignProfile(current);
      const style = { ...DEFAULT_SURFACE_STYLE, ...currentProfile?.surfaces[id] };
      if (clickedText) {
        const layout = { x: 0, y: 0, width: 0, height: 0, ...style.textLayouts?.[clickedText.key] };
        dragRef.current = {
          mode: 'text-move', id, textKey: clickedText.key,
          startX: event.clientX, startY: event.clientY,
          layout, textLayouts: style.textLayouts ?? {},
        };
        return;
      }
      dragRef.current = { mode: 'move', id, startX: event.clientX, startY: event.clientY, x: style.x, y: style.y };
    };
    const pointerMove = event => {
      const drag = dragRef.current;
      if (!drag || !(event.buttons & 1)) return;
      const deltaX = event.clientX - drag.startX;
      const deltaY = event.clientY - drag.startY;
      if (drag.mode === 'text-move') {
        updateSurface(drag.id, { textLayouts: {
          ...drag.textLayouts,
          [drag.textKey]: { ...drag.layout, x: drag.layout.x + deltaX, y: drag.layout.y + deltaY },
        } });
        return;
      }
      if (drag.mode === 'text-resize') {
        const west = drag.corner.includes('w');
        const north = drag.corner.includes('n');
        updateSurface(drag.id, { textLayouts: {
          ...drag.textLayouts,
          [drag.textKey]: {
            x: drag.layout.x + (west ? deltaX : 0),
            y: drag.layout.y + (north ? deltaY : 0),
            width: Math.max(24, drag.layout.width + (west ? -deltaX : deltaX)),
            height: Math.max(12, drag.layout.height + (north ? -deltaY : deltaY)),
          },
        } });
        return;
      }
      if (drag.mode === 'move') {
        updateSurface(drag.id, { x: drag.x + deltaX, y: drag.y + deltaY });
        return;
      }
      const west = drag.corner.includes('w');
      const north = drag.corner.includes('n');
      updateSurface(drag.id, {
        width: Math.max(100, drag.width + (west ? -deltaX : deltaX)),
        height: Math.max(40, drag.height + (north ? -deltaY : deltaY)),
        x: drag.x + (west ? deltaX : 0),
        y: drag.y + (north ? deltaY : 0),
      });
    };
    const pointerUp = () => { dragRef.current = null; };
    document.addEventListener('pointerdown', pointerDown, true);
    window.addEventListener('pointermove', pointerMove, true);
    window.addEventListener('pointerup', pointerUp, true);
    return () => {
      document.removeEventListener('pointerdown', pointerDown, true);
      window.removeEventListener('pointermove', pointerMove, true);
      window.removeEventListener('pointerup', pointerUp, true);
    };
  }, [enabled, selectSurface, updateSurface]);

  const beginResize = (event, corner) => {
    event.preventDefault();
    event.stopPropagation();
    if (!selectedSurfaceId || !selectionRect) return;
    dragRef.current = {
      mode: 'resize',
      corner,
      id: selectedSurfaceId,
      startX: event.clientX,
      startY: event.clientY,
      x: selectedStyle.x,
      y: selectedStyle.y,
      width: selectedStyle.width || selectionRect.width,
      height: selectedStyle.height || selectionRect.height,
    };
  };

  const beginTextResize = (event, corner) => {
    event.preventDefault();
    event.stopPropagation();
    if (!selectedSurfaceId || !selectedText || !textSelectionRect) return;
    const layout = {
      x: 0,
      y: 0,
      width: textSelectionRect.width,
      height: textSelectionRect.height,
      ...selectedStyle.textLayouts?.[selectedText.key],
    };
    if (!layout.width) layout.width = textSelectionRect.width;
    if (!layout.height) layout.height = textSelectionRect.height;
    dragRef.current = {
      mode: 'text-resize',
      corner,
      id: selectedSurfaceId,
      textKey: selectedText.key,
      startX: event.clientX,
      startY: event.clientY,
      layout,
      textLayouts: selectedStyle.textLayouts ?? {},
    };
  };

  const beginTextMove = event => {
    event.preventDefault();
    event.stopPropagation();
    if (!selectedSurfaceId || !selectedText) return;
    const layout = { x: 0, y: 0, width: 0, height: 0, ...selectedStyle.textLayouts?.[selectedText.key] };
    dragRef.current = {
      mode: 'text-move',
      id: selectedSurfaceId,
      textKey: selectedText.key,
      startX: event.clientX,
      startY: event.clientY,
      layout,
      textLayouts: selectedStyle.textLayouts ?? {},
    };
  };

  if (!enabled) return null;
  const download = () => {
    const blob = new Blob([JSON.stringify(exportConfiguration(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `sam-simulator-ui-${profile?.id ?? 'design'}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const importFile = event => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        setMessage(importConfiguration(JSON.parse(reader.result)) ? 'Пресет импортирован' : 'Неверный формат пресета');
      } catch { setMessage('JSON не удалось прочитать'); }
    };
    reader.readAsText(file);
    event.target.value = '';
  };
  const selectedTextValue = selectedText
    ? selectedStyle.textOverrides?.[selectedText.key] ?? selectedText.originalText
    : '';
  const selectedTextSize = selectedText
    ? selectedStyle.textSizes?.[selectedText.key] ?? selectedText.defaultFontSize
    : 10;
  return <>
    {selectionRect && <div className="design-resize-frame" data-design-ui style={{ left: selectionRect.left, top: selectionRect.top, width: selectionRect.width, height: selectionRect.height }}>
      {['nw', 'ne', 'sw', 'se'].map(corner => <button key={corner} className={`design-resize-handle is-${corner}`} aria-label={`Изменить размер ${corner}`} onPointerDown={event => beginResize(event, corner)} />)}
    </div>}
    {textSelectionRect && <div className="design-text-resize-frame" data-design-ui style={{ left: textSelectionRect.left, top: textSelectionRect.top, width: textSelectionRect.width, height: textSelectionRect.height }} onPointerDown={beginTextMove}>
      {['nw', 'ne', 'sw', 'se'].map(corner => <button key={corner} className={`design-text-resize-handle is-${corner}`} aria-label={`Изменить текст ${corner}`} onPointerDown={event => beginTextResize(event, corner)} />)}
    </div>}
    <aside className={`design-inspector design-inspector--${inspectorSide.toLowerCase()}`} data-design-ui>
    <header><div><span>DESIGN MODE</span><strong>{selectedSurfaceId || 'Выберите панель'}</strong></div><nav><button title="Переместить инспектор" onClick={() => setInspectorSide(inspectorSide === 'RIGHT' ? 'LEFT' : 'RIGHT')}>{inspectorSide === 'RIGHT' ? '←' : '→'}</button><button onClick={() => setEnabled(false)}>×</button></nav></header>
    <p>Клик — выбрать. Тяните панель для перемещения или золотой угол для изменения размера.</p>
    <label>Пресет<select value={profile?.id} onChange={event => { const next = profiles.find(item => item.id === event.target.value); setActiveProfile(event.target.value); setProfileName(next?.name ?? ''); }}>{profiles.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
    <div className="design-inspector__profile"><input value={profileName} onChange={event => setProfileName(event.target.value)} /><button onClick={() => renameActiveProfile(profileName)}>Сохранить имя</button><button onClick={() => { createProfile('Новый пресет'); setProfileName('Новый пресет'); }}>+ Пресет</button></div>
    {selectedSurfaceId ? <div className="design-inspector__fields">
      <div className="design-inspector__colors"><label>Панель<input type="color" value={selectedStyle.backgroundColor} onChange={event => updateSurface(selectedSurfaceId, { backgroundColor: event.target.value })} /></label><label>Градиент<input type="color" value={selectedStyle.gradientColor} onChange={event => updateSurface(selectedSurfaceId, { gradientColor: event.target.value })} /></label><label>Текст<input type="color" value={selectedStyle.textColor} onChange={event => updateSurface(selectedSurfaceId, { textColor: event.target.value })} /></label><label>Рамка<input type="color" value={selectedStyle.borderColor} onChange={event => updateSurface(selectedSurfaceId, { borderColor: event.target.value })} /></label></div>
      <label>Прозрачность фона <b>{Math.round(selectedStyle.backgroundAlpha * 100)}%</b><input type="range" min="0" max="1" step="0.01" value={selectedStyle.backgroundAlpha} onChange={event => updateSurface(selectedSurfaceId, { backgroundAlpha: event.target.value })} /></label>
      <label>Сила градиента <b>{Math.round(selectedStyle.gradientStrength * 100)}%</b><input type="range" min="0" max="1" step="0.01" value={selectedStyle.gradientStrength} onChange={event => updateSurface(selectedSurfaceId, { gradientStrength: event.target.value })} /></label>
      <label>Направление градиента <b>{Math.round(selectedStyle.gradientAngle)}°</b><input type="range" min="0" max="360" step="1" value={selectedStyle.gradientAngle} onChange={event => updateSurface(selectedSurfaceId, { gradientAngle: event.target.value })} /></label>
      <label>Общая прозрачность <b>{Math.round(selectedStyle.opacity * 100)}%</b><input type="range" min="0.15" max="1" step="0.01" value={selectedStyle.opacity} onChange={event => updateSurface(selectedSurfaceId, { opacity: event.target.value })} /></label>
      <div className="design-inspector__numbers">{NUMBER_FIELDS.map(([id, label, min, max, step]) => <label key={id}>{label}<input type="number" min={min} max={max} step={step} value={selectedStyle[id]} onChange={event => updateSurface(selectedSurfaceId, { [id]: event.target.value })} /></label>)}</div>
      {textOptions.length > 0 && <section className="design-inspector__text"><span>ТЕКСТ ПАНЕЛИ</span><select value={selectedText?.key ?? ''} onChange={event => setSelectedTextKey(event.target.value)}>{textOptions.map(item => <option value={item.key} key={item.key}>{item.label}</option>)}</select><textarea value={selectedTextValue} onChange={event => updateSurface(selectedSurfaceId, { textOverrides: { ...selectedStyle.textOverrides, [selectedText.key]: event.target.value } })} /><label>Размер текста <b>{selectedTextSize}px</b><input type="range" min="5" max="48" step="1" value={selectedTextSize} onChange={event => updateSurface(selectedSurfaceId, { textSizes: { ...selectedStyle.textSizes, [selectedText.key]: event.target.value } })} /></label><div className="design-inspector__text-layout">{[['x', 'X'], ['y', 'Y'], ['width', 'Ширина'], ['height', 'Высота']].map(([field, label]) => <label key={field}>{label}<input type="number" value={selectedStyle.textLayouts?.[selectedText.key]?.[field] ?? 0} onChange={event => updateSurface(selectedSurfaceId, { textLayouts: { ...selectedStyle.textLayouts, [selectedText.key]: { x: 0, y: 0, width: 0, height: 0, ...selectedStyle.textLayouts?.[selectedText.key], [field]: event.target.value } } })} /></label>)}</div><button onClick={() => {
        const textOverrides = { ...selectedStyle.textOverrides };
        const textSizes = { ...selectedStyle.textSizes };
        const textLayouts = { ...selectedStyle.textLayouts };
        delete textOverrides[selectedText.key];
        delete textSizes[selectedText.key];
        delete textLayouts[selectedText.key];
        updateSurface(selectedSurfaceId, { textOverrides, textSizes, textLayouts });
      }}>Сбросить этот текст</button></section>}
      <button className="is-danger" onClick={() => resetSurface(selectedSurfaceId)}>Сбросить эту панель</button>
    </div> : <div className="design-inspector__empty">Выберите подсвечиваемый элемент меню или HUD.</div>}
    <footer><button onClick={download}>Экспорт JSON</button><label>Импорт JSON<input type="file" accept="application/json" onChange={importFile} /></label></footer>
    {message && <small>{message}</small>}
    </aside>
  </>;
}

export function DesignModeButton({ compact = false }) {
  const enabled = useDesignStore(state => state.enabled);
  const toggle = useDesignStore(state => state.toggle);
  return <button className={`design-mode-button ${enabled ? 'is-active' : ''}`} data-design-ui onClick={toggle}>{compact ? 'UI' : 'РЕДАКТОР ИНТЕРФЕЙСА'} {enabled ? 'ON' : 'OFF'}</button>;
}
