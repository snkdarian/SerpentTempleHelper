import { TestBed } from '@angular/core/testing';
import { BossTrackerStore } from './boss-tracker.store';

describe('BossTrackerStore', () => {
  let store: BossTrackerStore;

  beforeEach(() => {
    localStorage.clear();

    TestBed.configureTestingModule({});
    store = TestBed.inject(BossTrackerStore);
  });

  it('uses online messages as the respawn anchor', () => {
    const anchor = '2026-05-17T14:02';
    const event = store.registerManualMessage('Server is back online', anchor);

    expect(event).not.toBeNull();

    const boss = store.bosses()[0];
    store.updateBoss(boss.id, { respawnMinutes: 60 });
    const updatedBoss = store.bosses()[0];
    const nextSpawn = store.nextSpawnEpochMs(updatedBoss, Date.parse('2026-05-17T14:03'));

    expect(nextSpawn).toBe(Date.parse('2026-05-17T15:02'));
  });

  it('keeps adding respawn intervals until the next spawn is in the future', () => {
    const event = store.registerManualMessage('Server is now online', '2026-05-17T14:02');

    expect(event).not.toBeNull();

    const boss = store.bosses()[0];
    store.updateBoss(boss.id, { respawnMinutes: 120 });

    const updatedBoss = store.bosses()[0];
    const nextSpawn = store.nextSpawnEpochMs(updatedBoss, Date.parse('2026-05-17T17:04'));

    expect(nextSpawn).toBe(Date.parse('2026-05-17T18:02'));
  });

  it('ignores messages that do not match the online trigger', () => {
    const event = store.registerManualMessage('Server restart soon', '2026-05-17T14:02');

    expect(event).toBeNull();
    expect(store.events()).toEqual([]);
  });

  it('imports matching Discord messages and skips unrelated messages', () => {
    const imported = store.importDiscordMessages([
      {
        id: '1',
        content: 'Server is now online',
        createdAt: '2026-05-17T14:02:00.000Z',
      },
      {
        id: '2',
        content: 'Maintenance soon',
        createdAt: '2026-05-17T14:05:00.000Z',
      },
    ]);

    expect(imported).toBe(1);
    expect(store.events()).toHaveLength(1);
    expect(store.events()[0].id).toBe('1');
  });
});
