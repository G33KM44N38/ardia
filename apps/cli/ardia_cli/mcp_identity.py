import fcntl
import hashlib
import json
import os
import secrets
import stat
import time
import uuid
from pathlib import Path


def _safe(fd):
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077 or info.st_nlink != 1:
        raise ValueError("Unsafe MCP identity storage")


def identity_for(data_dir, client_id, directory=None):
    directory = Path(directory) if directory is not None else Path.home() / "Library/Application Support/Ardia Fork MCP"
    try:
        directory.mkdir(mode=0o700)
    except FileExistsError:
        pass
    folder = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        info = os.fstat(folder)
        if info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise ValueError("Unsafe MCP identity directory")
        key = hashlib.sha256((str(Path(data_dir).resolve()) + "\0" + client_id).encode()).hexdigest()
        try:
            lock = os.open(key + ".lock", os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=folder)
        except FileExistsError:
            lock = os.open(key + ".lock", os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK, dir_fd=folder)
        try:
            _safe(lock)
            deadline = time.monotonic() + 5
            while True:
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if time.monotonic() >= deadline:
                        raise ValueError("MCP identity storage is busy; retry the connection")
                    time.sleep(0.02)
            name = key + ".json"
            try:
                fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK, dir_fd=folder)
            except FileNotFoundError:
                value = {"version": 1, "identity": str(uuid.uuid4()), "credential": secrets.token_hex(32)}
                temporary = str(uuid.uuid4()) + ".tmp"
                fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=folder)
                try:
                    with os.fdopen(fd, "w") as output:
                        json.dump(value, output)
                        output.flush()
                        os.fsync(output.fileno())
                    os.rename(temporary, name, src_dir_fd=folder, dst_dir_fd=folder)
                    os.fsync(folder)
                finally:
                    try:
                        os.unlink(temporary, dir_fd=folder)
                    except FileNotFoundError:
                        pass
                return {"identity": value["identity"], "credential": value["credential"]}
            with os.fdopen(fd, "r") as source:
                _safe(source.fileno())
                raw = source.read(4097)
            try:
                value = json.loads(raw)
                if len(raw) > 4096 or type(value["version"]) is not int or value["version"] != 1 or str(uuid.UUID(value["identity"])) != value["identity"] or len(value["credential"]) != 64 or any(c not in "0123456789abcdef" for c in value["credential"]):
                    raise ValueError()
                return {"identity": value["identity"], "credential": value["credential"]}
            except (ValueError, TypeError, KeyError, AttributeError) as error:
                raise ValueError("MCP identity storage is unreadable; existing data was left in place") from error
        finally:
            os.close(lock)
    finally:
        os.close(folder)
