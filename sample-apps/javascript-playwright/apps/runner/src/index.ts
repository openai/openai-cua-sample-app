import { createServer } from "./server.js";

const port = Number(process.env.PORT ?? 4001);
const host = process.env.HOST ?? "127.0.0.1";

const server = createServer();

try {
  await server.listen({ port, host });
  console.log(`Runner listening on http://${host}:${port}`);
} catch (error) {
  server.log.error(error);
  process.exit(1);
}
