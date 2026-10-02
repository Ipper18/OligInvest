"""Render only synthetic values and check real host-service parsers; no services applied."""
import ipaddress
import json
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
HOST = ROOT / "infra/host"
LOOPBACK = str(ipaddress.IPv4Address(2130706433))


def render(name):
    values = {
        "PUBLIC_HOST": "app.example.test", "IMMICH_HOST": "photos.example.test",
        "IMMICH_UPSTREAM_ADDRESS": LOOPBACK, "IMMICH_UPSTREAM_PORT": "8443",
        "WAN_IF": "wan-test", "SITE_IF": "wg-test", "VM_INGRESS_IF": "vm-test",
        "ADMIN_USER": "synthetic-admin", "NTS_HOST_1": "nts1.example.test",
        "NTS_HOST_2": "nts2.example.test",
    }
    def replace(match):
        key = match[1]
        if key in values:
            return values[key]
        if key.endswith("_IP"):
            return LOOPBACK
        if key.endswith("_CIDR"):
            return LOOPBACK + "/32"
        if key.endswith("_PORT"):
            return "51820"
        raise ValueError("Unmapped placeholder: " + key)
    return re.sub(r"<([A-Z0-9_]+)>", replace, (HOST / name).read_text())


class HostConfigTests(unittest.TestCase):
    def checked(self, command):
        result = subprocess.run(command, capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_nginx_parses_stream_and_http_together(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / "nginx.conf"
            config.write_text("load_module /usr/lib/nginx/modules/ngx_stream_module.so;\n"
                              f"pid {directory}/nginx.pid;\nerror_log stderr;\nevents {{}}\n"
                              "stream {\n" + render("nginx-stream.conf.template") + "\n}\n"
                              "http {\n" + render("nginx-http.conf.template") + "\n}\n")
            self.checked(["nginx", "-t", "-c", str(config)])

    def test_nftables_parses_both_hosts_without_applying(self):
        for name in ("vps.nft.template", "vm.nft.template"):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                config = Path(directory) / "rules.nft"
                config.write_text(render(name))
                self.checked(["nft", "--check", "--file", str(config)])

    def test_chrony_requires_authenticated_sources(self):
        # Ubuntu's AppArmor profile permits /etc/chrony, not arbitrary /tmp files.
        # Keep the profile active; only a synthetic temporary config is created.
        with tempfile.TemporaryDirectory(dir="/etc/chrony") as directory:
            Path(directory).chmod(0o755)
            config = Path(directory) / "chrony.conf"
            config.write_text(render("chrony.conf.template"))
            self.checked(["chronyd", "-p", "-f", str(config)])

    def test_templates_contain_no_instance_addresses(self):
        for path in HOST.glob("*.template"):
            self.assertNotRegex(path.read_text(), r"\b(?:\d{1,3}\.){3}\d{1,3}\b", path.name)
        daemon = json.loads((HOST / "daemon.json").read_text())
        self.assertTrue(daemon["no-new-privileges"])
        self.assertFalse(daemon["userland-proxy"])

    def test_caddy_defends_request_identity_and_idle_connections(self):
        caddy = (ROOT / "infra/caddy/Caddyfile").read_text()
        self.assertEqual(caddy.count("header_up X-Request-Id {http.request.uuid}"), 2)
        self.assertIn("log_append request_id {http.request.uuid}", caddy)
        timeouts = re.findall(r"keepalive (\d+)s", caddy)
        self.assertEqual(len(timeouts), 2)
        self.assertTrue(all(0 < int(value) < 5 for value in timeouts))
        self.assertIn("fallback_policy reject", caddy)
        self.assertLess(caddy.index("proxy_protocol {"), caddy.index("\n   tls"))


if __name__ == "__main__":
    unittest.main()
