# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Critical: verify Next.js APIs before writing code

This repo uses **Next.js 16.2.6** and **React 19.2.4**. Both have breaking changes versus what is in your training data — APIs, conventions, file structure, and even routing semantics may differ. Before writing or modifying Next.js / React code, read the relevant page in `node_modules/next/dist/docs/` (organized as `01-app/01-getting-started`, `01-app/02-guides`, `01-app/03-api-reference`, etc.). The docs index at `node_modules/next/dist/docs/index.md` contains AI agent hints inside `{/* ... */}` MDX comments — these flag non-obvious requirements (e.g. that some features need a specific named export from a route file).

Honor any deprecation notices you see in those docs.

## Commands

The project uses **Bun** as its package manager (`bun.lock` is the lockfile). The npm-script names still work with `bun run` or any other package manager.

- `bun run dev` — start the Next.js dev server on http://localhost:3000
- `bun run build` — production build
- `bun run start` — run the production build
- `bun run lint` — run ESLint (flat config in `eslint.config.mjs`)

There is no test runner configured.

## Architecture

- **App Router** under `app/` — `layout.tsx` is the root layout (loads Geist + Geist Mono via `next/font/google` and sets CSS variables `--font-geist-sans` / `--font-geist-mono`); `page.tsx` is the root route; `globals.css` is the only stylesheet.
- **Styling: Tailwind CSS v4** wired through PostCSS (`@tailwindcss/postcss` in `postcss.config.mjs`). There is no `tailwind.config.*` file — theme tokens (`--color-background`, `--color-foreground`, `--font-sans`, `--font-mono`) are declared inline in `app/globals.css` via the `@theme inline` block. Add new design tokens there, not in a JS config.
- **TypeScript path alias:** `@/*` resolves to the project root (see `tsconfig.json`), so imports look like `@/app/...` rather than relative paths.
- **ESLint flat config** (`eslint.config.mjs`) extends `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript`. Default ignores from `eslint-config-next` are re-declared explicitly; if you need to add ignores, add them to the `globalIgnores([...])` array.
