FROM ghcr.io/astral-sh/uv:0.12.16@sha256:adc68cd785ca65ea25c0611043b0a00b4ea3a22e1b54102fc084406d888082ee AS uv
FROM python:3.13.13-slim-trixie@sha256:aa938a849bcb82dce8f49480f056ab82bf5c1c3ebc294f0430f37b6820e7f286 AS build
COPY --from=uv /uv /usr/local/bin/uv
WORKDIR /app
COPY apps/analytics/ ./
ENV UV_PYTHON_DOWNLOADS=never
RUN uv sync --frozen --no-install-project --no-build --no-python-downloads && uv sync --frozen --no-build-isolation --no-python-downloads
RUN uv sync --frozen --no-dev --no-build-isolation --no-python-downloads

FROM python:3.13.13-slim-trixie@sha256:aa938a849bcb82dce8f49480f056ab82bf5c1c3ebc294f0430f37b6820e7f286
ENV NODE_ENV=production PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PATH=/app/.venv/bin:$PATH
WORKDIR /app
COPY --from=build /app /app
USER 10001:10001
CMD ["python", "-m", "oliginvest_analytics"]
