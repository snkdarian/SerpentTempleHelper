# SerpentTempleHelper

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 21.2.9.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

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
```

Then build and run Workers locally:

```bash
npm run build
npx wrangler dev
```

Test the endpoint:

```text
http://127.0.0.1:8788/api/discord-messages
```

Deploy to the `workers.dev` app:

```bash
npm run build
npx wrangler deploy
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
