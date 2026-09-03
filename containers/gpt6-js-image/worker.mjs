import readline from "node:readline";
import vm from "node:vm";
import { openBrowser } from "./browser.mjs";

const objects = await openBrowser();
let output = [];
let bytes = 0;
function append(item) {
  bytes += Buffer.byteLength(JSON.stringify(item));
  if (bytes > 16 * 1024 * 1024 || output.length >= 100) throw new Error("Output limit exceeded");
  output.push(item);
}
// The container is the isolation boundary. vm only keeps runtime variables alive.
const scope = vm.createContext({
  ...objects,
  console: { log: (...values) => append({ type: "input_text", text: values.map(String).join(" ").slice(0, 12000) }) },
  display: (image) => {
    if (typeof image !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(image)) {
      throw new TypeError("display expects a base64 image string");
    }
    append({ type: "input_image", image_url: `data:image/png;base64,${image}`, detail: "original" });
  },
});
process.stdout.write('{"ready":true}\n');
for await (const line of readline.createInterface({ input: process.stdin })) {
  output = [];
  bytes = 0;
  try {
    const { code } = JSON.parse(line);
    await new vm.Script(`(async () => {${code}\n})()`).runInContext(scope, { timeout: 25000 });
  } catch (error) {
    output.push({ type: "input_text", text: `Execution error: ${String(error).slice(0, 12000)}` });
  }
  if (!output.length) output.push({ type: "input_text", text: "Execution completed." });
  process.stdout.write(`${JSON.stringify({ output })}\n`);
}
