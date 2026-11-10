import io
import json
import unittest
from ardia_cli.mcp import Browser as MCPBrowser, respond, validate


class Browser:
    def __init__(self):
        self.calls = []

    def call(self, method, args):
        self.calls.append((method, args))
        return {"ok": True}


class McpTests(unittest.TestCase):
    def test_initialize_and_tool_discovery_do_not_open_browser(self):
        browser = Browser()
        reply = respond({"method": "initialize", "params": {"protocolVersion": "2025-03-26"}}, browser)
        self.assertEqual(reply["result"]["protocolVersion"], "2025-03-26")
        tools = respond({"method": "tools/list"}, browser)["result"]["tools"]
        self.assertEqual(len(tools), 13)
        self.assertEqual(browser.calls, [])

    def test_client_cannot_supply_authorization_fields(self):
        browser = Browser()
        result = respond({"method": "tools/call", "params": {"name": "snapshot", "arguments": {"tab": "t", "profile": "secret", "connection": 3}}}, browser)
        self.assertTrue(result["result"]["isError"])
        self.assertEqual(browser.calls, [])

    def test_unknown_tools_and_bad_params_do_not_dispatch(self):
        browser = Browser()
        for params in [{"name": "raw_cdp"}, {"name": []}, {"name": "snapshot", "arguments": []}, {"name": "scroll", "arguments": {"tab": "t", "snapshot": "s", "delta": float("nan")}}]:
            result = respond({"method": "tools/call", "params": params}, browser)
            self.assertTrue("error" in result or result["result"].get("isError"))
        self.assertEqual(browser.calls, [])

    def test_large_screenshot_response_keeps_connection_approved(self):
        class Socket:
            def sendall(self, wire):
                pass

        browser = MCPBrowser("/unused")
        browser.sock = Socket()
        payload = "a" * 1500000
        browser.stream = io.BytesIO((json.dumps({"id": 1, "result": {"data": payload}}) + "\n" + json.dumps({"id": 2, "result": [{"id": "default"}]}) + "\n").encode())
        self.assertEqual(len(browser.call("screenshot", {"tab": "t"})["data"]), 1500000)
        self.assertEqual(browser.call("list_profiles", {}), [{"id": "default"}])

    def test_browser_size_refusal_does_not_disconnect_approved_client(self):
        class Socket:
            def sendall(self, wire):
                pass

        browser = MCPBrowser("/unused")
        browser.sock = Socket()
        browser.stream = io.BytesIO((json.dumps({"id": 1, "result": {"error": "Screenshot too large"}}) + "\n" + json.dumps({"id": 2, "result": [{"id": "default"}]}) + "\n").encode())
        with self.assertRaisesRegex(ValueError, "Screenshot too large"):
            browser.call("screenshot", {"tab": "t"})
        self.assertEqual(browser.call("list_profiles", {}), [{"id": "default"}])

    def test_request_access_uses_only_connection_bound_browser_method(self):
        browser = Browser()
        reply = respond({"method": "tools/call", "params": {"name": "request_access", "arguments": {"name": "Codex"}}}, browser)
        self.assertFalse(reply["result"].get("isError", False))
        self.assertEqual(browser.calls, [("connect", {"name": "Codex"})])

class IdentityTests(unittest.TestCase):
    def setUp(self):
        import tempfile
        from pathlib import Path
        self.temporary = tempfile.TemporaryDirectory(prefix="ardia-mcp-identity-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.directory = self.root / "identities"

    def identity(self, browser="browser", client="configured-client"):
        from ardia_cli.mcp_identity import identity_for
        return identity_for(self.root / browser, client, self.directory)

    def test_credentials_persist_for_pair_and_ignore_display_names(self):
        import os
        first = self.identity()
        self.assertEqual(self.identity(), first)
        self.assertEqual(len(first["credential"]), 64)
        self.assertNotEqual(self.identity(client="new-client"), first)
        self.assertNotEqual(self.identity(browser="new-browser"), first)
        self.assertEqual(os.stat(self.directory).st_mode & 0o777, 0o700)
        for file in self.directory.iterdir():
            self.assertEqual(os.stat(file).st_mode & 0o777, 0o600)

    def test_corrupt_public_symlink_and_hardlinked_storage_fails_closed(self):
        import os
        self.identity()
        file = next(self.directory.glob("*.json"))
        file.write_text("broken")
        with self.assertRaisesRegex(ValueError, "unreadable"):
            self.identity()
        self.assertEqual(file.read_text(), "broken")
        file.chmod(0o644)
        with self.assertRaisesRegex(ValueError, "Unsafe"):
            self.identity()
        file.chmod(0o600)
        backup = self.root / "preserved"
        file.rename(backup)
        file.symlink_to(backup)
        with self.assertRaises(OSError):
            self.identity()
        file.unlink()
        os.link(backup, file)
        with self.assertRaisesRegex(ValueError, "Unsafe"):
            self.identity()
        self.assertEqual(backup.read_text(), "broken")

    def test_symlink_or_public_directory_is_refused(self):
        self.directory.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(OSError):
            self.identity()
        self.directory.unlink()
        self.directory.mkdir(mode=0o755)
        with self.assertRaisesRegex(ValueError, "Unsafe"):
            self.identity()

    def test_concurrent_helpers_share_one_atomic_identity(self):
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=8) as pool:
            identities = list(pool.map(lambda _: self.identity(), range(16)))
        self.assertTrue(all(value == identities[0] for value in identities))
        self.assertEqual(len(list(self.directory.glob("*.json"))), 1)
        self.assertEqual(len(list(self.directory.glob("*.tmp"))), 0)

    def test_unconfigured_clients_never_share_a_default_credential(self):
        class Socket:
            def sendall(self, wire):
                self.request = json.loads(wire)
        browser = MCPBrowser(self.root, identity_dir=self.directory)
        browser.sock = Socket()
        browser.stream = io.BytesIO(b'{"id":1,"result":{"approved":false}}\n')
        browser.call("connect", {"name": "Same name"})
        self.assertEqual(browser.sock.request["params"], {"name": "Same name"})
        self.assertFalse(self.directory.exists())

    def test_bearer_only_goes_to_connect_and_never_tool_reply(self):
        from unittest.mock import patch
        class Socket:
            def __init__(self):
                self.requests = []
            def sendall(self, wire):
                self.requests.append(json.loads(wire))
        browser = MCPBrowser(self.root, client_id="configured-client", identity_dir=self.directory)
        browser.sock = Socket()
        browser.stream = io.BytesIO(b'{"id":1,"result":{"approved":false}}\n{"id":2,"result":[]}\n')
        secret = {"identity": "test-identity", "credential": "private-test-proof"}
        with patch("ardia_cli.mcp.identity_for", return_value=secret):
            reply = browser.call("connect", {"name": "Same name"})
            browser.call("list_profiles", {})
        self.assertEqual(browser.sock.requests[0]["params"], {"name": "Same name", **secret})
        self.assertEqual(browser.sock.requests[1]["params"], {})
        self.assertNotIn(secret["credential"], json.dumps(reply))


if __name__ == "__main__":
    unittest.main()
