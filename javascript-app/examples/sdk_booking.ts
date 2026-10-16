import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";

import OpenAI, { ComputerToolset, type ComputerDriver } from "openai";
import { chromium, type Browser, type Page } from "playwright";

import defaults from "../../contracts/defaults.json" with { type: "json" };
import { startWorkspaceLabServer } from "../src/workspace-lab-server.ts";
import catalog from "../../labs/catalog.json" with { type: "json" };

const root = resolve(import.meta.dirname, "../..");
const keyNames: Record<string, string> = {
  CTRL: "Control", CONTROL: "Control", CMD: "Meta", COMMAND: "Meta", META: "Meta",
  ALT: "Alt", OPTION: "Alt", SHIFT: "Shift", ENTER: "Enter", RETURN: "Enter",
  ESC: "Escape", ESCAPE: "Escape", TAB: "Tab", SPACE: "Space", BACKSPACE: "Backspace",
  DELETE: "Delete", UP: "ArrowUp", DOWN: "ArrowDown", LEFT: "ArrowLeft", RIGHT: "ArrowRight",
};

function createDriver(page: Page): ComputerDriver {
  async function withKeys(keys: string[] | null | undefined, action?: () => Promise<void>) {
    const held: string[] = [];
    try {
      for (const key of keys ?? []) {
        const name = keyNames[key.toUpperCase()] ?? key;
        await page.keyboard.down(name);
        held.push(name);
      }
      await action?.();
    } finally {
      for (const key of held.reverse()) await page.keyboard.up(key);
    }
  }

  return {
    click: ({ x, y, button, keys }) => {
      if (button !== "left" && button !== "right" && button !== "wheel") {
        throw new Error(`Unsupported browser mouse button: ${button}`);
      }
      return withKeys(keys, () => page.mouse.click(x, y, { button: button === "wheel" ? "middle" : button }));
    },
    double_click: ({ x, y, keys }) => withKeys(keys, () => page.mouse.dblclick(x, y)),
    drag: ({ path, keys }) => withKeys(keys, async () => {
      const [start, ...rest] = path;
      if (!start) throw new Error("Drag path is empty.");
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      try {
        for (const { x, y } of rest) await page.mouse.move(x, y, { steps: 3 });
      } finally {
        await page.mouse.up();
      }
    }),
    keypress: ({ keys }) => withKeys(keys),
    move: ({ x, y, keys }) => withKeys(keys, () => page.mouse.move(x, y)),
    scroll: ({ x, y, scroll_x, scroll_y, keys }) => withKeys(keys, async () => {
      await page.mouse.move(x, y);
      await page.mouse.wheel(scroll_x, scroll_y);
    }),
    type: ({ text }) => page.keyboard.insertText(text),
    wait: () => sleep(500),
    screenshot: async () => ({
      type: "computer_screenshot",
      image_url: `data:image/png;base64,${(await page.screenshot({ type: "png", scale: "css" })).toString("base64")}`,
    }),
  };
}

const { values } = parseArgs({
  options: { prompt: { type: "string" }, model: { type: "string" }, help: { type: "boolean" } },
});
if (values.help) {
  console.log("Usage: pnpm --dir javascript-app/examples start [--prompt TEXT] [--model MODEL]");
  process.exit(0);
}
const booking = catalog.scenarios.find((scenario) => scenario.labId === "booking");
if (!booking) throw new Error("Booking lab not found in the catalog.");

const client = new OpenAI();
const lab = await startWorkspaceLabServer({ workspacePath: resolve(root, "labs", booking.templateDirectory) });
let browser: Browser | undefined;
try {
  browser = await chromium.launch({ headless: true, timeout: 15_000 });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, serviceWorkers: "block",
  });
  const origin = new URL(lab.urlFor()).origin;
  await context.route("**/*", (route) => new URL(route.request().url()).origin === origin
    ? route.continue() : route.abort());
  const page = await context.newPage();
  await page.goto(lab.urlFor(), { waitUntil: "networkidle" });

  const toolset = new ComputerToolset(createDriver(page));
  try {
    const response = await toolset.run(client, {
      model: values.model ?? defaults.model,
      input: values.prompt ?? booking.defaultPrompt,
      instructions: "Use the computer to complete the requested task on this fictional booking site. Request a screenshot to inspect the page before acting.",
      store: false,
    }, { maxSteps: 20 });
    console.log(response.output_text);
    const screenshot = resolve(root, "data", "sdk-booking.png");
    await mkdir(dirname(screenshot), { recursive: true });
    await page.screenshot({ path: screenshot, fullPage: true });
    console.log(`Final page screenshot: ${screenshot}`);
  } finally {
    toolset.close();
  }
} finally {
  await Promise.all([browser?.close(), lab.close()]);
}
