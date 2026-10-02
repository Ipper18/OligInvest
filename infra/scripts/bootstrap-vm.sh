#!/bin/sh
# Owner-run on a dedicated Debian 13 VM. Never invoked by CI or deploy.sh.
set -eu
[ "${1:-}" = '--apply' ] || { echo 'Usage: bootstrap-vm.sh --apply' >&2; exit 2; }
[ "$(id -u)" = 0 ] || { echo 'Run as root on the dedicated VM' >&2; exit 2; }
. /etc/os-release
[ "$ID:$VERSION_ID" = 'debian:13' ] || { echo 'Debian 13 required' >&2; exit 2; }
[ "$(dpkg --print-architecture)" = amd64 ] || { echo 'amd64 required' >&2; exit 2; }
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends ca-certificates curl gnupg python3 openssl nftables chrony systemd-resolved unattended-upgrades qemu-guest-agent apparmor util-linux
install -d -m 0755 /etc/apt/keyrings
temporary=$(mktemp -d)
trap 'rm -rf -- "$temporary"' EXIT HUP INT TERM
curl --fail --silent --show-error --proto '=https' --tlsv1.2 https://download.docker.com/linux/debian/gpg -o "$temporary/docker.asc"
fingerprint=$(gpg --show-keys --with-colons "$temporary/docker.asc" | awk -F: '$1 == "fpr" {print $10; exit}')
[ "$fingerprint" = '9DC858229FC7DD38854AE2D88D81803C0EBFCD88' ] || { echo 'Docker signing key mismatch' >&2; exit 1; }
install -m 0644 "$temporary/docker.asc" /etc/apt/keyrings/docker.asc
printf '%s\n' 'deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian trixie stable' > /etc/apt/sources.list.d/docker.list
apt-get update -qq
apt-get install -y --no-install-recommends docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
install -d -m 0755 /opt/oliginvest /etc/docker
install -d -m 0700 /etc/oliginvest /etc/oliginvest/secrets /etc/oliginvest/runtime-secrets
cat > "$temporary/daemon.json" <<'JSON'
{"no-new-privileges":true,"live-restore":true,"userland-proxy":false,"icc":false,"log-driver":"local","log-opts":{"max-size":"20m","max-file":"5"}}
JSON
if [ -e /etc/docker/daemon.json ] && ! cmp -s /etc/docker/daemon.json "$temporary/daemon.json"; then
  echo 'Existing Docker configuration differs; reconcile manually before continuing' >&2
  exit 1
fi
install -m 0644 "$temporary/daemon.json" /etc/docker/daemon.json
systemctl enable docker unattended-upgrades qemu-guest-agent chrony
echo 'Bootstrap prepared. Follow the owner checklist for firewall, NTS, DNS-over-TLS, reserved UIDs and verified cosign installation before deployment.'
