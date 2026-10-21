# Copilot instructions

## Build, test, and lint

Use Yarn 1 (the repository pins `yarn@1.22.19`); CI uses Node.js 18.

- `yarn dev` starts the Next.js app and watches/rebuilds built-in masks.
- `yarn build` builds the standalone web app and regenerates `public/masks.json`.
- `yarn lint` runs Next.js ESLint.
- `yarn test:ci` runs the Jest suite once, as in CI.
- Run one test with `yarn test:ci --runInBand --runTestsByPath test/<name>.test.ts` (or `.tsx`).
- `yarn tsc --noEmit` runs the strict TypeScript check; there is no package script for it.
- Desktop development/build use `yarn app:dev` and `yarn app:build`.

Tests live in `test/`, use Jest with the jsdom environment, and match `*.test.js`, `*.test.ts`, `*.test.jsx`, or `*.test.tsx`.

## Architecture

- The Next.js App Router provides the server shell: `app/layout.tsx` injects build-time client configuration into a `config` meta tag, and `app/page.tsx` renders the app shell. The main interactive UI is in `app/components/home.tsx`; it is a client component that uses `HashRouter` and dynamically loads the chat, settings, and other screens.
- Client state is split into Zustand stores under `app/store/` (chat, config, access, masks, plugins, and prompts). `createPersistStore` in `app/utils/store.ts` persists store state to IndexedDB; some small preferences and browser utilities use local storage separately.
- Chat orchestration and message history live in `app/store/chat.ts`. `app/client/api.ts` defines the common model/API types and selects a provider implementation from `app/client/platforms/`. Provider requests use the corresponding `app/api/` handlers where applicable; shared server-side proxy logic is in `app/api/common.ts`, and URL rewrites/build behavior are configured in `next.config.mjs`.
- Server-only environment settings and provider credentials are read through `app/config/server.ts`. `app/config/build.ts` contains build-time values, and `app/config/client.ts` reads the serialized client-safe build config in the browser. Keep provider secrets on server paths; do not add them to the meta-tag client config.
- `src-tauri/` contains the Rust/Tauri desktop wrapper around the same web UI. `BUILD_MODE` and `BUILD_APP` alter the Next.js build for standalone, static export, and desktop builds.
- Built-in prompt masks are authored in `app/masks/`; `app/masks/build.ts` writes their generated runtime data to `public/masks.json`. The build and dev scripts run this generator.
- The workspace `.mcp.json` configures the Playwright MCP server; it requires Node.js 18+ and starts through `npx` when the MCP client launches it.
- The user-facing app brand is Pyjri: use `public/favicon.ico` for the brand mark and the light/dark palette in `app/styles/globals.scss`. Keep upstream repository links, cache keys, desktop bundle identifiers, and updater configuration unchanged unless explicitly requested.

## Repository-specific conventions

- When adding or changing an LLM provider, keep the client implementation, provider selection/model metadata, and the matching server API handler/configuration aligned. Shared request/auth behavior belongs in existing API helpers rather than being reimplemented per route.
- Add a locale in `app/locales/` and register it in the central language maps in `app/locales/index.ts`; English is the fallback locale. Built-in masks have their own language data under `app/masks/` and are registered separately in the mask build.
- App screens are client-side React components under `app/components/`; use the existing route/path definitions in `app/constant.ts` when adding screens. UI styles are generally colocated as SCSS modules.
- Use the `@/*` TypeScript alias for imports rooted at the repository, and follow the existing Prettier settings (2-space indentation, double quotes, semicolons, trailing commas).
