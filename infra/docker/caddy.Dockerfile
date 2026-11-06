# Caddy 2.11.7 rebuilt with Go 1.26.10 and golang.org/x/net v0.62.0: the official image ships Go 1.26.8
# and x/net v0.59.0 with fixed HTTP/2 vulnerabilities (GO-2026-66xx; M1-3, 2026-10-11). Go 1.26.10 fixes
# GO-2026-6809 (crypto/x509 distrust of compromised intermediates, published 2026-10-21). Golang manifest
# pushed 2026-10-20T04:26:03Z and x/net v0.60.0 published 2026-10-08T17:22:58Z, both outside the 72-hour
# window when adopted. x/net v0.62.0 (published 2026-10-27T19:00:16Z; GO-2026-6860 and GO-2026-6866 in x/net/html)
# raises x/crypto v0.58.0, x/sys v0.49.0, x/term v0.47.0 and x/text v0.43.0, all published 2026-10-06..09.
# chi v5.4.0 (published 2026-10-12T11:22:20Z) fixes GHSA-j6qf-3m9c-vwj3 (moderate) and only raises its go
# directive to 1.24. go-jose v4.1.6 (published 2026-10-14T22:46:21Z) fixes GHSA-mgcc-cww5-fp2q (high, JWK parsing DoS)
# and has no module requirements; v3 (via a Caddy dependency) has no fixed release and stays in the report.
# x/crypto is pinned to commit 2f1f834330b2 (v0.58.0 plus only "openpgp: carve out openpgp as a module",
# published 2026-10-09T18:17:18Z): OSV marks it as the fix for GO-2026-5932 (deprecated x/crypto/openpgp, no
# CVSS score). No tagged release contains it yet; Caddy does not import openpgp, which the build asserts.
# klauspost/compress v1.20.2 (published 2026-10-12T09:34:06Z) fixes GO-2026-6865 (panic on two-block frames,
# no CVSS score; published 2026-11-05); Caddy 2.11.7 requires v1.20.1.
FROM golang:1.26.10-alpine@sha256:9ce231b28998b32e116927c61aa5c406183061d4f3f2d61b292c88e7f6bdf7ca AS builder
ENV CGO_ENABLED=0 GOTOOLCHAIN=local GOFLAGS=-mod=mod
WORKDIR /src
# Same entry point as the official build (cmd + standard modules); go.sum is verified by the Go checksum database.
RUN printf '%s\n' 'package main' '' 'import (' \
      '	caddycmd "github.com/caddyserver/caddy/v2/cmd"' \
      '	_ "github.com/caddyserver/caddy/v2/modules/standard"' ')' '' \
      'func main() { caddycmd.Main() }' > main.go \
    && go mod init oliginvest.invalid/caddy \
    && go get github.com/caddyserver/caddy/v2@v2.11.7 golang.org/x/net@v0.62.0 golang.org/x/crypto@v0.58.1-0.20261009181718-2f1f834330b2 github.com/go-chi/chi/v5@v5.4.0 github.com/go-jose/go-jose/v4@v4.1.6 github.com/klauspost/compress@v1.20.2 \
    && go mod tidy \
    && go list -m golang.org/x/net golang.org/x/crypto golang.org/x/sys golang.org/x/term golang.org/x/text github.com/go-chi/chi/v5 github.com/go-jose/go-jose/v4 github.com/klauspost/compress \
    && ! go list -deps . | grep -F golang.org/x/crypto/openpgp \
    && go build -trimpath -ldflags="-s -w" -o /go/bin/caddy . \
    && go version -m /go/bin/caddy

FROM caddy:2.11.7@sha256:f2a1290d0463aad60660d4ec134943f183ee2a5f6c3eb7bf32dd984f2f020772
COPY --from=builder /go/bin/caddy /usr/bin/caddy
# Alpine v3.23 fixes not yet in the pinned base: brotli-libs 1.2.1-r0 (CVE-2026-111497, critical; built
# 2026-10-22T02:32:51Z) and zlib 1.3.2-r1 (CVE-2026-85091, high; built 2026-10-06T20:35:04Z).
# curl is unused (the healthcheck uses busybox wget; Caddy is a static Go binary). Removed because Alpine
# curl 8.23.0-r0 with fixes for findings of unknown severity was built 2026-10-25 (inside the 72-hour window).
RUN apk add --no-cache brotli-libs=1.2.1-r0 zlib=1.3.2-r1 \
    && apk del --no-cache curl \
    && ! apk info -e curl libcurl \
    && mkdir -p /var/log/caddy && chown -R 10005:10005 /data /config /var/log/caddy
USER 10005:10005
