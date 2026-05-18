const DISCORD_API_BASE = 'https://discord.com/api/v10';
const DEFAULT_MESSAGE_PATTERN = '\\bserver\\s+is\\s+(?:now\\s+)?(?:back\\s+)?online\\b';
const DEFAULT_MESSAGE_LIMIT = 25;
const DEFAULT_OVERRIDE_TIME_ZONE = 'Europe/Bucharest';

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type, accept',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/discord-messages') {
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            ...jsonHeaders,
            allow: 'GET, OPTIONS',
          },
        });
      }

      if (request.method !== 'GET') {
        return jsonResponse({ error: 'Method not allowed.' }, 405);
      }

      return fetchDiscordMessages(env);
    }

    return env.ASSETS.fetch(request);
  },
};

async function fetchDiscordMessages(env) {
  const botToken = env.DISCORD_BOT_TOKEN;
  const channelId = env.DISCORD_CHANNEL_ID;
  const messagePattern = createMessagePattern(env.DISCORD_MESSAGE_PATTERN);
  const messageLimit = sanitizeLimit(env.DISCORD_MESSAGE_LIMIT);
  const overrideSettings = await loadBossOnlineOverrideSettings(env);
  const overrideMessage = createBossOnlineOverrideMessage(overrideSettings);

  if (!botToken || !channelId) {
    if (overrideMessage) {
      return jsonResponse([overrideMessage]);
    }

    return jsonResponse({ error: 'Missing DISCORD_BOT_TOKEN or DISCORD_CHANNEL_ID.' }, 500);
  }

  const response = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages?limit=${messageLimit}`, {
    headers: {
      authorization: `Bot ${botToken}`,
      accept: 'application/json',
    },
  });

  if (!response.ok) {
    if (overrideMessage) {
      return jsonResponse([overrideMessage]);
    }

    return jsonResponse(
      {
        error: 'Discord API request failed.',
        status: response.status,
      },
      response.status,
    );
  }

  const messages = await response.json();
  const onlineMessages = Array.isArray(messages)
    ? messages
        .filter((message) => messagePattern.test(searchableMessageText(message)))
        .map((message) => ({
          id: message.id,
          content: displayMessageContent(message),
          createdAt: message.timestamp,
          source: 'discord-api',
        }))
    : [];

  return jsonResponse(overrideMessage ? [overrideMessage, ...onlineMessages] : onlineMessages);
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: jsonHeaders,
  });
}

function createMessagePattern(pattern) {
  try {
    return new RegExp(pattern || DEFAULT_MESSAGE_PATTERN, 'i');
  } catch {
    return new RegExp(DEFAULT_MESSAGE_PATTERN, 'i');
  }
}

function sanitizeLimit(limit) {
  const parsed = Number(limit);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_MESSAGE_LIMIT;
  }

  return Math.max(1, Math.min(100, Math.floor(parsed)));
}

async function loadBossOnlineOverrideSettings(env) {
  const kv = env.BOSS_TRACKER_CONFIG;
  const kvValue = typeof kv?.get === 'function' ? await kv.get('BOSS_ONLINE_OVERRIDE') : null;
  const kvTimeZone = typeof kv?.get === 'function' ? await kv.get('BOSS_ONLINE_OVERRIDE_TIME_ZONE') : null;

  return {
    value: kvValue ?? env.BOSS_ONLINE_OVERRIDE,
    timeZone: kvTimeZone ?? env.BOSS_ONLINE_OVERRIDE_TIME_ZONE,
  };
}

function createBossOnlineOverrideMessage({ value, timeZone }) {
  const trimmed = value?.trim();

  if (!trimmed || /^(?:false|off|none|clear)$/i.test(trimmed)) {
    return null;
  }

  const epochMs = parseOverrideEpochMs(trimmed, timeZone);

  if (epochMs == null) {
    return null;
  }

  const createdAt = new Date(epochMs).toISOString();

  return {
    id: `admin-override-${createdAt}`,
    content: 'Server is now online (admin override)',
    createdAt,
    source: 'admin-override',
    override: true,
  };
}

function parseOverrideEpochMs(value, timeZone) {
  const timeOnlyMatch = /^(?<hour>[01]\d|2[0-3]):(?<minute>[0-5]\d)$/.exec(value);

  if (timeOnlyMatch?.groups) {
    return parseLatestTimeOnlyEpochMs(
      Number(timeOnlyMatch.groups.hour),
      Number(timeOnlyMatch.groups.minute),
      timeZone,
    );
  }

  if (/^\d+$/.test(value)) {
    const numeric = Number(value);

    if (!Number.isFinite(numeric)) {
      return null;
    }

    const epochMs = numeric < 10_000_000_000 ? numeric * 1000 : numeric;

    return Number.isFinite(epochMs) ? epochMs : null;
  }

  const parsed = Date.parse(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function parseLatestTimeOnlyEpochMs(hour, minute, timeZone) {
  const zone = sanitizeTimeZone(timeZone);
  const now = new Date();
  const today = getZonedDateParts(now, zone);
  let candidate = zonedDateTimeToEpochMs(
    {
      ...today,
      hour,
      minute,
      second: 0,
    },
    zone,
  );

  if (candidate > now.getTime()) {
    const yesterday = previousUtcDateParts(today);
    candidate = zonedDateTimeToEpochMs(
      {
        ...yesterday,
        hour,
        minute,
        second: 0,
      },
      zone,
    );
  }

  return candidate;
}

function sanitizeTimeZone(timeZone) {
  const candidate = timeZone?.trim() || DEFAULT_OVERRIDE_TIME_ZONE;

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return DEFAULT_OVERRIDE_TIME_ZONE;
  }
}

function getZonedDateParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function previousUtcDateParts({ year, month, day }) {
  const previous = new Date(Date.UTC(year, month - 1, day - 1));

  return {
    year: previous.getUTCFullYear(),
    month: previous.getUTCMonth() + 1,
    day: previous.getUTCDate(),
  };
}

function zonedDateTimeToEpochMs(parts, timeZone) {
  const utcGuess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  let epochMs = utcGuess - getTimeZoneOffsetMs(new Date(utcGuess), timeZone);
  epochMs = utcGuess - getTimeZoneOffsetMs(new Date(epochMs), timeZone);

  return epochMs;
}

function getTimeZoneOffsetMs(date, timeZone) {
  const zonedParts = getZonedDateParts(date, timeZone);
  const zonedAsUtcMs = Date.UTC(
    zonedParts.year,
    zonedParts.month - 1,
    zonedParts.day,
    zonedParts.hour,
    zonedParts.minute,
    zonedParts.second,
  );

  return zonedAsUtcMs - date.getTime();
}

function displayMessageContent(message) {
  return searchableMessageText(message).trim().slice(0, 2000);
}

function searchableMessageText(message) {
  const parts = [];

  appendMessageText(parts, message);

  for (const snapshot of message.message_snapshots ?? []) {
    appendMessageText(parts, snapshot.message);
  }

  return parts.filter(Boolean).join('\n');
}

function appendMessageText(parts, message) {
  if (!message) {
    return;
  }

  parts.push(message.content ?? '');

  for (const embed of message.embeds ?? []) {
    parts.push(embed.title ?? '', embed.description ?? '');
    parts.push(embed.author?.name ?? '', embed.footer?.text ?? '');

    for (const field of embed.fields ?? []) {
      parts.push(field.name ?? '', field.value ?? '');
    }
  }
}
