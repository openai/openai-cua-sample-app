import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as contracts from "./index.js";

type Fixture = { name: string; schema: string; valid: boolean; value: unknown };
const fixtures = JSON.parse(readFileSync(new URL("./fixtures.json", import.meta.url), "utf8")) as Fixture[];
describe("shared wire contract fixtures", () => {
  for (const fixture of fixtures) {
    it(fixture.name, () => {
      const schema = (contracts as Record<string, unknown>)[fixture.schema];
      if (!(schema instanceof z.ZodType)) throw new Error(`Unknown schema ${fixture.schema}`);
      const result = schema.safeParse(fixture.value);
      expect(result.success).toBe(fixture.valid);
    });
  }
});
