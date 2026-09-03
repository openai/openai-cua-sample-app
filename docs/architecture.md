# Architecture

The public release branch is a TypeScript monorepo organized around one browser-focused runner pipeline.

## Package Boundaries

### `packages/replay-schema`

Shared contracts for:

- scenario manifests
- run start requests and responses
- replay bundle metadata
- SSE event payloads
- structured runner errors
- versioned paint document snapshots and save records

If an HTTP route or UI state is public, its shape should be defined here first.

### `packages/scenario-kit`

Scenario manifests and default prompts for the three public labs:

- kanban
- paint
- booking

This package is the public scenario registry. Adding a new scenario starts here.

### `packages/browser-runtime`

Thin Playwright session abstraction for:

- launching the browser
- resolving the start target
- reading browser state
- capturing screenshots

It does not know about scenario prompts, verification, or the Responses API.

### `packages/runner-core`

Core orchestration for:

- mutable run workspaces
- run lifecycle management
- the Responses API loop
- scenario executors
- verification

`src/responses-loop.ts` is the canonical sample for the Responses API integration in this repo.

### `apps/runner`

Fastify HTTP layer for:

- `POST /api/runs`
- `GET /api/runs/:id`
- `POST /api/runs/:id/stop`
- `GET /api/runs/:id/events`
- `GET /api/runs/:id/replay`
- scenario reset and screenshot artifact routes

This app should stay thin. The logic belongs in `runner-core`.

### `apps/demo-web`

Next.js operator console for:

- selecting a scenario
- starting and stopping runs
- reviewing streamed activity
- scrubbing captured screenshots
- surfacing actionable runner guidance

The UI is split into a hook (`useRunStream`) plus focused presentational components.

## Runtime Flow

1. The operator console requests the public scenario registry from the runner.
2. Starting a run asks `RunnerManager` to create a mutable workspace and replay bundle.
3. `RunnerManager` selects a scenario executor through `executor-registry.ts`.
4. The executor launches the lab and hands control to `responses-loop.ts`, which exposes a persistent Playwright JavaScript REPL through `exec_js`.
5. The loop emits events, screenshots, and final verification results back into the replay bundle.
6. The web app reads the run detail and follows SSE updates until the run finishes.

## Request And Replay Contracts

Runs have a single browser execution path. Start-run requests omit `mode`; the strict request schema rejects unknown fields, including both former execution-mode values, with HTTP 400. Run records omit `mode`, and scenario manifests omit `defaultMode`. The separate browser mode still selects headless or headful Chromium.

New replay bundles use version `2`. Their event vocabulary includes REPL function calls and excludes the former computer-call events. Saved replay files are left untouched, with no migration or historical native-run display support.

## Sketch Studio

The paint lab is a static HTML/CSS application with browser ES modules. Its document engine owns a fixed 1024 × 768 raster document with up to eight transparent Canvas 2D layers over a white background. The renderer composites these layers into the display canvas and maps pointer coordinates through zoom and pan. Transient previews and selections use a separate overlay; resizing changes the view without resizing document buffers.

The tool engine implements drawing transactions, shapes, text, fill, and selection editing. History retains pixel-region deltas and metadata/layer changes, bounded to 50 actions and 64 MiB. Eviction removes undo entries without changing current artwork. Persistence captures immutable version-2 save records, stores completed drafts in IndexedDB, restores validated layers on reload, and exports the composite PNG.

The runner waits for `__paintLabReady` and reads `__paintReadDocumentSnapshot()` and `__paintReadSaveRecord()`. These accessors do not edit or save the document. The verifier compares current and saved metadata and pixel hashes, independently decodes saved PNGs, recomposites layers, and checks for visible nonwhite pixels. This verifies a consistent, nonblank save; matching the operator's requested subject requires visual review.

After the Responses loop completes normally, the paint executor captures the last saved draft under `artwork/` in the run workspace before optional verification and teardown. It writes `draft.sketch.json` and `draft.png` through temporary files, reports their paths in events and summary notes, and propagates image-validation or filesystem failures. Capture also runs when verification is disabled. No saved draft produces no retained paint files. Cancelled or interrupted runs may close the browser before capture.

Draft recovery is scoped to the lab origin and browser context. Each new run starts fresh, and the editor does not import retained project JSON. The paint save-record version is independent of the existing replay-bundle version `2`.

## Extensibility

The public branch intentionally exposes only three scenarios, but the architecture is meant to be forked:

- add a manifest in `scenario-kit`
- add a verifier and instructions in `runner-core`
- register the executor in `executor-registry.ts`
- add a lab template under `labs`

That path is documented in [docs/contributing.md](./contributing.md).
