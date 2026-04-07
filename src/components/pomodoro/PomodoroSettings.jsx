import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

function Slider({ label, value, onChange, min, max, step = 1, unit = '' }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}</span>
        <span style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-primary)' }}>
          {value}{unit}
        </span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          width: '100%',
          height: 4,
          appearance: 'none',
          background: 'var(--bg-accent)',
          borderRadius: 2,
          outline: 'none',
          cursor: 'pointer',
          accentColor: 'var(--accent)',
        }}
      />
    </div>
  );
}

function Toggle({ label, value, onChange, description }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
      <div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}</div>
        {description && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{description}</div>}
      </div>
      <button
        onClick={() => onChange(!value)}
        style={{
          width: 36,
          height: 20,
          borderRadius: 10,
          border: 'none',
          background: value ? 'var(--accent)' : 'var(--bg-accent)',
          cursor: 'pointer',
          position: 'relative',
          transition: 'background 0.3s var(--ease)',
        }}
      >
        <motion.div
          animate={{ x: value ? 16 : 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          style={{
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: '#fff',
            position: 'absolute',
            top: 2,
            left: 2,
          }}
        />
      </button>
    </div>
  );
}

export default function PomodoroSettings({ settings, onUpdate, open, onClose }) {
  const update = (key, val) => onUpdate({ ...settings, [key]: val });

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            style={{
              position: 'fixed', inset: 0,
              background: 'rgba(0,0,0,0.5)',
              zIndex: 200,
            }}
          />
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            style={{
              position: 'fixed',
              top: 0, right: 0, bottom: 0,
              width: 320,
              background: 'var(--bg-card)',
              borderLeft: '1px solid var(--border)',
              padding: 24,
              zIndex: 201,
              overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h3 style={{ fontSize: 16, fontWeight: 300 }}>Settings</h3>
              <button
                onClick={onClose}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
                Timer
              </div>
              <Slider label="Work" value={settings.workMinutes} onChange={(v) => update('workMinutes', v)} min={5} max={60} unit=" min" />
              <Slider label="Short Break" value={settings.shortBreakMinutes} onChange={(v) => update('shortBreakMinutes', v)} min={1} max={15} unit=" min" />
              <Slider label="Long Break" value={settings.longBreakMinutes} onChange={(v) => update('longBreakMinutes', v)} min={5} max={30} unit=" min" />
              <Slider label="Sessions before long break" value={settings.sessionsBeforeLong} onChange={(v) => update('sessionsBeforeLong', v)} min={2} max={8} />
            </div>

            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
                Focus
              </div>
              <Toggle label="Focus Mode" value={settings.focusMode} onChange={(v) => update('focusMode', v)} description="Cat reacts when you leave the tab" />
              <Toggle label="Strict Mode" value={settings.strictMode} onChange={(v) => update('strictMode', v)} description="Shorter grace period (10s)" />
              {settings.focusMode && !settings.strictMode && (
                <Slider label="Grace Period" value={settings.gracePeriodSeconds} onChange={(v) => update('gracePeriodSeconds', v)} min={10} max={60} unit="s" />
              )}
              <Toggle label="Auto-start next" value={settings.autoStart} onChange={(v) => update('autoStart', v)} description="Automatically start next phase" />
            </div>

            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
                Audio
              </div>
              <Toggle label="Sound" value={settings.audioEnabled} onChange={(v) => update('audioEnabled', v)} />
              {settings.audioEnabled && (
                <Slider label="Volume" value={settings.audioVolume} onChange={(v) => update('audioVolume', v)} min={0.1} max={1} step={0.1} />
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
