import { useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, SkipForward } from 'lucide-react';

import { usePomodoro } from '../lib/usePomodoro';
import { Button } from './ui/Button';

const PRESETS = [
  { work: 25, break: 5, label: '25/5' },
  { work: 50, break: 10, label: '50/10' },
  { work: 15, break: 5, label: '15/5' },
] as const;

export function FocusChip() {
  const pomo = usePomodoro();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (root.current && !root.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (pomo.running && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  }, [pomo.running]);

  return (
    <div className="mo-focus" ref={root}>
      <div className="mo-focus__chip" data-running={pomo.running ? 'true' : 'false'}>
        <button
          type="button"
          className="mo-focus__toggle"
          aria-label={pomo.running ? 'Pause focus timer' : 'Start focus timer'}
          onClick={pomo.toggle}
        >
          {pomo.running ? <Pause size={12} aria-hidden="true" /> : <Play size={12} aria-hidden="true" />}
        </button>
        <button
          type="button"
          className="mo-focus__time"
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={`${pomo.label} ${pomo.clock}. Open timer controls.`}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="mo-num">{pomo.clock}</span>
        </button>
      </div>

      {open && (
        <div className="mo-focus__pop" role="dialog" aria-label="Focus timer">
          <div className="mo-focus__pophead">
            <span className="mo-eyebrow">{pomo.label}</span>
            <span className="mo-num" style={{ fontSize: 'var(--fs-title)' }}>{pomo.clock}</span>
          </div>
          <div className="mo-focus__bar" aria-hidden="true">
            <span style={{ width: `${Math.round(pomo.progress * 100)}%` }} />
          </div>
          <div className="mo-focus__actions">
            <Button size="sm" icon label={pomo.running ? 'Pause' : 'Start'} onClick={pomo.toggle}>
              {pomo.running ? <Pause size={12} aria-hidden="true" /> : <Play size={12} aria-hidden="true" />}
            </Button>
            <Button size="sm" icon label="Reset timer" onClick={pomo.reset}>
              <RotateCcw size={12} aria-hidden="true" />
            </Button>
            <Button size="sm" icon label="Skip to next phase" onClick={pomo.skip}>
              <SkipForward size={12} aria-hidden="true" />
            </Button>
          </div>
          <div className="mo-focus__presets">
            {PRESETS.map((preset) => {
              const active = pomo.settings.workMinutes === preset.work
                && pomo.settings.shortBreakMinutes === preset.break;
              return (
                <button
                  key={preset.label}
                  type="button"
                  className={active ? 'mo-focus__preset is-on' : 'mo-focus__preset'}
                  onClick={() => pomo.applySettings({
                    workMinutes: preset.work,
                    shortBreakMinutes: preset.break,
                  })}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
