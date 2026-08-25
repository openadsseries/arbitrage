<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## UI writing rules

- Use sentence case for interface labels, metadata, buttons, and helper text.
- Keep uppercase only for brand names, token symbols, and technical acronyms such as GETHYPED, OG, USDC, ERC-20, CSP, and TWAP.
- Never rely on CSS `text-transform: uppercase`; write the intended casing in the source copy.

# UI typography rules

- Use the typography tokens defined in `app/globals.css`; do not introduce arbitrary font sizes.
- Text must not be smaller than `--text-meta` (12px), except chart-axis labels using `--text-axis` (11px).
- Reserve `--text-display` for the home hero. Every other page uses one clear page title and lead description.
- Use uppercase metadata labels only for section context, state, or source information.

# UI layout rules

- Follow `DESIGN.md` for all interface work.
- Every top-level page, the global header, and the footer must share the same `--layout-max` and `--layout-gutter` alignment tokens.
- Do not introduce route-specific outer container widths.
