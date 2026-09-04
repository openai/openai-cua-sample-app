import { defineConfig } from "vitest/config";
import { runtimeProject } from "./test-projects.js";

export default defineConfig({ test: { projects: [runtimeProject("javascript", true), runtimeProject("python", true)] } });
