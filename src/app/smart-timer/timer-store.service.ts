import { Injectable, computed, signal } from '@angular/core';
import { AlarmPreset, SmartTimer, StoredTimerState, TimerSettings } from './timer.model';
import { clampDuration } from './time-utils';

const STORAGE_KEY = 'smart-timer-state';

const DEFAULT_SETTINGS: TimerSettings = {
  notifyEnabled: true,
  soundEnabled: true,
  autoRestart: false,
  alarmVolume: 0.6,
  alarmPreset: 'classic',
  alertBeforeSeconds: 0,
};

const ALARM_PRESETS: AlarmPreset[] = [
  'classic',
  'pulse',
  'chime',
  'double',
  'urgent',
  'soft',
  'arcade',
  'bell',
  'rise',
  'beacon',
  'ios',
];

@Injectable({ providedIn: 'root' })
export class TimerStoreService {
  private readonly timersSignal = signal<SmartTimer[]>([]);
  private readonly settingsSignal = signal<TimerSettings>(DEFAULT_SETTINGS);

  readonly timers = this.timersSignal.asReadonly();
  readonly settings = this.settingsSignal.asReadonly();
  readonly hasTimers = computed(() => this.timersSignal().length > 0);

  constructor() {
    this.restore();
  }

  addTimer(): SmartTimer {
    const index = this.timersSignal().length + 1;
    const settings = this.settingsSignal();
    const timer: SmartTimer = {
      id: this.createId(),
      name: `Timer ${index}`,
      durationSeconds: 5 * 60,
      remainingSeconds: 5 * 60,
      status: 'idle',
      startedAtEpochMs: null,
      autoRestart: settings.autoRestart,
      notifyEnabled: settings.notifyEnabled,
      soundEnabled: settings.soundEnabled,
      lastNotifiedCycle: 0,
      createdAtEpochMs: Date.now(),
    };

    this.setTimers([...this.timersSignal(), timer]);

    return timer;
  }

  removeTimer(id: string): void {
    this.setTimers(this.timersSignal().filter((timer) => timer.id !== id));
  }

  updateSettings(settings: Partial<TimerSettings>): void {
    this.settingsSignal.update((current) => this.sanitizeSettings({ ...current, ...settings }));
    this.persist();
  }

  updateTimer(id: string, changes: Partial<SmartTimer>): void {
    this.setTimers(
      this.timersSignal().map((timer) => (timer.id === id ? this.sanitizeTimer({ ...timer, ...changes }) : timer)),
    );
  }

  startTimer(id: string): void {
    this.setTimers(
      this.timersSignal().map((timer) => {
        if (timer.id !== id) {
          return timer;
        }

        const durationSeconds = clampDuration(timer.durationSeconds || timer.remainingSeconds);
        const remainingSeconds = timer.status === 'paused' && timer.remainingSeconds > 0 ? timer.remainingSeconds : durationSeconds;

        return {
          ...timer,
          durationSeconds,
          remainingSeconds,
          status: 'running',
          startedAtEpochMs: Date.now(),
          lastNotifiedCycle: 0,
        };
      }),
    );
  }

  pauseTimer(id: string, now = Date.now()): void {
    this.setTimers(
      this.timersSignal().map((timer) => {
        if (timer.id !== id || timer.status !== 'running') {
          return timer;
        }

        return {
          ...timer,
          remainingSeconds: this.calculateRemaining(timer, now),
          status: 'paused',
          startedAtEpochMs: null,
        };
      }),
    );
  }

  stopTimer(id: string): void {
    this.setTimers(
      this.timersSignal().map((timer) =>
        timer.id === id
          ? {
              ...timer,
              remainingSeconds: timer.durationSeconds,
              status: 'idle',
              startedAtEpochMs: null,
              lastNotifiedCycle: 0,
            }
          : timer,
      ),
    );
  }

  applyEngineSnapshot(timers: SmartTimer[], persist = false): void {
    this.timersSignal.set(timers.map((timer) => this.sanitizeTimer(timer)));

    if (persist) {
      this.persist();
    }
  }

  private restore(): void {
    const stored = this.readStoredState();

    this.settingsSignal.set(this.sanitizeSettings(stored?.settings ?? DEFAULT_SETTINGS));

    const timers = stored?.timers?.length ? stored.timers.map((timer) => this.restoreTimer(timer)) : [];

    this.timersSignal.set(timers);
    this.persist();
  }

  private restoreTimer(timer: SmartTimer): SmartTimer {
    const sanitized = this.sanitizeTimer(timer);

    return {
      ...sanitized,
      remainingSeconds: sanitized.durationSeconds,
      status: 'idle',
      startedAtEpochMs: null,
      lastNotifiedCycle: 0,
    };
  }

  private calculateRemaining(timer: SmartTimer, now: number): number {
    if (!timer.startedAtEpochMs) {
      return timer.remainingSeconds;
    }

    const elapsed = Math.max(0, Math.floor((now - timer.startedAtEpochMs) / 1000));

    return Math.max(0, timer.remainingSeconds - elapsed);
  }

  private setTimers(timers: SmartTimer[]): void {
    this.timersSignal.set(timers.map((timer) => this.sanitizeTimer(timer)));
    this.persist();
  }

  private sanitizeTimer(timer: SmartTimer): SmartTimer {
    const durationSeconds = Math.max(1, clampDuration(timer.durationSeconds));

    return {
      ...timer,
      name: timer.name?.trim() || 'Timer',
      durationSeconds,
      remainingSeconds: Math.max(0, Math.min(durationSeconds, clampDuration(timer.remainingSeconds))),
      status: timer.status ?? 'idle',
      startedAtEpochMs: timer.startedAtEpochMs ?? null,
      autoRestart: Boolean(timer.autoRestart),
      notifyEnabled: Boolean(timer.notifyEnabled),
      soundEnabled: Boolean(timer.soundEnabled),
      lastNotifiedCycle: Math.max(0, Math.floor(timer.lastNotifiedCycle ?? 0)),
      createdAtEpochMs: timer.createdAtEpochMs || Date.now(),
    };
  }

  private persist(): void {
    try {
      const state: StoredTimerState = {
        version: 1,
        timers: this.timersSignal(),
        settings: this.settingsSignal(),
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // localStorage can be unavailable in private browsing or strict browser settings.
    }
  }

  private readStoredState(): StoredTimerState | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);

      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw) as StoredTimerState;

      if (parsed?.version !== 1 || !Array.isArray(parsed.timers)) {
        return null;
      }

      return {
        version: 1,
        timers: parsed.timers,
        settings: this.sanitizeSettings({ ...DEFAULT_SETTINGS, ...parsed.settings }),
      };
    } catch {
      return null;
    }
  }

  private sanitizeSettings(settings: TimerSettings): TimerSettings {
    return {
      notifyEnabled: Boolean(settings.notifyEnabled),
      soundEnabled: Boolean(settings.soundEnabled),
      autoRestart: Boolean(settings.autoRestart),
      alarmVolume: Math.max(0, Math.min(2, Number(settings.alarmVolume) || 0)),
      alarmPreset: ALARM_PRESETS.includes(settings.alarmPreset) ? settings.alarmPreset : DEFAULT_SETTINGS.alarmPreset,
      alertBeforeSeconds: Math.max(0, Math.min(3600, Math.floor(Number(settings.alertBeforeSeconds) || 0))),
    };
  }

  private createId(): string {
    return globalThis.crypto?.randomUUID?.() ?? `timer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}
