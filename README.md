# SerpentTempleHelper

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 21.2.9.

## Development server

To start the Angular development server, run:

```bash
npm start
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

When the app runs on `localhost:4200`, it calls the deployed Worker API directly.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Discord boss tracker backend

Cloudflare Workers serves the API route from:

```text
worker/index.js
```

The same API is also available as a Cloudflare Pages Function from:

```text
functions/api/discord-messages.js
```

Set these environment variables in Cloudflare Pages:

```text
DISCORD_BOT_TOKEN
DISCORD_CHANNEL_ID
DISCORD_MESSAGE_PATTERN
DISCORD_MESSAGE_LIMIT
BOSS_ONLINE_OVERRIDE
BOSS_ONLINE_OVERRIDE_TIME_ZONE
```

`DISCORD_MESSAGE_PATTERN` is the text filter used by the backend. It is a regex. The default matches:

```text
Server is now online
Server is back online
```

The default value is:

```text
\bserver\s+is\s+(?:now\s+)?(?:back\s+)?online\b
```

For local Workers testing, copy `.dev.vars.example` to `.dev.vars` and replace the values:

```text
DISCORD_BOT_TOKEN=your_bot_token
DISCORD_CHANNEL_ID=your_channel_id
DISCORD_MESSAGE_PATTERN=\bserver\s+is\s+(?:now\s+)?(?:back\s+)?online\b
DISCORD_MESSAGE_LIMIT=25
BOSS_ONLINE_OVERRIDE=
BOSS_ONLINE_OVERRIDE_TIME_ZONE=Europe/Bucharest
```

`BOSS_ONLINE_OVERRIDE` is optional. For no-redeploy edits, create a Cloudflare KV namespace and bind it to the Pages/Worker project as:

```text
BOSS_TRACKER_CONFIG
```

Then set a KV key named `BOSS_ONLINE_OVERRIDE` when you need to force the boss tracker anchor time. Use `HH:mm`, for example:

```text
21:30
```

`HH:mm` is interpreted in `BOSS_ONLINE_OVERRIDE_TIME_ZONE`, defaulting to `Europe/Bucharest`, as the latest occurrence of that time. You can also set `BOSS_ONLINE_OVERRIDE_TIME_ZONE` as a KV key if needed.

While this value is set, it has priority over Discord messages. Delete the KV key, leave it empty, or set it to `off` to return to normal Discord sync. Environment variables with the same names still work as a fallback, but KV is the better option for changes from the Cloudflare dashboard without redeploying.

Then build and run Workers locally:

```bash
npm run build
npm run start:worker
```

Test the endpoint:

```text
http://127.0.0.1:8787/api/discord-messages
```

Deploy to the `workers.dev` app:

```bash
npm run deploy:worker
```

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
