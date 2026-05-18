import { NgOptimizedImage } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { BossTrackerStore } from './boss-tracker.store';

type SyncStatus = 'idle' | 'loading' | 'success' | 'error';

const DISCORD_POLL_MS = 10 * 60 * 1000;
const CLOCK_TICK_MS = 15_000;
const DISCORD_MESSAGES_PATH = '/api/discord-messages';
const LOCAL_WORKER_DISCORD_MESSAGES_URL = 'https://metin2-helper.eternya2.workers.dev/api/discord-messages';

@Component({
  selector: 'app-boss-tracker',
  imports: [NgOptimizedImage],
  templateUrl: './boss-tracker.component.html',
  styleUrl: './boss-tracker.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BossTrackerComponent implements OnInit, OnDestroy {
  private readonly store = inject(BossTrackerStore);
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private clockHandle: ReturnType<typeof setInterval> | null = null;

  protected readonly syncStatus = signal<SyncStatus>('idle');
  protected readonly syncMessage = signal('Auto sync pornit: verific /api/discord-messages la fiecare 10 minute.');
  protected readonly nowEpochMs = signal(Date.now());

  protected readonly bosses = this.store.bosses;
  protected readonly latestOnlineEvent = this.store.latestOnlineEvent;
  protected readonly trackerRows = computed(() => {
    const now = this.nowEpochMs();

    return this.bosses().filter((boss) => boss.enabled).map((boss) => {
      const nextSpawnEpochMs = this.store.nextSpawnEpochMs(boss, now);

      return {
        boss,
        nextSpawnEpochMs,
        minutesUntil: nextSpawnEpochMs == null ? null : this.store.minutesUntil(nextSpawnEpochMs, now),
      };
    });
  });

  ngOnInit(): void {
    this.syncDiscordMessages();
    this.pollHandle = setInterval(() => this.syncDiscordMessages(), DISCORD_POLL_MS);
    this.clockHandle = setInterval(() => this.nowEpochMs.set(Date.now()), CLOCK_TICK_MS);
  }

  ngOnDestroy(): void {
    if (this.pollHandle) {
      clearInterval(this.pollHandle);
    }

    if (this.clockHandle) {
      clearInterval(this.clockHandle);
    }
  }

  protected formatTime(epochMs: number | null): string {
    if (epochMs == null) {
      return '--:--';
    }

    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(epochMs);
  }

  protected formatRespawn(minutes: number): string {
    if (minutes % 60 === 0) {
      const hours = minutes / 60;

      return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
    }

    return `${minutes} min`;
  }

  private async syncDiscordMessages(): Promise<void> {
    try {
      const response = await fetch(this.discordMessagesUrl(), {
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = (await response.json()) as unknown;
      const messages = Array.isArray(payload) ? payload : [];
      this.store.importDiscordMessages(messages);

      this.syncStatus.set('success');
      this.syncMessage.set('Auto sync activ.');
    } catch {
      this.syncStatus.set('error');
      this.syncMessage.set('Asteapta endpointul /api/discord-messages.');
    }
  }

  private discordMessagesUrl(): string {
    const location = globalThis.location;

    if (location?.hostname === 'localhost' && location.port === '4200') {
      return LOCAL_WORKER_DISCORD_MESSAGES_URL;
    }

    return DISCORD_MESSAGES_PATH;
  }
}
