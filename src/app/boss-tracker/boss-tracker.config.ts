import { BossDefinition } from './boss-tracker.model';

// Edit this list to define the bosses shown in Boss tracker.
// Properties:
// id: stable unique key
// name: boss name shown in the table
// map: map/location text shown under the boss name
// imageAsset: file name from public/assets/boss-tracker or a full path/URL.
// Example: "Northwind_Depths_War_Chief_Ice_Lightning.png"
// imageWidth/imageHeight: intrinsic asset size; UI still renders all icons in the same fixed frame.
// respawnMinutes: 60 = 1 hour, 120 = 2 hours, 1440 = 24 hours
// offsetMinutes: delay after server-online before this boss starts its cycle
// enabled: true shows the boss, false hides it without deleting the config
export const BOSS_DEFINITIONS: BossDefinition[] = [
  {
    id: 'northwind-sh-general',
    name: 'Northwind Sh. General',
    map: 'Northwind Shelter',
    imageAsset: 'Northwind_Depths_War_Chief_Ice_Lightning.png',
    imageWidth: 250,
    imageHeight: 211,
    respawnMinutes: 120,
    offsetMinutes: 0,
    enabled: true,
  },
  {
    id: 'example-one-hour-boss',
    name: 'Example 1h Boss',
    map: 'Example Map',
    imageAsset: '',
    imageWidth: 88,
    imageHeight: 88,
    respawnMinutes: 60,
    offsetMinutes: 0,
    enabled: true,
  },
  {
    id: 'example-two-hour-boss',
    name: 'Example 2h Boss',
    map: 'Example Map',
    imageAsset: '',
    imageWidth: 88,
    imageHeight: 88,
    respawnMinutes: 120,
    offsetMinutes: 0,
    enabled: true,
  },
];
