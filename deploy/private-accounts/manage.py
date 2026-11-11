#!/usr/bin/env python3
"""Host-only account provisioning. No Docker socket is exposed to the web service."""
import argparse
import base64
import contextlib
import fcntl
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import tempfile
import uuid

ROOT = Path(__file__).resolve().parent
APP_IMAGE = "ghcr.io/aientech/dossier@sha256:8de7979d8d73a1463b7e106fb4e0dc88dda7feb030de4fc306ff8c7c735b7b70"
GATEWAY_IMAGE = "dossier-private-accounts:2.0.0"
MAX_ACCOUNTS = 5
GATEWAY_UID = 65532


def b64(value):
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def password_hash(password):
    salt = b64(secrets.token_bytes(16))
    key = hashlib.scrypt(password.encode(), salt=salt.encode(), n=32768, r=8, p=1, dklen=32, maxmem=64 * 1024 * 1024)
    return f"scrypt:{salt}:{b64(key)}"


def write_private(path, content, gateway=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as handle:
        temp = Path(handle.name)
        os.chmod(temp, 0o600)
        handle.write(content)
        handle.flush()
        os.fsync(handle.fileno())
    if gateway and os.geteuid() == 0:
        os.chown(temp, GATEWAY_UID, GATEWAY_UID)
    os.replace(temp, path)


def save_registry(config):
    state = ROOT / "state"
    state.mkdir(exist_ok=True)
    os.chmod(state, 0o750)
    if os.geteuid() == 0:
        os.chown(state, 0, GATEWAY_UID)
    write_private(state / "registry.json", json.dumps(config, indent=2) + "\n", gateway=True)


def load_registry():
    return json.loads((ROOT / "state/registry.json").read_text())


def compose_config(config):
    """One independent database, volume, and network per account."""
    services = {}
    volumes = {"gateway-tokens": {}}
    networks = {"proxy": {"external": True, "name": config["proxyNetwork"]}}
    host = config["origin"].removeprefix("https://")
    gateway = {
        "image": GATEWAY_IMAGE,
        "user": f"{GATEWAY_UID}:{GATEWAY_UID}",
        "restart": "unless-stopped",
        "environment": {"PUBLIC_ORIGIN": config["origin"], "REGISTRY_PATH": "/state/registry.json", "TOKEN_DB_PATH": "/tokens/access.db", "CONTROL_SOCKET": "/control/control.sock"},
        "volumes": ["./state:/state:ro", "./control:/control:ro", "gateway-tokens:/tokens"],
        "networks": ["proxy"],
        "read_only": True,
        "tmpfs": ["/tmp:size=16m,mode=1777"],
        "cap_drop": ["ALL"],
        "security_opt": ["no-new-privileges:true"],
        "mem_limit": "256m",
        "cpus": 0.5,
        "labels": {
            "traefik.enable": "true",
            "traefik.docker.network": config["proxyNetwork"],
            "traefik.http.routers.dossier-accounts.rule": f"Host(`{host}`)",
            "traefik.http.routers.dossier-accounts.entrypoints": "websecure",
            "traefik.http.routers.dossier-accounts.tls": "true",
            "traefik.http.routers.dossier-accounts.tls.certresolver": "mytlschallenge",
            "traefik.http.services.dossier-accounts.loadbalancer.server.port": "8080",
        },
        "healthcheck": {
            "test": ["CMD", "node", "-e", f"require('node:http').get({{host:'127.0.0.1',port:8080,path:'/_accounts/health',headers:{{host:'{host}'}}}},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"],
            "interval": "30s", "timeout": "5s", "start_period": "15s", "retries": 3,
        },
    }
    # Keep bookmarked pages and existing bearer-token clients working after a
    # domain move, including when account management regenerates this file.
    legacy_origins = config.get("legacyOrigins", [])
    if not isinstance(legacy_origins, list) or len(legacy_origins) > 5:
        raise ValueError("At most five previous HTTPS origins are supported")
    for index, previous in enumerate(legacy_origins):
        if not isinstance(previous, str) or not re.fullmatch(r"https://[a-z0-9.-]+", previous) or previous == config["origin"] or previous in legacy_origins[:index]:
            raise ValueError("Previous origins must be distinct HTTPS domain names")
        previous_host = previous.removeprefix("https://")
        name = f"dossier-legacy-{index}"
        labels = gateway["labels"]
        for suffix in ("web", "mcp"):
            router = f"traefik.http.routers.{name}-{suffix}"
            labels.update({
                f"{router}.rule": f"Host(`{previous_host}`)",
                f"{router}.entrypoints": "websecure",
                f"{router}.tls": "true",
                f"{router}.tls.certresolver": "mytlschallenge",
                f"{router}.service": "dossier-accounts",
                f"{router}.priority": "200" if suffix == "mcp" else "100",
                f"{router}.middlewares": f"{name}-forward" if suffix == "mcp" else f"{name}-redirect",
            })
        labels[f"traefik.http.routers.{name}-mcp.rule"] += " && (Path(`/api/mcp`) || PathPrefix(`/api/mcp/`))"
        labels.update({
            f"traefik.http.middlewares.{name}-redirect.redirectregex.regex": f"^https://{re.escape(previous_host)}/(.*)$",
            # Compose reduces $$ to $, preserving Traefik's capture reference.
            f"traefik.http.middlewares.{name}-redirect.redirectregex.replacement": f"{config['origin']}/$${{1}}",
            f"traefik.http.middlewares.{name}-redirect.redirectregex.permanent": "false",
            f"traefik.http.middlewares.{name}-forward.headers.customrequestheaders.Host": host,
            f"traefik.http.middlewares.{name}-forward.headers.customrequestheaders.X-Forwarded-Host": host,
        })
    services["gateway"] = gateway
    # Disabled accounts retain their backend/data for recovery; gateway refuses them.
    for user in config["users"]:
        username = user["username"]
        app, database, network = f"app-{username}", f"db-{username}", f"account-{username}"
        networks[network] = {}
        gateway["networks"].append(network)
        services[database] = {
            "image": "postgres:18-alpine",
            "restart": "unless-stopped",
            "env_file": [f"./secrets/{username}-db.env"],
            "command": ["postgres", "-c", "shared_buffers=64MB", "-c", "max_connections=30"],
            "volumes": [f"pgdata-{username}:/var/lib/postgresql"],
            "networks": [network],
            "mem_limit": "256m", "cpus": 0.5,
            "labels": {"traefik.enable": "false"},
            "healthcheck": {"test": ["CMD-SHELL", "pg_isready -U dossier -d dossier"], "interval": "5s", "timeout": "5s", "retries": 20},
        }
        services[app] = {
            "image": config.get("appImage", APP_IMAGE),
            "restart": "unless-stopped",
            "env_file": [f"./secrets/{username}-app.env"],
            "depends_on": {database: {"condition": "service_healthy"}},
            "volumes": [f"data-{username}:/data"],
            "networks": [network],
            "mem_limit": "1g", "cpus": 1.5,
            "cap_drop": ["ALL"], "security_opt": ["no-new-privileges:true"],
            "labels": {"traefik.enable": "false"},
        }
        # Browser state has its own private volume and no published/CDP ports.
        if config.get("linkedinBridge", False):
            token = hashlib.sha256(("linkedin-bridge:" + user["appSecret"]).encode()).hexdigest()
            bridge = f"bridge-{username}"
            services[app]["environment"] = {"LINKEDIN_BRIDGE_URL": f"http://{bridge}:8090", "LINKEDIN_BRIDGE_TOKEN": token}
            services[bridge] = {
                "image": config.get("appImage", APP_IMAGE), "command": ["node", "deploy/linkedin-bridge/server.mjs"],
                "restart": "unless-stopped", "init": True,
                "environment": {"BRIDGE_TOKEN": token, "BRIDGE_DATA_DIR": "/data/linkedin"},
                "volumes": [f"browser-{username}:/data"], "networks": [network],
                "mem_limit": "768m", "cpus": 1, "shm_size": "256m",
                "cap_drop": ["ALL"], "security_opt": ["no-new-privileges:true"],
                "labels": {"traefik.enable": "false"},
                "healthcheck": {"test": ["CMD", "node", "-e", "fetch('http://127.0.0.1:8090/status',{headers:{authorization:'Bearer '+process.env.BRIDGE_TOKEN}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"], "interval": "30s", "timeout": "5s", "start_period": "15s", "retries": 3},
            }
            volumes[f"browser-{username}"] = {}
        volumes[f"pgdata-{username}"] = {}
        volumes[f"data-{username}"] = {}
    return {"name": config.get("projectName", "dossier"), "services": services, "networks": networks, "volumes": volumes}


def save_compose(config):
    # JSON is a valid YAML document and avoids hand-escaped secrets/interpolation.
    write_private(ROOT / "docker-compose.yml", json.dumps(compose_config(config), indent=2) + "\n")


@contextlib.contextmanager
def locked():
    with (ROOT / ".provision.lock").open("a") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        yield


def selected_user(config, username):
    for user in config["users"]:
        if user["username"] == username:
            return user
    raise ValueError("No account with that username")


def read_password(args):
    if args.password_stdin:
        password = sys.stdin.read().rstrip("\r\n")
    elif args.generate:
        if not args.credentials_file:
            raise ValueError("Generated passwords require --credentials-file; they are never printed")
        password = secrets.token_urlsafe(24)
    else:
        password = getpass.getpass("New password (at least 12 characters): ")
        if password != getpass.getpass("Repeat password: "):
            raise ValueError("Passwords do not match")
    if not 12 <= len(password) <= 256:
        raise ValueError("Use a password between 12 and 256 characters")
    if args.credentials_file and Path(args.credentials_file).exists():
        raise ValueError("Credentials file already exists; choose a new path")
    return password


def credentials(args, password, config):
    if args.credentials_file:
        write_private(Path(args.credentials_file).resolve(), f"Dossier private account\nAddress: {config['origin']}\nUsername: {args.username}\nPassword: {password}\n\nKeep this file private. Accounts are managed by the server administrator.\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    initialize = commands.add_parser("init")
    initialize.add_argument("--origin", required=True)
    initialize.add_argument("--proxy-network", default="root_default")
    for command in ("add", "reset-password"):
        sub = commands.add_parser(command)
        sub.add_argument("username")
        sub.add_argument("--generate", action="store_true")
        sub.add_argument("--password-stdin", action="store_true", help="Read a password from stdin (host control service)")
        sub.add_argument("--credentials-file")
    for command in ("disable", "enable"):
        commands.add_parser(command).add_argument("username")
    commands.add_parser("list")
    commands.add_parser("render")
    commands.add_parser("upgrade")
    args = parser.parse_args()
    with locked():
        if args.command == "init":
            if (ROOT / "state/registry.json").exists():
                raise ValueError("Already initialized")
            if not re.fullmatch(r"https://[a-z0-9.-]+(?::\d+)?", args.origin):
                raise ValueError("Origin must be an HTTPS address with no trailing slash or path")
            config = {"version": 1, "origin": args.origin, "proxyNetwork": args.proxy_network, "sessionSecret": secrets.token_urlsafe(48), "users": []}
            save_registry(config)
            save_compose(config)
            print("Account service initialized")
            return
        config = load_registry()
        if args.command == "list":
            for user in config["users"]:
                print(f"{user['username']}: {'enabled' if user['active'] else 'disabled'}")
            return
        if args.command == "upgrade":
            config["version"] = 2
            config.setdefault("controlToken", secrets.token_urlsafe(48))
            for user in config["users"]:
                user.setdefault("role", "admin" if user["username"] == "admin" else "user")
                user.setdefault("status", "ready")
            save_registry(config)
            save_compose(config)
            print("Account service upgraded")
            return
        if args.command == "render":
            save_compose(config)
            print("Compose configuration refreshed")
            return
        if not re.fullmatch(r"[a-z][a-z0-9_-]{2,31}", args.username):
            raise ValueError("Use 3–32 lowercase letters, digits, hyphens or underscores, starting with a letter")
        if args.command == "add":
            if len(config["users"]) >= MAX_ACCOUNTS:
                raise ValueError("This deployment is sized for at most five accounts")
            if any(user["username"] == args.username for user in config["users"]):
                raise ValueError("Account already exists")
            password = read_password(args)
            app_secret = secrets.token_urlsafe(48)
            # A different random password protects the backend; the gateway makes
            # native sessions only after checking the actual account password.
            result = subprocess.run(["docker", "run", "--rm", "-i", config.get("appImage", APP_IMAGE), "hash-password"], input=secrets.token_urlsafe(48) + "\n", text=True, capture_output=True, check=True)
            app_hash = result.stdout.strip()
            if not app_hash.startswith("argon2id:"):
                raise ValueError("Dossier password hashing failed")
            db_password = secrets.token_hex(32)
            env_dir = ROOT / "secrets"
            env_dir.mkdir(exist_ok=True)
            os.chmod(env_dir, 0o700)
            write_private(env_dir / f"{args.username}-db.env", f"POSTGRES_USER=dossier\nPOSTGRES_DB=dossier\nPOSTGRES_PASSWORD={db_password}\n")
            write_private(env_dir / f"{args.username}-app.env", f"DATABASE_URL=postgresql://dossier:{db_password}@db-{args.username}:5432/dossier\nDOSSIER_SECRET={app_secret}\nDOSSIER_PASSWORD={app_hash}\nDOSSIER_PUBLIC_URL={config['origin']}\nTZ=America/Los_Angeles\nDOSSIER_TELEMETRY=off\nDOSSIER_BACKUP_RETENTION_DAYS=14\nDOSSIER_ACCOUNT_GATEWAY=on\nDOSSIER_ACCOUNT_ROLE=user\n")
            config["users"].append({"id": str(uuid.uuid4()), "username": args.username, "role": "user", "status": "ready", "active": True, "revision": str(uuid.uuid4()), "passwordHash": password_hash(password), "appSecret": app_secret, "appPasswordHash": app_hash, "upstream": f"http://app-{args.username}:3000"})
            # Write the private credential handoff before enabling the account.
            credentials(args, password, config)
            save_compose(config)
            save_registry(config)
            print(f"Account {args.username} created. Start its services with: docker compose -f {ROOT}/docker-compose.yml up -d")
            return
        user = selected_user(config, args.username)
        if args.command == "reset-password":
            password = read_password(args)
            credentials(args, password, config)
            user["passwordHash"] = password_hash(password)
        else:
            user["active"] = args.command == "enable"
        user["revision"] = str(uuid.uuid4())
        save_registry(config)
        print(f"Account {args.username} updated; its previous sessions are invalid")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, FileNotFoundError, subprocess.CalledProcessError) as error:
        # A subprocess error's output may contain a hash: never echo it.
        print("Operation failed" if isinstance(error, subprocess.CalledProcessError) else str(error), file=sys.stderr)
        sys.exit(1)
