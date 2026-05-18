import { Injectable, computed, signal } from '@angular/core';
import { BossDefinition, BossOnlineEvent, BossTrackerState, DiscordMessageDto } from './boss-tracker.model';
import { BOSS_DEFINITIONS } from './boss-tracker.config';

const STORAGE_KEY = 'boss-tracker-state';
const ONLINE_MESSAGE_PATTERN = /\bserver\s+is\s+(?:now\s+)?(?:back\s+)?online\b/i;
const MAX_EVENTS = 30;
const BOSS_ASSET_BASE_PATH = '/assets/boss-tracker/';

@Injectable({ providedIn: 'root' })
export class BossTrackerStore {
  private readonly bossesSignal = signal<BossDefinition[]>(this.configuredBosses());
  private readonly eventsSignal = signal<BossOnlineEvent[]>([]);

  readonly bosses = this.bossesSignal.asReadonly();
  readonly events = this.eventsSignal.asReadonly();
  readonly latestOnlineEvent = computed(() => {
    const events = this.eventsSignal();

    return events.find((event) => event.source === 'admin-override') ?? events[0] ?? null;
  });

  constructor() {
    this.restore();
  }

  addBoss(name: string, respawnMinutes: number, offsetMinutes: number, map = 'Unknown map', imageAsset = ''): void {
    const boss: BossDefinition = {
      id: this.createId('boss'),
      name: name.trim() || `Boss ${this.bossesSignal().length + 1}`,
      map,
      imageAsset,
      imageWidth: 88,
      imageHeight: 88,
      respawnMinutes: this.sanitizeMinutes(respawnMinutes, 1, 24 * 60),
      offsetMinutes: this.sanitizeMinutes(offsetMinutes, 0, 24 * 60),
      enabled: true,
    };

    this.setBosses([...this.bossesSignal(), boss]);
  }

  updateBoss(id: string, changes: Partial<BossDefinition>): void {
    this.setBosses(
      this.bossesSignal().map((boss) =>
        boss.id === id
          ? this.sanitizeBoss({
              ...boss,
              ...changes,
            })
          : boss,
      ),
    );
  }

  removeBoss(id: string): void {
    this.setBosses(this.bossesSignal().filter((boss) => boss.id !== id));
  }

  registerManualMessage(content: string, localDateTime: string): BossOnlineEvent | null {
    const trimmed = content.trim();

    if (!this.isOnlineMessage(trimmed)) {
      return null;
    }

    const createdAtEpochMs = this.parseLocalDateTime(localDateTime) ?? Date.now();
    const event: BossOnlineEvent = {
      id: this.createId('manual'),
      content: trimmed,
      createdAtEpochMs,
      source: 'manual',
    };

    this.setEvents([event, ...this.eventsSignal()]);

    return event;
  }

  importDiscordMessages(messages: DiscordMessageDto[]): number {
    const imported = messages
      .map((message) => this.toOnlineEvent(message))
      .filter((event): event is BossOnlineEvent => event != null);
    const existingEvents = this.eventsSignal().filter((event) => event.source !== 'admin-override');

    if (!imported.length) {
      this.setEvents(existingEvents);
      return 0;
    }

    this.setEvents([...imported, ...existingEvents]);

    return imported.length;
  }

  clearEvents(): void {
    this.setEvents([]);
  }

  isOnlineMessage(content: string): boolean {
    return ONLINE_MESSAGE_PATTERN.test(content);
  }

  nextSpawnEpochMs(boss: BossDefinition, now = Date.now()): number | null {
    const latestOnline = this.latestOnlineEvent();

    if (!latestOnline || !boss.enabled) {
      return null;
    }

    const anchor = latestOnline.createdAtEpochMs + boss.offsetMinutes * 60_000;
    const interval = boss.respawnMinutes * 60_000;

    if (now <= anchor) {
      return anchor;
    }

    return anchor + Math.ceil((now - anchor) / interval) * interval;
  }

  minutesUntil(epochMs: number, now = Date.now()): number {
    return Math.max(0, Math.ceil((epochMs - now) / 60_000));
  }

  private toOnlineEvent(message: DiscordMessageDto): BossOnlineEvent | null {
    const content = message.content?.trim() ?? '';
    const isAdminOverride = message.source === 'admin-override' || message.override === true;

    if (!content || (!isAdminOverride && !this.isOnlineMessage(content))) {
      return null;
    }

    const timestamp = message.createdAt ?? message.timestamp;
    const createdAtEpochMs = timestamp ? Date.parse(timestamp) : Number.NaN;

    if (!Number.isFinite(createdAtEpochMs)) {
      return null;
    }

    return {
      id: message.id ?? this.createId('discord'),
      content,
      createdAtEpochMs,
      source: isAdminOverride ? 'admin-override' : 'discord-api',
    };
  }

  private setBosses(bosses: BossDefinition[]): void {
    this.bossesSignal.set(bosses.map((boss) => this.sanitizeBoss(boss)));
    this.persist();
  }

  private setEvents(events: BossOnlineEvent[]): void {
    const unique = new Map<string, BossOnlineEvent>();

    events.forEach((event) => {
      unique.set(event.id, {
        ...event,
        content: event.content.trim(),
        createdAtEpochMs: Math.max(0, Math.floor(event.createdAtEpochMs)),
      });
    });

    this.eventsSignal.set(
      [...unique.values()]
        .filter((event) => Number.isFinite(event.createdAtEpochMs) && event.content)
        .sort((a, b) => b.createdAtEpochMs - a.createdAtEpochMs)
        .slice(0, MAX_EVENTS),
    );
    this.persist();
  }

  private sanitizeBoss(boss: BossDefinition): BossDefinition {
    return {
      id: boss.id || this.createId('boss'),
      name: boss.name?.trim() || 'Boss',
      map: boss.map?.trim() || 'Unknown map',
      imageAsset: this.resolveImageAsset(boss.imageAsset),
      imageWidth: this.sanitizeImageSize(boss.imageWidth),
      imageHeight: this.sanitizeImageSize(boss.imageHeight),
      respawnMinutes: this.sanitizeMinutes(boss.respawnMinutes, 1, 24 * 60),
      offsetMinutes: this.sanitizeMinutes(boss.offsetMinutes, 0, 24 * 60),
      enabled: Boolean(boss.enabled),
    };
  }

  private sanitizeMinutes(value: number, min: number, max: number): number {
    const parsed = Math.floor(Number(value));

    if (!Number.isFinite(parsed)) {
      return min;
    }

    return Math.max(min, Math.min(max, parsed));
  }

  private parseLocalDateTime(value: string): number | null {
    const parsed = Date.parse(value);

    return Number.isFinite(parsed) ? parsed : null;
  }

  private restore(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);

      if (!raw) {
        this.persist();
        return;
      }

      const parsed = JSON.parse(raw) as BossTrackerState;

      if (parsed?.version !== 1) {
        this.persist();
        return;
      }

      this.bossesSignal.set(this.configuredBosses());
      this.setEvents(Array.isArray(parsed.events) ? parsed.events : []);
    } catch {
      this.bossesSignal.set(this.configuredBosses());
      this.eventsSignal.set([]);
      this.persist();
    }
  }

  private persist(): void {
    try {
      const state: BossTrackerState = {
        version: 1,
        bosses: this.bossesSignal(),
        events: this.eventsSignal(),
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // localStorage can be unavailable in strict browser settings.
    }
  }

  private createId(prefix: string): string {
    return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  private configuredBosses(): BossDefinition[] {
    return BOSS_DEFINITIONS.map((boss) => this.sanitizeBoss(boss));
  }

  private resolveImageAsset(imageAsset: string): string {
    const trimmed = imageAsset?.trim() ?? '';

    if (!trimmed) {
      return '';
    }

    if (trimmed.startsWith('/') || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return trimmed;
    }

    return `${BOSS_ASSET_BASE_PATH}${trimmed}`;
  }

  private sanitizeImageSize(value: number): number {
    const parsed = Math.floor(Number(value));

    if (!Number.isFinite(parsed)) {
      return 88;
    }

    return Math.max(1, Math.min(2048, parsed));
  }
}
