import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NotificationService } from './notification.service';
import { AlarmPreset, SmartTimer } from './timer.model';
import { TimerEngineService } from './timer-engine.service';
import { TimerStoreService } from './timer-store.service';
import { formatDuration, parseDurationInput } from './time-utils';

@Component({
  selector: 'app-smart-timer',
  imports: [FormsModule],
  templateUrl: './smart-timer.component.html',
  styleUrl: './smart-timer.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SmartTimerComponent {
  private readonly store = inject(TimerStoreService);
  private readonly engine = inject(TimerEngineService);
  protected readonly notification = inject(NotificationService);

  protected readonly timers = this.store.timers;
  protected readonly settings = this.store.settings;
  protected readonly hasTimers = this.store.hasTimers;
  protected readonly durationInputs = signal<Record<string, string>>({});
  protected readonly visibleTimers = computed(() =>
    [...this.timers()].sort((a, b) => a.createdAtEpochMs - b.createdAtEpochMs),
  );
  protected readonly volumePercent = computed(() => Math.round(this.settings().alarmVolume * 100));
  protected readonly alarmPresets: { value: AlarmPreset; label: string }[] = [
    { value: 'classic', label: 'Classic ping' },
    { value: 'pulse', label: 'Pulse alert' },
    { value: 'chime', label: 'Chime' },
    { value: 'double', label: 'Double tap' },
    { value: 'urgent', label: 'Urgent' },
    { value: 'soft', label: 'Soft rise' },
    { value: 'arcade', label: 'Arcade' },
    { value: 'bell', label: 'Bell' },
    { value: 'rise', label: 'Rising tones' },
    { value: 'beacon', label: 'Beacon' },
    { value: 'ios', label: 'new-style' },
  ];

  protected addTimer(): void {
    const timer = this.store.addTimer();

    this.durationInputs.update((inputs) => ({
      ...inputs,
      [timer.id]: formatDuration(timer.durationSeconds),
    }));
  }

  protected removeTimer(id: string): void {
    this.store.removeTimer(id);
    this.durationInputs.update((inputs) => {
      const next = { ...inputs };
      delete next[id];
      return next;
    });
  }

  protected startTimer(timer: SmartTimer): void {
    this.commitDuration(timer);
    this.engine.start(timer.id);
  }

  protected pauseTimer(id: string): void {
    this.engine.pause(id);
  }

  protected stopTimer(id: string): void {
    this.engine.stop(id);
  }

  protected updateName(timer: SmartTimer, name: string): void {
    this.store.updateTimer(timer.id, { name });
  }

  protected setDurationInput(timer: SmartTimer, value: string): void {
    this.durationInputs.update((inputs) => ({ ...inputs, [timer.id]: value }));
    const parsed = parseDurationInput(value);

    if (parsed && timer.status !== 'running') {
      this.store.updateTimer(timer.id, {
        durationSeconds: parsed,
        remainingSeconds: parsed,
        status: timer.status === 'done' ? 'idle' : timer.status,
      });
    }
  }

  protected durationInput(timer: SmartTimer): string {
    return this.durationInputs()[timer.id] ?? formatDuration(timer.durationSeconds);
  }

  protected toggleAutoRestart(timer: SmartTimer, checked: boolean): void {
    this.store.updateTimer(timer.id, { autoRestart: checked });
  }

  protected toggleNotify(timer: SmartTimer, checked: boolean): void {
    this.store.updateTimer(timer.id, { notifyEnabled: checked });
  }

  protected toggleSound(timer: SmartTimer, checked: boolean): void {
    this.store.updateTimer(timer.id, { soundEnabled: checked });
  }

  protected updateDefaultNotify(checked: boolean): void {
    this.store.updateSettings({ notifyEnabled: checked });
  }

  protected updateDefaultSound(checked: boolean): void {
    this.store.updateSettings({ soundEnabled: checked });
  }

  protected updateDefaultAutoRestart(checked: boolean): void {
    this.store.updateSettings({ autoRestart: checked });
  }

  protected updateAlarmVolume(value: number | string): void {
    this.store.updateSettings({ alarmVolume: Number(value) / 100 });
  }

  protected updateAlarmPreset(value: AlarmPreset): void {
    this.store.updateSettings({ alarmPreset: value });
  }

  protected format(seconds: number): string {
    return formatDuration(seconds);
  }

  protected progress(timer: SmartTimer): number {
    if (timer.durationSeconds <= 0) {
      return 0;
    }

    return Math.max(0, Math.min(100, (timer.remainingSeconds / timer.durationSeconds) * 100));
  }

  protected elapsedProgress(timer: SmartTimer): number {
    return 100 - this.progress(timer);
  }

  protected statusLabel(timer: SmartTimer): string {
    if (timer.status === 'running') {
      return 'Running';
    }

    if (timer.status === 'paused') {
      return 'Paused';
    }

    if (timer.status === 'done') {
      return timer.autoRestart ? 'Restarting' : 'Finished';
    }

    return 'Ready';
  }

  protected canStart(timer: SmartTimer): boolean {
    return timer.status !== 'running' && timer.durationSeconds > 0;
  }

  protected isDurationInvalid(timer: SmartTimer): boolean {
    return parseDurationInput(this.durationInput(timer)) === null;
  }

  protected commitDuration(timer: SmartTimer): void {
    const parsed = parseDurationInput(this.durationInput(timer));

    if (!parsed) {
      return;
    }

    this.store.updateTimer(timer.id, {
      durationSeconds: parsed,
      remainingSeconds: timer.status === 'paused' ? timer.remainingSeconds : parsed,
    });
  }
}
