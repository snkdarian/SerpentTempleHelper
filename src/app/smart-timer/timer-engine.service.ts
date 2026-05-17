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
    let shouldPersist = forcePersist;
    const completedTimers: SmartTimer[] = [];

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
        const nextTimer = {
          ...timer,
          remainingSeconds: remainder === 0 ? duration : duration - remainder,
          lastNotifiedCycle: timer.lastNotifiedCycle,
        };

        if (cycles > timer.lastNotifiedCycle) {
          nextTimer.lastNotifiedCycle = cycles;
          completedTimers.push(nextTimer);
          shouldPersist = true;
        }

        return nextTimer;
      }

      const remainingSeconds = Math.max(0, timer.remainingSeconds - elapsed);

      if (remainingSeconds === 0) {
        const completed = {
          ...timer,
          remainingSeconds: 0,
          status: 'done' as const,
          startedAtEpochMs: null,
          lastNotifiedCycle: 1,
        };

        if (timer.lastNotifiedCycle === 0) {
          completedTimers.push(completed);
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

    for (const timer of completedTimers) {
      this.notificationService.timerCompleted(timer);

      if (timer.soundEnabled) {
        void this.alarmService.play(this.store.settings().alarmVolume, this.store.settings().alarmPreset);
      }
    }
  }
}
