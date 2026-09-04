import asyncio
import logging
import os
import socket
import sys

import uvicorn

from .api import create_app
from .config import Settings, load_environment

logger = logging.getLogger(__name__)


def main() -> None:
    load_environment()
    settings = Settings.from_environment()
    app = create_app(settings=settings)

    class Server(uvicorn.Server):
        """Stop owned execution before Uvicorn waits for long-lived SSE clients."""
        stopping: asyncio.Task | None = None
        parent_input: asyncio.Task | None = None

        async def startup(self, sockets: list[socket.socket] | None = None) -> None:
            await super().startup(sockets)
            if os.environ.get("CUA_MANAGED_LAUNCH") == "1" and self.started:
                # Start only after binding: failed startup must not wait on stdin.
                self.parent_input = asyncio.create_task(self.watch_parent())

        async def watch_parent(self) -> None:
            # The launcher closes this private pipe to stop us, including on Windows
            # where sending SIGTERM would forcibly terminate Python without cleanup.
            await asyncio.to_thread(sys.stdin.buffer.read, 1)
            self.handle_exit(0, None)

        async def serve(self, sockets: list[socket.socket] | None = None) -> None:
            try:
                await super().serve(sockets)
            finally:
                if self.parent_input is not None:
                    self.parent_input.cancel()
                    await asyncio.gather(self.parent_input, return_exceptions=True)

        def handle_exit(self, sig: int, frame: object) -> None:
            if self.stopping is not None:
                return
            async def stop() -> None:
                try:
                    await app.state.manager.shutdown()
                except Exception:
                    logger.exception("Runner shutdown failed")
                finally:
                    app.state.shutdown.set()
                    self.should_exit = True
            self.stopping = asyncio.create_task(stop())

    server = Server(uvicorn.Config(app, host=settings.host, port=settings.port, log_level="info",
                                   timeout_graceful_shutdown=5))
    server.run()


if __name__ == "__main__":
    main()
