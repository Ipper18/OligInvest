FROM caddy:2.11.4@sha256:0c994536bddb66445885237f1a5dcc1916bccea922661c76b4e9fc24061f9b52
RUN setcap -r /usr/bin/caddy && mkdir -p /var/log/caddy && chown -R 10005:10005 /data /config /var/log/caddy
USER 10005:10005
