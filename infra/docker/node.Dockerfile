FROM node:24.21.0-trixie-slim@sha256:8ec5d7557396cfe32d21c3f9c13072355ceab22b584578ca4bb28af31120cffe AS build
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install --global pnpm@12.4.2
WORKDIR /source
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@oliginvest/web --filter=@oliginvest/api --filter=@oliginvest/jobs --filter=@oliginvest/db --output-logs=new-only
RUN pnpm --filter @oliginvest/api deploy --legacy --prod /out/api && pnpm --filter @oliginvest/jobs deploy --legacy --prod /out/jobs && pnpm --filter @oliginvest/db deploy --legacy --prod /out/migrate

# Owner-only calibration tool; never published as an application service.
FROM build AS auth-benchmark
USER 10002:10002
CMD ["node", "apps/api/spike/auth-storage.mjs", "--benchmark-only"]

FROM node:24.21.0-trixie-slim@sha256:8ec5d7557396cfe32d21c3f9c13072355ceab22b584578ca4bb28af31120cffe AS runtime
# apt 3.0.4 (DSA-6607-1, CVE-2026-109518: package verification bypass on retried downloads) was published
# 2026-11-04T12:03Z; the owner accepted it inside the 72-hour window (2026-11-04). Retries stay off while the
# vulnerable apt fetches the fix.
RUN apt-get -o Acquire::Retries=0 update -qq && apt-get -o Acquire::Retries=0 install -y --no-install-recommends apt=3.0.4 libapt-pkg7.0=3.0.4 \
    && rm -rf /var/lib/apt/lists/*

FROM runtime AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build /source/apps/web/.next/standalone ./
COPY --from=build /source/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /source/apps/web/public ./apps/web/public
USER 1000:1000
CMD ["node", "apps/web/server.js"]

FROM runtime AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/api ./
USER 10002:10002
CMD ["node", "dist/server.js"]

FROM runtime AS jobs
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/jobs ./
USER 10003:10003
CMD ["node", "dist/server.js"]

FROM runtime AS migrate
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/migrate ./
USER 10004:10004
CMD ["node", "scripts/migrate-production.mjs"]
