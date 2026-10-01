FROM valkey/valkey:9.1.2@sha256:c123e3715db63d06d4ad6964884037aa0d5d4d703939b9929954112889708e1d AS patched
RUN apt-get update -qq && apt-get install -y --no-install-recommends \
    libc6=2.41-12+deb13u4 libc-bin=2.41-12+deb13u4 perl-base=5.40.1-6+deb13u1 \
    && rm -rf /var/lib/apt/lists/*

FROM patched AS valkey-queue
RUN chown 10006:10006 /data
USER 10006:10006

FROM patched AS valkey-cache
RUN chown 10007:10007 /data
USER 10007:10007
