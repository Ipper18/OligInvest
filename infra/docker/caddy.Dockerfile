FROM caddy:2.11.4@sha256:0c994536bddb66445885237f1a5dcc1916bccea922661c76b4e9fc24061f9b52 AS upstream
# Official security patch; Docker Hub has not published its image yet.
ADD --checksum=sha256:22c84f8d2d4e4e0e2d422f8049fdd0fc1ed8d5665d0fe166f506c7fd863b4555 https://github.com/caddyserver/caddy/releases/download/v2.11.6/caddy_2.11.6_linux_amd64.tar.gz /tmp/caddy.tar.gz
RUN tar -xzf /tmp/caddy.tar.gz -C /tmp caddy

FROM caddy:2.11.4@sha256:0c994536bddb66445885237f1a5dcc1916bccea922661c76b4e9fc24061f9b52
COPY --from=upstream /tmp/caddy /usr/bin/caddy
RUN mkdir -p /var/log/caddy && chown -R 10005:10005 /data /config /var/log/caddy
USER 10005:10005
