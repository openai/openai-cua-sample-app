import { describe, expect, it } from "vitest";

import { resolveBrowserStartTarget } from "../src/index.js";

describe("browser runtime", () => {
  it("resolves workspace file targets against the mutable workspace", () => {
    const resolved = resolveBrowserStartTarget(
      {
        kind: "workspace_file",
        label: "workspace:index.html",
        path: "index.html",
      },
      "/tmp/run-123",
    );

    expect(resolved.targetLabel).toBe("workspace:index.html");
    expect(resolved.url).toBe("file:///tmp/run-123/index.html");
  });

  it("passes remote targets through untouched", () => {
    const resolved = resolveBrowserStartTarget(
      {
        kind: "remote_url",
        url: "http://127.0.0.1:3101",
      },
      "/tmp/run-123",
    );

    expect(resolved.targetLabel).toBe("http://127.0.0.1:3101");
    expect(resolved.url).toBe("http://127.0.0.1:3101");
  });
});
