"""One lifetime lease shared by the JavaScript and Python entry points."""
import socket

from .errors import RunnerCoreError


class BackendLease:
    def __init__(self, *, port: int = 4050):
        self.port = port
        self.socket: socket.socket | None = None

    def acquire(self) -> None:
        if self.socket is not None:
            return
        lease = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            # Deliberately do not set SO_REUSEADDR/SO_REUSEPORT.
            lease.bind(("127.0.0.1", self.port))
            lease.listen(1)
        except OSError as error:
            lease.close()
            raise RunnerCoreError("Another sample backend is already running.", code="backend_already_running",
                                  status_code=409, hint="Stop the running backend before launching another one.") from error
        self.socket = lease

    def close(self) -> None:
        if self.socket is not None:
            self.socket.close()
            self.socket = None
