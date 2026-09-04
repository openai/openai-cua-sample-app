# Shared operator console

One Next.js console displays controls, agent activity, screenshots, and replay links for either backend. Select the backend when launching from the repository root:

```bash
pnpm dev:js
# After stopping JavaScript:
pnpm dev:python
```

Both choices use [http://127.0.0.1:3000](http://127.0.0.1:3000). The subheader says **JavaScript / Playwright** or **Python / PyAutoGUI**. There is no in-app backend selector; bare `pnpm dev` prints the two launch commands. Only one backend can run at a time.

## Configuration and startup

The root launcher sets `CUA_BACKEND=javascript|python` and one `RUNNER_BASE_URL`, defaulting to JavaScript on **4001** or Python on **4041**. It honors `HOST`/`PORT` and an explicit `RUNNER_BASE_URL` override. The root `.env` and launching shell configure model defaults; the console reads them through `/api/capabilities`.

[`app/page.tsx`](app/page.tsx) checks capabilities against the expected backend, then loads its scenario catalog and active run. Failed discovery keeps Start unavailable. JavaScript exposes headless/visible browser controls; Python shows a fixed visible desktop. The console sends `X-CUA-Backend` on JSON requests; the backend rejects mismatches before performing actions.

The Next.js routes and global styles live in `app/`. The interactive controls and run state live in `components/`; `tests/` covers the console and request recovery.

## Run review and recovery

[`useRunStream.ts`](components/useRunStream.ts) manages Start, Stop, Reset, active-run recovery, bounded HTTP requests, SSE, and serialized detail polling. A lost Start response triggers an active-run lookup without automatically resending Start. Polling recovers completion even when SSE is interrupted or the activity feed is paused. Older responses cannot overwrite a newer Stop or Reset result.

[`ScreenshotPane.tsx`](components/ScreenshotPane.tsx) reviews captured frames while preserving a pinned selection. It displays screenshot dimensions when available. [`helpers.ts`](components/helpers.ts) renders both `exec_js` and `exec_py` activity.

Use **Show thumbnails** and the timeline to inspect earlier screenshots, and **Replay JSON** to open the recorded trace. **Run finished** reports normal execution and cleanup; it does not certify that the model accomplished the task. Inspect the screenshots and model response to judge the result. Advanced settings contain browser mode and turn budget.

Shared request/event/replay types come from [`contracts`](../contracts/). The console contains no model-request loop or execution runtime.

## Checks and production

Development uses `.next-dev`; build, start, and type generation use `.next`, so a production build does not overwrite a running development server’s output.

From the repository root:

```bash
pnpm --filter @cua-sample/console test
pnpm --filter @cua-sample/console typecheck
pnpm build
pnpm start:js
```

After shutting down the launch, use `pnpm start:python` to run the same production console with the installed Python backend. Ctrl+C requests graceful cleanup of the selected backend and console. See the [root guide](../README.md) for installation and the backend guides for live runs.
