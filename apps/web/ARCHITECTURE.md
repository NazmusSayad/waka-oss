# Folder Architecture

This dashboard uses a **feature-based architecture**.
We organize code by business features, not just file types.

```text
├── src/
│   ├── main.tsx       # Entry point: global CSS + renders the app shell
│   ├── app/           # App shell: navigation, date range, compare, filters, data loading, URL state
│   ├── features/      # Self-contained views, one folder each
│   │   └── overview/  # Example feature folder
│   │       ├── index.ts        # ONLY export what's needed
│   │       ├── overview.tsx    # UI for this feature
│   │       └── utils/          # Utils just for this feature
│   ├── components/    # Reusable, global UI (chart, panel, stat, date picker)
│   │   └── ui/        # shadcn/ui components (generated)
│   ├── lib/           # Global setup (Tailwind cn, etc.)
│   ├── hooks/         # Global React hooks
│   ├── utils/         # Global helper functions (dates, formatting, aggregation, colors)
│   ├── types/         # Global TS types
│   ├── styles/        # Global CSS (Tailwind + shadcn theme variables)
│   ├── constants/     # Global static values
│   └── api/           # API contract types and fetch helper
└── vite.config.ts     # Dev proxy to the Rust server and the `@` alias
```

## The Rules

- **Feature Isolation:**
  A feature cannot import from another feature.
  Shared logic goes in `src/utils`, `src/lib` or `src/components`.

- **Public API:**
  Keep feature files private.
  Only export what the app needs via `index.ts`.

- **Absolute Imports:**
  Use `@/` for all imports.
  No `../../../` messy paths.

- **Thin Shell:**
  `src/app` only composes the features and owns the global state they share.
  Real view code goes in `src/features`.

- **Colocation:**
  Keep files close to where they are used.
  If a helper is only used in the `patterns` feature, put it there.
  Don't clutter global `src/components` or `src/utils`.
