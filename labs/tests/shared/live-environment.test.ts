import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";

const roots: string[] = [];
afterEach(() => Promise.all(roots.splice(0).map(root => rm(root, { force: true, recursive: true }))));

it.each(["javascript", "python"])("loads %s app .env before live test imports, with shell values taking precedence", async (runtime) => {
  const root = await mkdtemp(join(tmpdir(), "cua-live-env-"));
  roots.push(root);
  const cwd = join(root, "labs");
  const appRoot = join(root, `${runtime}-app`);
  const testEntry = join(cwd, "node_modules", "vitest", "vitest.mjs");
  await mkdir(appRoot, { recursive: true });
  await mkdir(join(cwd, "node_modules", "vitest"), { recursive: true });
  await writeFile(join(appRoot, ".env"), 'CUA_DEFAULT_MODEL="app-env-model"\n');
  await writeFile(join(cwd, "model.mjs"), 'export const model = process.env.CUA_DEFAULT_MODEL;');
  // The live entry is a local probe, so this checks the real command without an API call.
  await writeFile(testEntry, 'import { model } from "../../model.mjs"; console.log(model);');
  const manifest = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  const [command, ...args] = manifest.scripts[`test:live:${runtime}`].split(" ") as string[];
  expect(command).toBe("node");
  const env = { ...process.env };
  delete env.CUA_DEFAULT_MODEL;
  const run = promisify(execFile);
  expect((await run(process.execPath, args, { cwd, env })).stdout.trim()).toBe("app-env-model");
  expect((await run(process.execPath, args, { cwd, env: { ...env, CUA_DEFAULT_MODEL: "shell-model" } })).stdout.trim()).toBe("shell-model");
});
