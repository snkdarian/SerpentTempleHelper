import { DestroyRef, Injectable, inject } from '@angular/core';
import { AlarmService } from './alarm.service';
import { NotificationService } from './notification.service';
import { SmartTimer } from './timer.model';
import { TimerStoreService } from './timer-store.service';

@Injectable({ providedIn: 'root' })
export class TimerEngineService {
  private readonly store = inject(TimerStoreService);
  private readonly notificationService = inject(NotificationService);
  private readonly alarmService = inject(AlarmService);
  private readonly destroyRef = inject(DestroyRef);
  private intervalId: number | null = null;

  constructor() {
    this.intervalId = window.setInterval(() => this.tick(), 250);
    this.destroyRef.onDestroy(() => {
      if (this.intervalId !== null) {
        window.clearInterval(this.intervalId);
      }
    });
  }

  start(id: string): void {
    this.notificationService.requestBrowserPermission();
    void this.alarmService.unlock();
    this.store.startTimer(id);
    this.tick(true);
  }

  pause(id: string): void {
    this.store.pauseTimer(id);
  }

  stop(id: string): void {
    this.store.stopTimer(id);
  }

  private tick(forcePersist = false): void {
    const now = Date.now();
    const settings = this.store.settings();
    const alertBeforeSeconds = settings.alertBeforeSeconds;
    let shouldPersist = forcePersist;
    const alertTimers: { timer: SmartTimer; kind: 'completed' | 'warning' }[] = [];

    const nextTimers = this.store.timers().map((timer) => {
      if (timer.status !== 'running' || !timer.startedAtEpochMs) {
        return timer;
      }

      const duration = Math.max(1, timer.durationSeconds);
      const elapsed = Math.max(0, Math.floor((now - timer.startedAtEpochMs) / 1000));

      if (elapsed < 1) {
        return timer;
      }

      if (timer.autoRestart) {
        const cycles = Math.floor(elapsed / duration);
        const remainder = elapsed % duration;
        const remainingSeconds = remainder === 0 ? duration : duration - remainder;
        const nextTimer = {
          ...timer,
          remainingSeconds,
          lastNotifiedCycle: timer.lastNotifiedCycle,
        };

        if (alertBeforeSeconds > 0) {
          const alertCycle = cycles + 1;

          if (remainingSeconds <= alertBeforeSeconds && alertCycle > timer.lastNotifiedCycle) {
            nextTimer.lastNotifiedCycle = alertCycle;
            alertTimers.push({ timer: nextTimer, kind: 'warning' });
            shouldPersist = true;
          }
        } else if (cycles > timer.lastNotifiedCycle) {
          nextTimer.lastNotifiedCycle = cycles;
          alertTimers.push({ timer: nextTimer, kind: 'completed' });
          shouldPersist = true;
        }

        return nextTimer;
      }

      const remainingSeconds = Math.max(0, timer.remainingSeconds - elapsed);

      if (alertBeforeSeconds > 0 && remainingSeconds > 0 && remainingSeconds <= alertBeforeSeconds && timer.lastNotifiedCycle === 0) {
        const warning = {
          ...timer,
          remainingSeconds,
          startedAtEpochMs: now,
          lastNotifiedCycle: 1,
        };

        alertTimers.push({ timer: warning, kind: 'warning' });
        shouldPersist = true;

        return warning;
      }

      if (remainingSeconds === 0) {
        const completed = {
          ...timer,
          remainingSeconds: 0,
          status: 'done' as const,
          startedAtEpochMs: null,
          lastNotifiedCycle: 1,
        };

        if (alertBeforeSeconds === 0 && timer.lastNotifiedCycle === 0) {
          alertTimers.push({ timer: completed, kind: 'completed' });
        }

        shouldPersist = true;

        return completed;
      }

      return {
        ...timer,
        remainingSeconds,
        startedAtEpochMs: now,
      };
    });

    this.store.applyEngineSnapshot(nextTimers, shouldPersist);

    for (const alert of alertTimers) {
      if (alert.kind === 'warning') {
        this.notificationService.timerEndingSoon(alert.timer);
      } else {
        this.notificationService.timerCompleted(alert.timer);
      }

      if (alert.timer.soundEnabled) {
        void this.alarmService.play(settings.alarmVolume, settings.alarmPreset);
      }
    }
  }
}
