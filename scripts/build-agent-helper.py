#!/usr/bin/env python3
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def main():
    if sys.platform != "darwin":
        raise SystemExit("The Ardia Fork agent helper requires macOS")
    destination = Path(__file__).resolve().parent.parent / "output/agent-tools/Ardia Fork MCP"
    if destination.exists():
        subprocess.run([str(destination), "-c", "import sys; assert sys.version_info[:2] == " + repr(sys.version_info[:2])], check=True)
        return destination
    config = shutil.which("python3-config")
    if not config:
        raise SystemExit("Missing python3-config; use a Python installation with development files")
    flags = shlex.split(subprocess.check_output([config, "--embed", "--cflags", "--ldflags"], text=True))
    clang = subprocess.check_output(["xcrun", "--find", "clang"], text=True).strip()
    sdk = subprocess.check_output(["xcrun", "--sdk", "macosx", "--show-sdk-path"], text=True).strip()
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="ardia-agent-helper-") as directory:
        source = Path(directory) / "main.c"
        source.write_text("#include <Python.h>\nint main(int argc, char **argv) { return Py_BytesMain(argc, argv); }\n")
        binary = Path(directory) / destination.name
        subprocess.run([clang, "-isysroot", sdk, str(source), *flags, "-o", str(binary)], check=True)
        subprocess.run([str(binary), "-c", "import json, sys; assert sys.version_info[:2] == " + repr(sys.version_info[:2])], check=True)
        try:
            with destination.open("xb") as output:
                output.write(binary.read_bytes())
            destination.chmod(0o755)
        except FileExistsError:
            subprocess.run([str(destination), "-c", "import json"], check=True)
    return destination


if __name__ == "__main__":
    print(main())
