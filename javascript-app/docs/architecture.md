# Architecture

The JavaScript sample app is an independent pnpm workspace under `javascript-app`. Its packages follow one browser-focused runner pipeline. The repository-root `labs/` templates are copied into fresh run workspaces; they are never edited during a run.

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

Browser lifecycle and execution boundaries for:

- launching the browser
- resolving the start target
- reading browser state
- capturing screenshots
- starting one JavaScript child process per run and enforcing request deadlines

The parent owns a Playwright browser-server handle. The child connects to that browser and owns its page, context, and persistent JavaScript state. A small internal protocol covers initialization, execution, state and screenshots, finalization, and closing. It does not forward the full Playwright API.

### `packages/runner-core`

Core orchestration for:

- mutable run workspaces
- run lifecycle management
- the Responses API loop
- scenario executors
- verification

The [model loop](../packages/runner-core/src/responses-loop.ts) stays in the main process, along with the API key. The [execution worker](../packages/runner-core/src/javascript-worker.ts) owns script evaluation and scenario verification and does not inherit the API key. The runner build emits the worker explicitly; development starts it from TypeScript.

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

The console fills the viewport. Run actions stay above the workspace; controls and activity scroll independently, and screenshots scale to the available space without cropping. Below 960px, Controls, Preview, and Activity navigation shows one panel while keeping all panel state mounted. Starting a run or selecting an activity frame opens Preview. Thumbnails are collapsed initially, with the timeline slider always available. Resize observers restore activity following when its panel becomes visible and keep the selected thumbnail within the horizontal filmstrip without scrolling the page. Manually reviewing older activity or a pinned frame preserves that position as new events arrive.

## Runtime Flow

1. The operator console requests the public scenario registry from the runner.
2. `RunnerManager` reserves the active-run slot before creating a mutable workspace and replay bundle.
3. `RunnerManager` selects a scenario executor through `executor-registry.ts`.
4. The executor starts the lab server, parent-owned Chromium, and the JavaScript worker. The model loop exposes `exec_js`, sending code to the worker.
5. The loop records tool output and screenshots, continuing after commentary and completing on a final assistant message with no pending tool calls. Explicit API failure states, unsupported tools, and exhausted turn budgets fail the run.
6. After normal model completion, the worker captures saved artwork and performs optional verification. The parent records results and writes replay snapshots atomically.
7. Worker, browser, and lab-server cleanup completes before the active-run slot is released. Stop and shutdown may be called repeatedly.
8. The console receives initial run detail in the start response, follows SSE, and polls to recover missed updates or connections. Completed persisted runs can also replay their events.

## Execution Deadline And Cleanup

The parent starts a 20-second deadline before sending JavaScript to the child. Ordinary script exceptions are returned as tool output. Stop, timeout, a worker crash, or a malformed worker response closes the session and awaits process cleanup. Because the deadline and browser handle live outside the worker, synchronous loops, loops after `await`, and unresolved promises cannot block the HTTP server or prevent termination. A new run starts with fresh JavaScript and browser state.

The worker is an execution boundary for cancellation, not an operating-system security sandbox. Run this sample only against the local labs or other environments you control.

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
