import React, { useState } from 'react';
import { useEngine, SYSTEM_CATALOG } from '../store/engine';

const formatTime = (totalSeconds) => {
  const h = Math.floor(totalSeconds / 3600) % 24;
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

export default function HUD() {
  const { 
    tracks, selectedTrackId, fireMissile, simulationTime, timeScale, setTimeScale,
    batteries, startDeploy, deployPhase, draftBattery,
    buildMenuOpen, selectedCategory, toggleBuildMenu, setCategory, rotateRadar, confirmRadarHeading
  } = useEngine();
  
  const [hoveredCategory, setHoveredCategory] = useState(null);
  const activeTrack = tracks.find(t => t.id === selectedTrackId);
  const totalTracks = tracks.filter(t => t.visible).length; // Считаем только видимые цели!

  return (
    <div style={styles.overlay}>
      <div style={styles.buildMenuContainer}>
        {buildMenuOpen && !deployPhase && (
          <div style={styles.buildOptionsBox}>
            <div style={{ fontSize: '11px', color: '#a3ab8e', marginBottom: '8px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '4px' }}>SELECT RANGE:</div>
            {['SHORT', 'MEDIUM', 'LONG'].map(cat => {
              const isSelected = selectedCategory === cat;
              return (
                <div key={cat} style={{ display: 'flex', flexDirection: 'column', marginBottom: '6px' }}>
                  <button onClick={() => setCategory(cat)} style={{ ...styles.buildCategoryBtn, background: isSelected ? 'rgba(56, 189, 248, 0.2)' : 'rgba(20, 22, 19, 0.5)' }}>
                    {cat} RANGE
                  </button>
                  {isSelected && (
                    <div style={styles.systemDetailsInline}>
                      <div style={{ fontWeight: 'bold', color: '#fff', marginBottom: '6px', fontSize: '13px' }}>{SYSTEM_CATALOG[cat].type}</div>
                      <Stat label="RADAR" value={`${SYSTEM_CATALOG[cat].radarRangeKm} KM`} color="#38bdf8" />
                      <Stat label="SECTOR" value={`${SYSTEM_CATALOG[cat].radarSector}°`} color="#38bdf8" />
                      <Stat label="SPEED" value={`${SYSTEM_CATALOG[cat].missileSpeedKmh} KM/H`} color="#a3ab8e" />
                      <button onClick={() => startDeploy(cat)} style={styles.deployConfirmBtn}>DEPLOY SYSTEM</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <button onClick={toggleBuildMenu} disabled={deployPhase !== null} style={{...styles.mainBuildBtn, opacity: deployPhase ? 0.5 : 1}}>
          {buildMenuOpen ? '✕' : '🛠 C2'}
        </button>
      </div>

      <div style={styles.header}>
        <div style={styles.panel}>
          <div style={styles.title}><span style={styles.accent}>[</span> DRONEFALL <span style={styles.accent}>]</span></div>
          <div style={styles.subtitle}>TACTICAL AIRSPACE SIMULATOR // MK-I</div>
        </div>
      </div>

      <div style={styles.middle}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ ...styles.panel, width: '240px' }}>
            <div style={styles.sectionTitle}>[ AIRSPACE MONITOR ]</div>
            <Stat label="DETECTED TRACKS" value={totalTracks < 10 ? `0${totalTracks}` : totalTracks} color="#fbbf24" />
          </div>

          <div style={{ ...styles.panel, width: '240px' }}>
            <div style={styles.sectionTitle}>[ AIR DEFENSE NETWORK ]</div>
            {batteries.length === 0 && <div style={{ fontSize: '11px', color: '#ef4444' }}>NO ACTIVE SYSTEMS</div>}
            {batteries.map((b) => (
              <div key={b.id} style={{ marginBottom: '12px', borderBottom: '1px dashed rgba(163,171,142,0.2)', paddingBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#38bdf8', fontFamily: "'Space Mono', monospace" }}>{b.id}</span>
                  <span style={{ fontSize: '12px', fontFamily: "'Space Mono', monospace", color: b.missilesLeft > 0 ? '#4ade80' : '#ef4444' }}>
                    {b.missilesLeft > 0 ? `${b.missilesLeft} MSL` : 'EMPTY'}
                  </span>
                </div>
                <Stat label="SYS" value={b.type} color="#a3ab8e" />
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* ОБЫЧНАЯ СТРОЙКА */}
          {deployPhase && deployPhase !== 'RADAR_HEADING' && (
            <div style={{ ...styles.panel, width: '240px', border: '1px solid #fbbf24' }}>
              <div style={{...styles.sectionTitle, color: '#fbbf24', borderBottomColor: '#fbbf24'}}>[ DEPLOYMENT MODE ]</div>
              <div style={{ fontSize: '12px', color: '#e5e7eb', marginBottom: '10px' }}>SYSTEM: <span style={{ color: '#fbbf24', fontWeight: 'bold' }}>{draftBattery?.id}</span></div>
              <div style={{ fontSize: '11px', color: '#a3ab8e', lineHeight: '1.5' }}>
                {deployPhase === 'FDC' && "▶ CLICK MAP: SET COMMAND POST"}
                {deployPhase === 'RADAR' && "▶ CLICK MAP: SET RADAR"}
                {deployPhase === 'LAUNCHER' && `▶ CLICK MAP: SET LAUNCHER (${draftBattery.components.launchers.length + 1}/2)`}
              </div>
            </div>
          )}

          {/* МЕНЮ ПОВОРОТА РАДАРА PATRIOT */}
          {deployPhase === 'RADAR_HEADING' && (
            <div style={{ ...styles.panel, width: '240px', border: '1px solid #38bdf8' }}>
              <div style={{...styles.sectionTitle, color: '#38bdf8', borderBottomColor: '#38bdf8'}}>[ RADAR ALIGNMENT ]</div>
              <div style={{ fontSize: '11px', color: '#a3ab8e', marginBottom: '15px' }}>
                ADJUST AESA RADAR SECTOR DIRECTION (HEADING: {draftBattery.radarHeading}°)
              </div>
              <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
                <button onClick={() => rotateRadar(-15)} style={{...styles.deployConfirmBtn, flex: 1, marginTop: 0}}>{"< LEFT"}</button>
                <button onClick={() => rotateRadar(15)} style={{...styles.deployConfirmBtn, flex: 1, marginTop: 0}}>{"RIGHT >"}</button>
              </div>
              <button onClick={confirmRadarHeading} style={{...styles.deployConfirmBtn, background: 'rgba(74, 222, 128, 0.2)', borderColor: '#4ade80', color: '#fff', marginTop: 0}}>
                CONFIRM DIRECTION
              </button>
            </div>
          )}

          {activeTrack && !deployPhase && (
            <div style={{ ...styles.panel, width: '240px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={styles.sectionTitle}>[ TARGET LOCK ]</div>
              <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#ef4444', fontFamily: "'Space Mono', monospace" }}>{activeTrack.id}</div>
              <Stat label="CLASS" value={activeTrack.type} color="#fbbf24" />
              <Stat label="ALTITUDE" value={`${activeTrack.alt} M`} color="#a3ab8e" />
              <Stat label="SPEED" value={`${activeTrack.speed_kmh} KM/H`} color="#a3ab8e" />
              <button onClick={() => fireMissile()} style={styles.fireButton}>⚡ FIRE INTERCEPTOR</button>
            </div>
          )}
        </div>
      </div>

      <div style={styles.footer}>
        <div style={{ ...styles.panel, width: '600px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
            <div style={styles.label}>SIMULATION TIME</div>
            <div style={{ ...styles.mono, fontSize: '16px', color: '#4ade80', letterSpacing: '2px' }}>{formatTime(simulationTime)} <span style={{ fontSize: '12px', color: '#a3ab8e' }}>Z</span></div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {[0, 1, 2, 5, 10, 20].map(speed => {
              const isActive = timeScale === speed;
              return (
                <button 
                  key={speed} onClick={() => setTimeScale(speed)}
                  style={{ ...styles.timeButton, background: isActive ? 'rgba(74, 222, 128, 0.2)' : 'rgba(163, 171, 142, 0.1)', borderColor: isActive ? '#4ade80' : 'rgba(163, 171, 142, 0.4)', color: isActive ? '#4ade80' : '#a3ab8e' }}
                >
                  {speed === 0 ? 'PAUSE' : `${speed}x`}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

const Stat = ({ label, value, color }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '6px' }}>
    <span style={{ fontSize: '12px', fontWeight: '600', color: '#8a937c', letterSpacing: '1px' }}>{label}</span>
    <span style={{ fontFamily: "'Space Mono', monospace", color, fontSize: '13px' }}>{value}</span>
  </div>
);

const styles = {
  overlay: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '24px', boxSizing: 'border-box', color: '#c8d3c5' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  middle: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flex: 1, padding: '20px 0' },
  footer: { display: 'flex', justifyContent: 'center' },
  panel: { background: 'rgba(20, 22, 19, 0.85)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', border: '1px solid rgba(163, 171, 142, 0.25)', borderTop: '2px solid rgba(163, 171, 142, 0.5)', borderRadius: '2px', padding: '16px 20px', pointerEvents: 'auto', boxShadow: '0 10px 30px rgba(0,0,0,0.8)' },
  title: { fontSize: '24px', fontWeight: '700', letterSpacing: '4px', color: '#e5e7eb' },
  accent: { color: '#fbbf24', opacity: 0.8 },
  subtitle: { fontSize: '12px', color: '#8a937c', fontFamily: "'Space Mono', monospace", marginTop: '4px', letterSpacing: '1px' },
  label: { fontSize: '10px', color: '#8a937c', letterSpacing: '2px', fontWeight: '700', marginBottom: '4px' },
  mono: { fontFamily: "'Space Mono', monospace", fontSize: '13px' },
  sectionTitle: { fontSize: '13px', fontWeight: '700', color: '#a3ab8e', letterSpacing: '2px', borderBottom: '1px solid rgba(163, 171, 142, 0.2)', paddingBottom: '8px', marginBottom: '16px' },
  fireButton: { background: 'rgba(239, 68, 68, 0.2)', border: '1px solid #ef4444', color: '#fff', padding: '10px', fontWeight: 'bold', fontFamily: "'Space Mono', monospace", fontSize: '12px', cursor: 'pointer', marginTop: '10px', letterSpacing: '1px', transition: 'background 0.2s', width: '100%' },
  timeButton: { padding: '4px 8px', borderRadius: '2px', borderWidth: '1px', borderStyle: 'solid', cursor: 'pointer', fontFamily: "'Space Mono', monospace", fontSize: '11px', transition: 'all 0.2s' },
  buildMenuContainer: { position: 'absolute', bottom: '24px', left: '24px', display: 'flex', flexDirection: 'column-reverse', gap: '10px', pointerEvents: 'auto', zIndex: 50 },
  mainBuildBtn: { width: '50px', height: '50px', background: 'rgba(20, 22, 19, 0.9)', border: '1px solid #38bdf8', color: '#38bdf8', fontSize: '14px', fontWeight: 'bold', fontFamily: "'Space Mono', monospace", cursor: 'pointer', boxShadow: '0 0 15px rgba(56, 189, 248, 0.2)' },
  buildOptionsBox: { background: 'rgba(20, 22, 19, 0.95)', border: '1px solid rgba(56, 189, 248, 0.5)', padding: '10px', width: '180px', display: 'flex', flexDirection: 'column', gap: '4px', boxShadow: '0 10px 30px rgba(0,0,0,0.8)' },
  buildCategoryBtn: { color: '#e5e7eb', fontFamily: "'Space Mono', monospace", fontSize: '11px', padding: '8px', cursor: 'pointer', border: '1px solid rgba(56, 189, 248, 0.3)', transition: 'background 0.2s', textAlign: 'left' },
  systemDetailsInline: { background: 'rgba(0, 0, 0, 0.3)', border: '1px solid rgba(56, 189, 248, 0.2)', borderTop: 'none', padding: '10px', marginTop: '-1px' },
  deployConfirmBtn: { background: 'rgba(56, 189, 248, 0.2)', border: '1px solid #38bdf8', color: '#38bdf8', width: '100%', padding: '8px', marginTop: '10px', cursor: 'pointer', fontFamily: "'Space Mono', monospace", fontSize: '10px', fontWeight: 'bold' }
};
