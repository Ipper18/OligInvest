# Caddy 2.11.7 rebuilt with Go 1.26.9: the official image still ships Go 1.26.8 with fixed stdlib
# vulnerabilities (M1-3, 2026-10-11). Golang manifest pushed 2026-10-08T18:04:50Z, outside the 72-hour window.
FROM golang:1.26.9-alpine@sha256:397ecc648150dd585f1734dfcd8d1bb4746664e54464191d77ad0ecffaf38bdb AS builder
ENV CGO_ENABLED=0 GOTOOLCHAIN=local
# Build the exact upstream module with its dependency versions and Go checksum database.
RUN go install -trimpath -ldflags="-s -w" github.com/caddyserver/caddy/v2/cmd/caddy@v2.11.7 \
    && go version -m /go/bin/caddy

FROM caddy:2.11.7@sha256:f2a1290d0463aad60660d4ec134943f183ee2a5f6c3eb7bf32dd984f2f020772
COPY --from=builder /go/bin/caddy /usr/bin/caddy
RUN mkdir -p /var/log/caddy && chown -R 10005:10005 /data /config /var/log/caddy
USER 10005:10005
