const DISCORD_API_BASE = 'https://discord.com/api/v10';
const DEFAULT_MESSAGE_PATTERN = '\\bserver\\s+is\\s+(?:now\\s+)?(?:back\\s+)?online\\b';
const DEFAULT_MESSAGE_LIMIT = 25;

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
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
        .filter((message) => messagePattern.test(message.content ?? ''))
        .map((message) => ({
          id: message.id,
          content: message.content,
          createdAt: message.timestamp,
        }))
    : [];

  return jsonResponse(onlineMessages);
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
