import { useGameStore } from '../../store/gameStore.js';
import { useEngine } from '../../store/engine.js';
import { localizeMissileEvent } from '../../data/uiLocalization.js';

export default function MissileLog() {
  const language = useGameStore(state => state.language);
  const entries = useEngine(state => state.missileLog);
  const ru = language === 'RU';
  return <details className="advanced-missile-log">
    <summary>{ru ? 'ЖУРНАЛ ЗУР' : 'MISSILE LOG'} <small>{entries.length}/5</small></summary>
    <div className="advanced-missile-log__entries">
      {entries.length === 0 && <p>{ru ? 'ПУСКОВ НЕТ' : 'NO LAUNCHES'}</p>}
      {entries.map(entry => <details key={entry.id}>
        <summary>{entry.id} <small>{entry.batteryId ?? '—'}</small></summary>
        <ol>{entry.events.map(event => <li key={event.id}
          title={['MISSILE_TRACK_SOURCE', 'MISSILE_PREDICTED_INTERCEPT'].includes(event.type)
            ? JSON.stringify(event.details) : undefined}>
          <time>{event.simulationTime.toFixed(2)}</time>
          <span>{localizeMissileEvent(event, language)}</span>
        </li>)}</ol>
      </details>)}
    </div>
  </details>;
}
