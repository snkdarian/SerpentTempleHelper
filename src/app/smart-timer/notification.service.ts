import { Injectable, signal } from '@angular/core';
import { SmartTimer } from './timer.model';

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private permissionRequested = false;

  readonly latestMessage = signal<string | null>(null);

  requestBrowserPermission(): void {
    if (this.permissionRequested || !this.supportsBrowserNotifications()) {
      return;
    }

    this.permissionRequested = true;

    if (Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  }

  timerCompleted(timer: SmartTimer): void {
    const message = `${timer.name} finished`;

    this.sendTimerMessage(timer, message, `smart-timer-${timer.id}`);
  }

  timerEndingSoon(timer: SmartTimer): void {
    const message = `${timer.name} entering final seconds`;

    this.sendTimerMessage(timer, message, `smart-timer-warning-${timer.id}`);
  }

  clearLatestMessage(): void {
    this.latestMessage.set(null);
  }

  private sendTimerMessage(timer: SmartTimer, message: string, tag: string): void {
    this.latestMessage.set(message);

    if (timer.notifyEnabled && document.hidden && this.supportsBrowserNotifications() && Notification.permission === 'granted') {
      new Notification('SmartTimer', {
        body: message,
        tag,
        requireInteraction: false,
      });
    }
  }

  private supportsBrowserNotifications(): boolean {
    return typeof window !== 'undefined' && 'Notification' in window && window.isSecureContext;
  }
}
