export type BossDefinition = {
  /** Stable unique key. Change only if this is a different boss. */
  id: string;
  /** Name shown in the Boss column. */
  name: string;
  /** Map/location text shown under the boss name. */
  map: string;
  /** Optional image path from /public, for example "/assets/bosses/name.png". */
  imageAsset: string;
  /** Intrinsic image width used by NgOptimizedImage. UI frame stays fixed. */
  imageWidth: number;
  /** Intrinsic image height used by NgOptimizedImage. UI frame stays fixed. */
  imageHeight: number;
  /** Respawn interval counted from the latest server-online message. */
  respawnMinutes: number;
  /** Optional delay after server-online before this boss starts its cycle. */
  offsetMinutes: number;
  /** Disabled bosses stay in config but are hidden from the tracker. */
  enabled: boolean;
};

export type BossOnlineEvent = {
  id: string;
  content: string;
  createdAtEpochMs: number;
  source: 'manual' | 'discord-api';
};

export type BossTrackerState = {
  version: 1;
  bosses: BossDefinition[];
  events: BossOnlineEvent[];
};

export type DiscordMessageDto = {
  id?: string;
  content?: string;
  createdAt?: string;
  timestamp?: string;
};
