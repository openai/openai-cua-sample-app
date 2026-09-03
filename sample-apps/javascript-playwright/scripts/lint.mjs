import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const eslint = new ESLint({
  cwd: repositoryRoot,
  overrideConfigFile: fileURLToPath(new URL("../eslint.config.mjs", import.meta.url)),
});
const results = await eslint.lintFiles(["labs", "sample-apps/javascript-playwright"]);
const formatter = await eslint.loadFormatter("stylish");
const output = formatter.format(results);
if (output) process.stdout.write(output);
if (results.some(result => result.errorCount || result.warningCount)) process.exitCode = 1;
