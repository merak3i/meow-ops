export const PHASES: {
  WORK: 'work';
  SHORT_BREAK: 'short_break';
  LONG_BREAK: 'long_break';
};

export interface PomodoroSettings {
  workMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  sessionsBeforeLong: number;
  autoStart: boolean;
  focusMode: boolean;
  strictMode: boolean;
  audioEnabled: boolean;
  audioVolume: number;
  gracePeriodSeconds: number;
}

export function getSettings(): PomodoroSettings;
export function saveSettings(partial: Partial<PomodoroSettings>): PomodoroSettings;
export function addSession(session: {
  breed: string;
  phase: string;
  status: string;
  focusScore: number;
  startedAt: string;
  duration: number;
}): unknown[];
export function createChimeSound(volume?: number): { play: () => void };
