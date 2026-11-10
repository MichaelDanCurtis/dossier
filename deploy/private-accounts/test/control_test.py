import copy
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import control


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


if __name__ == "__main__":
    unittest.main()
