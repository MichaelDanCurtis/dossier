#!/usr/bin/env python3
"""Root service exposing only bounded account operations on a private Unix socket."""
import http.server
import json
import os
from pathlib import Path
import re
import secrets
import socketserver
import subprocess
import sys

import manage

ROOT = Path(__file__).resolve().parent
SOCKET = Path(os.environ.get("DOSSIER_CONTROL_SOCKET", ROOT / "control/control.sock"))


def run(*args, password=None, timeout=150):
    return subprocess.run(list(args), input=password, capture_output=True, text=True, check=True, timeout=timeout)


def provision(username):
    compose = ["docker", "compose", "-f", str(ROOT / "docker-compose.yml")]
    run(*compose, "up", "-d", "--wait", "--wait-timeout", "120", f"db-{username}", f"app-{username}")
    # Attach the already-running gateway; no restart of existing users is needed.
    network = f"{manage.load_registry().get('projectName', 'dossier')}_account-{username}"
    gateway = run(*compose, "ps", "-q", "gateway").stdout.strip()
    if not gateway:
        raise ValueError("Account gateway is not running")
    info = json.loads(run("docker", "inspect", gateway).stdout)[0]
    if network not in info["NetworkSettings"]["Networks"]:
        run("docker", "network", "connect", network, gateway)


def operate(payload, config):
    actor = next((user for user in config["users"] if user["id"] == payload.get("actor") and user["active"]), None)
    if not actor or actor.get("role") != "admin" or actor["revision"] != payload.get("revision"):
        raise PermissionError("Administrator access required")
    operation = payload.get("operation")
    if operation == "health":
        run("docker", "info", "--format", "{{.ServerVersion}}")
        run("docker", "compose", "-f", str(ROOT / "docker-compose.yml"), "config", "--services")
        return {"username": actor["username"], "message": "Account service ready"}
    username = payload.get("username", "")
    if not isinstance(username, str) or not re.fullmatch(r"[a-z][a-z0-9_-]{2,31}", username):
        raise ValueError("Use a valid username")
    if operation not in {"add", "reset-password", "disable", "enable", "retry"}:
        raise ValueError("Unsupported operation")
    if operation == "disable" and username == actor["username"]:
        raise ValueError("You cannot disable your own administrator account")
    if operation == "enable" and manage.selected_user(config, username).get("status", "ready") != "ready":
        raise ValueError("Use Retry setup before enabling this account")
    if operation in {"add", "reset-password"}:
        password = payload.get("password") or secrets.token_urlsafe(24)
        if not isinstance(password, str) or not 12 <= len(password) <= 256 or "\n" in password or "\r" in password:
            raise ValueError("Use a password of 12–256 characters without line breaks")
        run(sys.executable, str(ROOT / "manage.py"), operation, username, "--password-stdin", password=password)
        if operation == "add":
            try:
                with manage.locked():
                    fresh = manage.load_registry()
                    user = manage.selected_user(fresh, username)
                    user["active"] = False
                    user["status"] = "provisioning"
                    manage.save_registry(fresh)
                provision(username)
                with manage.locked():
                    fresh = manage.load_registry()
                    user = manage.selected_user(fresh, username)
                    user["active"] = True
                    user["status"] = "ready"
                    manage.save_registry(fresh)
            except Exception:
                with manage.locked():
                    fresh = manage.load_registry()
                    user = manage.selected_user(fresh, username)
                    user["active"] = False
                    user["status"] = "setup-failed"
                    manage.save_registry(fresh)
                raise ValueError("Account setup failed; use Retry setup, then reset its password if needed") from None
        return {"username": username, "password": password, "message": "Account created" if operation == "add" else "Password reset; existing sessions revoked"}
    if operation == "retry":
        user = manage.selected_user(config, username)
        if user.get("status") not in {"provisioning", "setup-failed"}:
            raise ValueError("This account does not need setup")
        provision(username)
        with manage.locked():
            fresh = manage.load_registry()
            user = manage.selected_user(fresh, username)
            user["active"] = True
            user["status"] = "ready"
            manage.save_registry(fresh)
        return {"username": username, "message": "Account setup completed"}
    run(sys.executable, str(ROOT / "manage.py"), operation, username)
    return {"username": username, "message": "Account updated; previous sessions revoked"}


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_POST(self):
        try:
            config = manage.load_registry()
            expected = "Bearer " + config["controlToken"]
            if not secrets.compare_digest(self.headers.get("Authorization", ""), expected):
                raise PermissionError("Access refused")
            size = int(self.headers.get("Content-Length", "0"))
            if self.path != "/accounts" or not 1 <= size <= 8192:
                raise ValueError("Invalid request")
            result = operate(json.loads(self.rfile.read(size)), config)
            self.respond(200, result)
        except PermissionError:
            self.respond(403, {"error": "Administrator access required"})
        except (ValueError, KeyError, StopIteration) as error:
            self.respond(400, {"error": str(error) if isinstance(error, ValueError) else "Invalid request"})
        except Exception:
            # Never log passwords, command output, environment files or secrets.
            self.respond(503, {"error": "The account operation failed; the existing accounts are unchanged"})

    def respond(self, status, value):
        data = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


class Server(socketserver.UnixStreamServer):
    # Provision one account at a time, bounded by the maximum account count.
    allow_reuse_address = True


if __name__ == "__main__":
    SOCKET.parent.mkdir(exist_ok=True)
    os.chmod(SOCKET.parent, 0o750)
    if os.geteuid() == 0:
        os.chown(SOCKET.parent, 0, manage.GATEWAY_UID)
    if SOCKET.exists():
        SOCKET.unlink()
    with Server(str(SOCKET), Handler) as server:
        os.chmod(SOCKET, 0o660)
        if os.geteuid() == 0:
            os.chown(SOCKET, 0, manage.GATEWAY_UID)
        server.serve_forever()
