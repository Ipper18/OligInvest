# Caddy 2.11.7 rebuilt with Go 1.26.10 and golang.org/x/net v0.60.0: the official image ships Go 1.26.8
# and x/net v0.59.0 with fixed HTTP/2 vulnerabilities (GO-2026-66xx; M1-3, 2026-10-11). Go 1.26.10 fixes
# GO-2026-6809 (crypto/x509 distrust of compromised intermediates, published 2026-10-21). Golang manifest
# pushed 2026-10-20T04:26:03Z and x/net v0.60.0 published 2026-10-08T17:22:58Z, both outside the 72-hour
# window when adopted. x/net v0.60.0 requires the same x/crypto, x/sys, x/term and x/text versions as Caddy 2.11.7.
FROM golang:1.26.10-alpine@sha256:9ce231b28998b32e116927c61aa5c406183061d4f3f2d61b292c88e7f6bdf7ca AS builder
ENV CGO_ENABLED=0 GOTOOLCHAIN=local GOFLAGS=-mod=mod
WORKDIR /src
# Same entry point as the official build (cmd + standard modules); go.sum is verified by the Go checksum database.
RUN printf '%s\n' 'package main' '' 'import (' \
      '	caddycmd "github.com/caddyserver/caddy/v2/cmd"' \
      '	_ "github.com/caddyserver/caddy/v2/modules/standard"' ')' '' \
      'func main() { caddycmd.Main() }' > main.go \
    && go mod init oliginvest.invalid/caddy \
    && go get github.com/caddyserver/caddy/v2@v2.11.7 golang.org/x/net@v0.60.0 \
    && go mod tidy \
    && go list -m golang.org/x/net golang.org/x/crypto golang.org/x/sys golang.org/x/text \
    && go build -trimpath -ldflags="-s -w" -o /go/bin/caddy . \
    && go version -m /go/bin/caddy

FROM caddy:2.11.7@sha256:f2a1290d0463aad60660d4ec134943f183ee2a5f6c3eb7bf32dd984f2f020772
COPY --from=builder /go/bin/caddy /usr/bin/caddy
RUN mkdir -p /var/log/caddy && chown -R 10005:10005 /data /config /var/log/caddy
USER 10005:10005
