FROM ghcr.io/astral-sh/uv:0.12.16@sha256:adc68cd785ca65ea25c0611043b0a00b4ea3a22e1b54102fc084406d888082ee AS uv
FROM python:3.13.13-slim-trixie@sha256:aa938a849bcb82dce8f49480f056ab82bf5c1c3ebc294f0430f37b6820e7f286 AS build
COPY --from=uv /uv /usr/local/bin/uv
WORKDIR /app
COPY apps/analytics/ ./
ENV UV_PYTHON_DOWNLOADS=never
RUN uv sync --frozen --no-install-project --no-build --no-python-downloads && uv sync --frozen --no-build-isolation --no-python-downloads
RUN uv sync --frozen --no-dev --no-build-isolation --no-python-downloads

FROM python:3.13.13-slim-trixie@sha256:aa938a849bcb82dce8f49480f056ab82bf5c1c3ebc294f0430f37b6820e7f286
# Security fixes for the util-linux source packages in the pinned Python base.
RUN apt-get update -qq && apt-get install -y --no-install-recommends \
    util-linux=2.41.5-0+deb13u1 mount=2.41.5-0+deb13u1 \
    libblkid1=2.41.5-0+deb13u1 libmount1=2.41.5-0+deb13u1 \
    libsmartcols1=2.41.5-0+deb13u1 libuuid1=2.41.5-0+deb13u1 \
    liblastlog2-2=2.41.5-0+deb13u1 bsdutils=1:2.41.5-0+deb13u1 login=1:4.16.0-2+really2.41.5-0+deb13u1 \
    libc6=2.41-12+deb13u4 libc-bin=2.41-12+deb13u4 perl-base=5.40.1-6+deb13u1 \
    openssl=3.5.7-1~deb13u3 libssl3t64=3.5.7-1~deb13u3 openssl-provider-legacy=3.5.7-1~deb13u3 \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PATH=/app/.venv/bin:$PATH
WORKDIR /app
COPY --from=build /app /app
USER 10001:10001
CMD ["python", "-m", "oliginvest_analytics"]
