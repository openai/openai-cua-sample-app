import assert from "node:assert/strict";

const mode = process.argv[2] ?? "smoke";
const endpoint = process.env.CUA_CHECK_URL ?? "http://127.0.0.1:8000";
const health = await fetch(`${endpoint}/health`).then((response) => response.json());
assert.equal(health.ready, true);
if (mode === "health") process.exit(0);
const language = health.language;
const headers = {
  "content-type": "application/json",
  authorization: `Bearer ${process.env.OPENAI_EXAMPLE_CODE_EXECUTION_TOKEN}`,
};
async function execute(code, session = "setup-check") {
  const response = await fetch(`${endpoint}/execute`, {
    method: "POST", headers,
    body: JSON.stringify({ language, session_id: session, code }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}
const screenshotCode = language === "javascript"
  ? 'display((await page.screenshot()).toString("base64"));'
  : "display(pyautogui.screenshot())";
if (mode === "timeout") {
  const started = Date.now();
  const response = await fetch(`${endpoint}/execute`, {
    method: "POST", headers,
    body: JSON.stringify({ language, session_id: "setup-check", code: language === "javascript" ? "await Promise.resolve(); while (true) {}" : "while True: pass" }),
  });
  assert.equal(response.status, 504);
  assert.ok(Date.now() - started < 30_000);
  console.log("PASS: hung execution rejected before the client timeout; container stopping.");
  process.exit(0);
}
const unauthorized = await fetch(`${endpoint}/execute`, { method: "POST" });
assert.equal(unauthorized.status, 401);
await execute(language === "javascript" ? "globalThis.setupMarker = 41;" : "setup_marker = 41");
const persisted = await execute(language === "javascript" ? "console.log(setupMarker + 1);" : "log(setup_marker + 1)");
assert.ok(persisted.output.some((item) => item.type === "input_text" && item.text === "42"));
if (language === "javascript") {
  await execute(`
    await page.goto("http://127.0.0.1:8000/fixture");
    await page.locator("input").click();
    await page.keyboard.type("Replace me");
    await page.keyboard.press("Control+a");
    await page.keyboard.type("Alice");
    await page.mouse.wheel(0, 1800);
    await page.locator("button").click();
    await page.getByText("Success: Alice submitted.").waitFor();
  `);
} else {
  await execute(`
pyautogui.hotkey("ctrl", "l")
pyautogui.write("http://127.0.0.1:8000/fixture", interval=0.01)
pyautogui.press("enter")
time.sleep(1)
pyautogui.press("tab")
pyautogui.write("Replace me", interval=0.05)
pyautogui.hotkey("ctrl", "a")
pyautogui.write("Alice", interval=0.05)
pyautogui.click(1100, 400)
pyautogui.scroll(-20)
time.sleep(0.5)
pyautogui.press("tab")
pyautogui.press("enter")
time.sleep(0.5)
  `);
}
const result = await fetch(`${endpoint}/fixture/result`, { headers }).then((response) => response.json());
assert.equal(result?.name, "Alice", JSON.stringify(result));
assert.ok(result.clicks > 0 && result.wheels > 0 && result.keys > 0, JSON.stringify(result));
const { output } = await execute(screenshotCode);
const image = output.find((item) => item.type === "input_image");
assert.equal(image?.detail, "original");
const png = Buffer.from(image.image_url.split(",")[1], "base64");
assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
assert.equal(png.readUInt32BE(16), 1440);
assert.equal(png.readUInt32BE(20), language === "javascript" ? 900 : 1000);
const otherSession = await fetch(`${endpoint}/execute`, {
  method: "POST", headers, body: JSON.stringify({ language, session_id: "another-client", code: screenshotCode }),
});
assert.equal(otherSession.status, 409);
console.log(`PASS ${language}: authentication, persistent variables, keyboard shortcut, click, scroll, form submission, PNG screenshot (${png.readUInt32BE(16)}x${png.readUInt32BE(20)}), session isolation.`);
console.log("Restart this container before running the guide's client with its new session ID.");
