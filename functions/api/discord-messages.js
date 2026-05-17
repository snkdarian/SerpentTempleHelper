const DISCORD_API_BASE = 'https://discord.com/api/v10';
const DEFAULT_MESSAGE_PATTERN = '\\bserver\\s+is\\s+(?:now\\s+)?(?:back\\s+)?online\\b';
const DEFAULT_MESSAGE_LIMIT = 25;

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type, accept',
};

export async function onRequestGet({ env }) {
  const botToken = env.DISCORD_BOT_TOKEN;
  const channelId = env.DISCORD_CHANNEL_ID;
  const messagePattern = createMessagePattern(env.DISCORD_MESSAGE_PATTERN);
  const messageLimit = sanitizeLimit(env.DISCORD_MESSAGE_LIMIT);

  if (!botToken || !channelId) {
    return jsonResponse({ error: 'Missing DISCORD_BOT_TOKEN or DISCORD_CHANNEL_ID.' }, 500);
  }

  const response = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages?limit=${messageLimit}`, {
    headers: {
      authorization: `Bot ${botToken}`,
      accept: 'application/json',
    },
  });

  if (!response.ok) {
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
        }))
    : [];

  return jsonResponse(onlineMessages);
}

export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      ...jsonHeaders,
      allow: 'GET, OPTIONS',
    },
  });
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
