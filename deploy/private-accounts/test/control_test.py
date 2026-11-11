import copy
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import control
import manage


class AccountControlTests(unittest.TestCase):
    def setUp(self):
        self.config = {"users": [{"id": "owner", "username": "admin", "role": "admin", "active": True, "revision": "v1"}, {"id": "other", "username": "alice", "role": "user", "active": True, "revision": "v1", "status": "ready"}]}
        self.payload = {"actor": "owner", "revision": "v1", "operation": "reset-password", "username": "alice"}

    def test_regular_or_revoked_accounts_cannot_provision(self):
        for update in [{"actor": "other"}, {"revision": "old"}, {"actor": "missing"}]:
            with self.assertRaises(PermissionError):
                control.operate({**self.payload, **update}, self.config)

    def test_arbitrary_commands_paths_and_self_disabling_are_refused(self):
        for update in [{"operation": "exec"}, {"username": "../root"}, {"username": "--privileged"}, {"operation": "disable", "username": "admin"}]:
            with self.assertRaises(ValueError):
                control.operate({**self.payload, **update}, self.config)

    def test_reset_uses_stdin_without_putting_password_in_process_arguments(self):
        with patch.object(control, "run") as run:
            result = control.operate({**self.payload, "password": "private-reset-password"}, self.config)
        self.assertEqual(result["password"], "private-reset-password")
        self.assertNotIn("private-reset-password", run.call_args.args)
        self.assertEqual(run.call_args.kwargs["password"], "private-reset-password")
        self.assertIn("--password-stdin", run.call_args.args)

    def test_failed_setup_requires_retry(self):
        self.config["users"][1]["status"] = "setup-failed"
        with self.assertRaisesRegex(ValueError, "Retry setup"):
            control.operate({**self.payload, "operation": "enable"}, self.config)

    def test_old_admin_role_cannot_come_from_the_request(self):
        self.config["users"][0]["role"] = "user"
        with self.assertRaises(PermissionError):
            control.operate({**self.payload, "role": "admin"}, self.config)


class DomainRoutingTests(unittest.TestCase):
    def setUp(self):
        self.config = {"origin": "https://career.example.com", "proxyNetwork": "proxy", "users": []}

    def test_browser_patch_does_not_change_the_application_image(self):
        self.config.update(linkedinBridge=True, appImage="app:reviewed", bridgeImage="browser:patched", users=[{"username": "alice", "appSecret": "fixture-secret"}])
        services = manage.compose_config(self.config)["services"]
        self.assertEqual(services["app-alice"]["image"], "app:reviewed")
        self.assertEqual(services["bridge-alice"]["image"], "browser:patched")
        self.assertNotIn("ports", services["bridge-alice"])
        self.assertEqual(services["bridge-alice"]["volumes"], ["browser-alice:/data"])

    def test_existing_installs_have_no_alias_routes(self):
        labels = manage.compose_config(self.config)["services"]["gateway"]["labels"]
        self.assertFalse(any("legacy" in key for key in labels))
        self.assertEqual(labels["traefik.http.routers.dossier-accounts.rule"], "Host(`career.example.com`)")

    def test_browser_redirects_and_bearer_routes_survive_account_changes(self):
        self.config["legacyOrigins"] = ["https://old.example.com"]
        initial = manage.compose_config(self.config)
        self.config["users"] = [{"username": "alice"}]
        updated = manage.compose_config(self.config)
        labels = updated["services"]["gateway"]["labels"]
        self.assertEqual(labels, initial["services"]["gateway"]["labels"])
        self.assertEqual(labels["traefik.http.middlewares.dossier-legacy-0-redirect.redirectregex.replacement"], "https://career.example.com/$${1}")
        self.assertIn("Path(`/api/mcp`)", labels["traefik.http.routers.dossier-legacy-0-mcp.rule"])
        self.assertGreater(int(labels["traefik.http.routers.dossier-legacy-0-mcp.priority"]), int(labels["traefik.http.routers.dossier-legacy-0-web.priority"]))
        self.assertEqual(labels["traefik.http.middlewares.dossier-legacy-0-forward.headers.customrequestheaders.Host"], "career.example.com")
        self.assertNotIn("ports", updated["services"]["app-alice"])
        self.assertEqual(updated["services"]["app-alice"]["networks"], ["account-alice"])

    def test_aliases_cannot_inject_routes_or_redirect_back_to_themselves(self):
        for value in [["http://old.example.com"], ["https://old.example.com/path"], [self.config["origin"]], ["https://a.example.com"] * 2, "https://old.example.com", [None]]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                manage.compose_config({**self.config, "legacyOrigins": value})


if __name__ == "__main__":
    unittest.main()
