import json
import unittest
from ardia_cli.mcp import respond, validate


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

    def test_request_access_uses_only_connection_bound_browser_method(self):
        browser = Browser()
        reply = respond({"method": "tools/call", "params": {"name": "request_access", "arguments": {"name": "Codex"}}}, browser)
        self.assertFalse(reply["result"].get("isError", False))
        self.assertEqual(browser.calls, [("connect", {"name": "Codex"})])


if __name__ == "__main__":
    unittest.main()
