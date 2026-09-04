// @vitest-environment node
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from "next/constants.js";
import { writeConfigurationDefaults } from "next/dist/lib/typescript/writeConfigurationDefaults.js";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import configureNext from "../next.config.mjs";

const consolePath = fileURLToPath(new URL("../", import.meta.url));

describe("Next.js output isolation", () => {
  it("keeps development output separate while build and start share production output", () => {
    const development = configureNext(PHASE_DEVELOPMENT_SERVER);
    const build = configureNext(PHASE_PRODUCTION_BUILD);
    const start = configureNext(PHASE_PRODUCTION_SERVER);

    expect(development.distDir).not.toBe(build.distDir);
    expect(build.distDir).toBe(".next");
    expect(start.distDir).toBe(build.distDir);
  });

  it("needs no TypeScript configuration rewrites when Next switches between dev and build/typegen", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "console-next-types-"));
    try {
      const fixtureConsole = join(fixture, "console");
      await mkdir(fixtureConsole);
      await writeFile(join(fixture, "tsconfig.base.json"), await readFile(join(consolePath, "../tsconfig.base.json")));
      const tsconfigPath = join(fixtureConsole, "tsconfig.json");
      const original = await readFile(join(consolePath, "tsconfig.json"), "utf8");
      await writeFile(tsconfigPath, original);
      await writeFile(join(fixtureConsole, "page.tsx"), "export default function Page() { return null; }\n");

      for (const phase of [PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD, PHASE_DEVELOPMENT_SERVER]) {
        const { distDir } = configureNext(phase);
        await writeConfigurationDefaults(ts, tsconfigPath, false, true, distDir!, false);
        expect(await readFile(tsconfigPath, "utf8")).toBe(original);
      }
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });
});
