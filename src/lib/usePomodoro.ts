import { useSyncExternalStore } from 'react';

import {
  PHASES,
  addSession,
  createChimeSound,
  getSettings,
  saveSettings,
} from './pomodoro-store';

type Phase = (typeof PHASES)[keyof typeof PHASES];
type Settings = ReturnType<typeof getSettings>;

export interface PomodoroState {
  phase: Phase;
  remaining: number;
  duration: number;
  running: boolean;
  sessionIndex: number;
  settings: Settings;
}

function durationFor(phase: Phase, settings: Settings): number {
  if (phase === PHASES.SHORT_BREAK) return settings.shortBreakMinutes * 60;
  if (phase === PHASES.LONG_BREAK) return settings.longBreakMinutes * 60;
  return settings.workMinutes * 60;
}

function initialState(): PomodoroState {
  const settings = getSettings();
  const duration = durationFor(PHASES.WORK, settings);
  return {
    phase: PHASES.WORK,
    remaining: duration,
    duration,
    running: false,
    sessionIndex: 0,
    settings,
  };
}

let state: PomodoroState = initialState();
let startedAt: number | null = null;
let interval: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listen) => listen());
}

function setState(next: PomodoroState) {
  state = next;
  emit();
}

function stopClock() {
  if (interval) clearInterval(interval);
  interval = null;
}

function startClock() {
  if (interval) return;
  interval = setInterval(tick, 250);
}

function tick() {
  if (!startedAt) startedAt = Date.now();
  const elapsed = Math.floor((Date.now() - startedAt) / 1000);
  const remaining = Math.max(0, state.duration - elapsed);
  if (remaining <= 0) {
    advance();
    return;
  }
  setState({ ...state, remaining });
}

function start() {
  startedAt = Date.now() - ((state.duration - state.remaining) * 1000);
  setState({ ...state, running: true });
  startClock();
}

function pause() {
  stopClock();
  startedAt = null;
  setState({ ...state, running: false });
}

function reset() {
  stopClock();
  startedAt = null;
  const settings = getSettings();
  const duration = durationFor(PHASES.WORK, settings);
  setState({
    phase: PHASES.WORK,
    remaining: duration,
    duration,
    running: false,
    sessionIndex: 0,
    settings,
  });
}

function advance() {
  const wasWork = state.phase === PHASES.WORK;
  if (wasWork) {
    addSession({
      breed: 'persian',
      phase: 'work',
      status: 'completed',
      focusScore: 100,
      startedAt: new Date().toISOString(),
      duration: state.duration,
    });
  }

  let nextPhase: Phase;
  let nextSessionIndex = state.sessionIndex;
  if (wasWork) {
    if (state.sessionIndex + 1 >= state.settings.sessionsBeforeLong) {
      nextPhase = PHASES.LONG_BREAK;
      nextSessionIndex = 0;
    } else {
      nextPhase = PHASES.SHORT_BREAK;
      nextSessionIndex = state.sessionIndex + 1;
    }
  } else {
    nextPhase = PHASES.WORK;
    if (state.phase === PHASES.LONG_BREAK) nextSessionIndex = 0;
  }

  const duration = durationFor(nextPhase, state.settings);
  stopClock();
  startedAt = state.settings.autoStart ? Date.now() : null;
  setState({
    ...state,
    phase: nextPhase,
    remaining: duration,
    duration,
    running: Boolean(state.settings.autoStart),
    sessionIndex: nextSessionIndex,
  });
  if (state.settings.autoStart) startClock();

  if (state.settings.audioEnabled) {
    createChimeSound(state.settings.audioVolume).play();
  }
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    const body = nextPhase === PHASES.WORK ? 'Time to focus.' : 'Take a break.';
    new Notification('Meow Ops', { body, icon: '/meow-favicon.png' });
  }
}

function applySettings(partial: Partial<Settings>) {
  const settings = saveSettings(partial);
  const duration = durationFor(state.phase, settings);
  if (!state.running) {
    setState({ ...state, settings, duration, remaining: duration });
    return;
  }
  setState({ ...state, settings });
}

function subscribe(listen: () => void) {
  listeners.add(listen);
  return () => listeners.delete(listen);
}

function format(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function phaseLabel(phase: Phase): string {
  if (phase === PHASES.SHORT_BREAK) return 'Break';
  if (phase === PHASES.LONG_BREAK) return 'Long break';
  return 'Focus';
}

export function usePomodoro() {
  const snap = useSyncExternalStore(subscribe, () => state, () => state);
  return {
    ...snap,
    label: phaseLabel(snap.phase),
    clock: format(snap.remaining),
    progress: snap.duration > 0 ? 1 - snap.remaining / snap.duration : 0,
    start,
    pause,
    reset,
    skip: advance,
    toggle: () => (snap.running ? pause() : start()),
    applySettings,
  };
}
