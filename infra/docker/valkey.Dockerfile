FROM valkey/valkey:9.1.2@sha256:c123e3715db63d06d4ad6964884037aa0d5d4d703939b9929954112889708e1d AS patched
# apt 3.0.4 (DSA-6607-1, CVE-2026-109518: package verification bypass on retried downloads) was published
# 2026-11-04T12:03Z; the owner accepted it inside the 72-hour window (2026-11-04). Retries stay off while the
# vulnerable apt fetches the fix.
RUN apt-get -o Acquire::Retries=0 update -qq && apt-get -o Acquire::Retries=0 install -y --no-install-recommends \
    libc6=2.41-12+deb13u4 libc-bin=2.41-12+deb13u4 perl-base=5.40.1-6+deb13u1 apt=3.0.4 libapt-pkg7.0=3.0.4 \
    && rm -rf /var/lib/apt/lists/*

FROM patched AS valkey-queue
RUN chown 10006:10006 /data
USER 10006:10006

FROM patched AS valkey-cache
RUN chown 10007:10007 /data
USER 10007:10007
