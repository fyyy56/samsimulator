# Development guardrails

- The current working tree is the only source of truth.
- Inspect current imports and runtime usage before editing; do not revive a
  legacy implementation from an old prompt without confirming that it is active.
- Validate browser behaviour against the current Vite dev server at `127.0.0.1:5173`.
- After a large change, run `npm run check:maintenance`, lint, build, and the
  focused checks for the affected subsystem.
