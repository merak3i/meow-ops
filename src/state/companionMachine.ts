import { setup, assign } from 'xstate';
import type { DeveloperProfile } from '@/types/session';

// ─── Context ──────────────────────────────────────────────────────────────────

export interface CompanionContext {
  profile:          DeveloperProfile | null;
  /** Cursor position in normalised viewport space (−1 to +1) */
  cursorX:          number;
  cursorY:          number;
  /** Seconds since user last interacted */
  idleSeconds:      number;
  /** Whether a Pomodoro focus block is active */
  pomodoroActive:   boolean;
  /** Fatigue score 0–1 from profile.morph_weights.fatigue */
  fatigueScore:     number;
  /** Accumulated pet count (head click events) */
  petCount:         number;
  /** Wellness score 0–1 driven by game stats (hunger/energy/health) */
  wellnessScore:    number;
}

// ─── Events ───────────────────────────────────────────────────────────────────

export type CompanionEvent =
  | { type: 'CURSOR_MOVE';     x: number; y: number }
  | { type: 'SESSION_UPDATE';  profile: DeveloperProfile }
  | { type: 'GAME_UPDATE';     wellness: number; energy: number }
  | { type: 'POMODORO_START' }
  | { type: 'POMODORO_END' }
  | { type: 'PET' }
  | { type: 'TICK' }           // emitted every second by a global interval
  | { type: 'WAKE' };

// ─── Guards ───────────────────────────────────────────────────────────────────

const isExhausted   = ({ context }: { context: CompanionContext }) => context.fatigueScore >= 0.8;
const isFocusing    = ({ context }: { context: CompanionContext }) => context.pomodoroActive;
const isNeglected   = ({ context }: { context: CompanionContext }) => context.idleSeconds >= 3600; // 1 hour
const isIdle        = ({ context }: { context: CompanionContext }) => context.idleSeconds >= 120;  // 2 min
const isUnwell      = ({ context }: { context: CompanionContext }) => context.wellnessScore < 0.3 && !context.pomodoroActive;

// ─── Machine ──────────────────────────────────────────────────────────────────

export const companionMachine = setup({
  types: {} as {
    context: CompanionContext;
    events:  CompanionEvent;
  },
  guards: {
    isExhausted,
    isFocusing,
    isNeglected,
    isIdle,
    isUnwell,
  },
  actions: {
    resetIdle: assign({ idleSeconds: 0 }),

    incrementIdle: assign(({ context }) => ({
      idleSeconds: context.idleSeconds + 1,
    })),

    updateCursor: assign(({ context, event }) => {
      if (event.type !== 'CURSOR_MOVE') return context;
      return { cursorX: event.x, cursorY: event.y, idleSeconds: 0 };
    }),

    applyProfile: assign(({ event }) => {
      if (event.type !== 'SESSION_UPDATE') return {};
      return {
        profile:      event.profile,
        fatigueScore: event.profile.morph_weights.fatigue,
      };
    }),

    incrementPet: assign(({ context }) => ({
      petCount:   context.petCount + 1,
      idleSeconds: 0,
    })),

    startPomodoro: assign({ pomodoroActive: true,  idleSeconds: 0 }),
    endPomodoro:   assign({ pomodoroActive: false }),

    applyGameUpdate: assign(({ event }) => {
      if (event.type !== 'GAME_UPDATE') return {};
      return { wellnessScore: event.wellness };
    }),
  },
}).createMachine({
  id:      'companion',
  initial: 'active',

  context: {
    profile:        null,
    cursorX:        0,
    cursorY:        0,
    idleSeconds:    0,
    pomodoroActive: false,
    fatigueScore:   0,
    petCount:       0,
    wellnessScore:  1,
  },

  on: {
    // Global transitions that apply from any state
    CURSOR_MOVE:    { actions: 'updateCursor' },
    SESSION_UPDATE: { actions: 'applyProfile' },
    GAME_UPDATE:    { actions: 'applyGameUpdate' },
    PET:            { actions: 'incrementPet', target: '.active' },
  },

  states: {
    active: {
      entry: 'resetIdle',

      on: {
        TICK: [
          { guard: 'isExhausted', target: 'fatigue',   actions: 'incrementIdle' },
          { guard: 'isFocusing',  target: 'focus',     actions: 'incrementIdle' },
          { guard: 'isUnwell',    target: 'concerned', actions: 'incrementIdle' },
          { guard: 'isIdle',      target: 'idle',      actions: 'incrementIdle' },
          {                                            actions: 'incrementIdle' },
        ],
        POMODORO_START: { target: 'focus', actions: 'startPomodoro' },
      },
    },

    idle: {
      on: {
        TICK: [
          { guard: 'isNeglected', target: 'neglected', actions: 'incrementIdle' },
          {                        actions: 'incrementIdle' },
        ],
        CURSOR_MOVE: { target: 'active', actions: ['resetIdle', 'updateCursor'] },
        WAKE:        { target: 'active', actions: 'resetIdle' },
        POMODORO_START: { target: 'focus', actions: 'startPomodoro' },
      },
    },

    focus: {
      on: {
        TICK: [
          { guard: 'isExhausted', target: 'fatigue', actions: 'incrementIdle' },
          {                        actions: 'incrementIdle' },
        ],
        POMODORO_END: { target: 'active', actions: 'endPomodoro' },
      },
    },

    fatigue: {
      on: {
        TICK: { actions: 'incrementIdle' },
        // Only wake from fatigue when a new session comes in (profile update refreshes fatigue)
        SESSION_UPDATE: [
          { guard: ({ event }) =>
              event.type === 'SESSION_UPDATE' && event.profile.morph_weights.fatigue < 0.8,
            target: 'active',
            actions: 'applyProfile',
          },
          { actions: 'applyProfile' },
        ],
      },
    },

    neglected: {
      on: {
        CURSOR_MOVE: { target: 'active', actions: ['resetIdle', 'updateCursor'] },
        WAKE:        { target: 'active', actions: 'resetIdle' },
        TICK:        { actions: 'incrementIdle' },
      },
    },

    concerned: {
      // Low wellness (hunger/health/energy) — slow breathing, head droops
      on: {
        TICK: [
          { guard: 'isExhausted', target: 'fatigue',   actions: 'incrementIdle' },
          { guard: 'isFocusing',  target: 'focus',     actions: 'incrementIdle' },
          {                                            actions: 'incrementIdle' },
        ],
        // Recovered when wellness comes back above threshold via GAME_UPDATE
        GAME_UPDATE: [
          {
            guard: ({ event }) =>
              event.type === 'GAME_UPDATE' && event.wellness >= 0.3,
            target: 'active',
            actions: 'applyGameUpdate',
          },
          { actions: 'applyGameUpdate' },
        ],
        CURSOR_MOVE:    { actions: ['updateCursor'] },
        POMODORO_START: { target: 'focus', actions: 'startPomodoro' },
        PET:            { actions: 'incrementPet', target: 'active' },
      },
    },
  },
});

// ─── State display helpers ────────────────────────────────────────────────────

export type CompanionState = 'active' | 'idle' | 'focus' | 'fatigue' | 'neglected' | 'concerned';

export function stateLabel(state: CompanionState): string {
  const labels: Record<CompanionState, string> = {
    active:    'Active',
    idle:      'Resting',
    focus:     'Focus Mode',
    fatigue:   'Exhausted',
    neglected: 'Lonely',
    concerned: 'Needs Care',
  };
  return labels[state] ?? 'Active';
}

export function stateEmoji(state: CompanionState): string {
  const emojis: Record<CompanionState, string> = {
    active:    '😺',
    idle:      '😴',
    focus:     '🎯',
    fatigue:   '😵',
    neglected: '🥺',
    concerned: '😟',
  };
  return emojis[state] ?? '😺';
}
