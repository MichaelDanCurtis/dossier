#!/usr/bin/env python3
"""Package complete application and gateway source without deployment secrets."""
import argparse
from pathlib import Path
import subprocess
import zipfile

EXCLUDED = {".git", "node_modules", ".next", "coverage", "__pycache__", "state", "credentials", "integration", "backups", "control", ".docker-control", "secrets"}


def permitted(path):
    return not any(part in EXCLUDED for part in path.parts) and (not path.name.startswith(".env") or path.name == ".env.example") and path.name not in {"deployment-source.zip", "source.tar.gz", "docker-compose.yml", ".provision.lock"}


def files(root):
    try:
        names = subprocess.check_output(["git", "-C", str(root), "ls-files", "-z", "--cached", "--others", "--exclude-standard"], stderr=subprocess.DEVNULL).decode().split("\0")
        return [Path(name) for name in names if name and permitted(Path(name)) and (root / name).is_file()]
    except subprocess.CalledProcessError:
        return [file.relative_to(root) for file in root.rglob("*") if file.is_file() and permitted(file.relative_to(root))]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app-source", type=Path, required=True)
    parser.add_argument("--gateway-source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    with zipfile.ZipFile(args.output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for label, root in [("app", args.app_source.resolve()), ("gateway", args.gateway_source.resolve())]:
            for relative in files(root):
                archive.write(root / relative, str(Path(label) / relative))
    print("Complete source archive created; no registry, credentials, or runtime environment files included")
