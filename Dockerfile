# syntax=docker/dockerfile:1
#
# Multi-Stage-Build fuer yt-soundboard (Next.js 15, output: "standalone").
# Haus-Muster wie Hotel Erika und Saldario. Basis ist trixie-slim, nicht
# alpine: das yt-dlp-Standalone ist ein PyInstaller-Bundle und braucht glibc.
#
#   docker build -t buttons .
#   docker run --rm -p 3000:3000 -v buttons-data:/app/data buttons

# ---- 1. deps ----
FROM node:24-trixie-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- 2. builder ----
FROM node:24-trixie-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- 3. runner ----
FROM node:24-trixie-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    TZ=Europe/Vienna

# yt-dlp als Standalone, nicht als pip-Modul: es bringt sein eigenes Python
# mit, und src/lib/media.ts sucht genau danach zuerst (resolveYtdlp).
# Die Version ist gepinnt, damit ein Rebuild reproduzierbar bleibt.
#
# ACHTUNG, Betriebshinweis: YouTube aendert seine Auslieferung regelmaessig,
# und dann hilft nur ein neueres yt-dlp. Ein gepinntes yt-dlp hoert also
# irgendwann auf zu funktionieren, ohne dass sich am Code etwas aendert.
# Dann diese Zeile hochziehen und neu bauen.
ARG YTDLP_VERSION=2025.08.27

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl tzdata \
 && curl -fsSL -o /usr/local/bin/yt-dlp \
      "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp_linux" \
 && chmod 755 /usr/local/bin/yt-dlp \
 && apt-get purge -y curl && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/* \
 && /usr/local/bin/yt-dlp --version \
 && ffmpeg -version | head -1 \
 && ffprobe -version | head -1

RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# DATA_DIR ist in src/lib/paths.ts als cwd()/data festgelegt, hier also
# /app/data. Dort liegen pads.json, die MP3s und die Icons.
#
# WICHTIG: /app/data MUSS ein persistentes Volume sein. Ohne Volume sind nach
# jedem Deploy alle Pads weg - und die Audios muessten neu heruntergeladen
# werden, was bei geloeschten YouTube-Videos gar nicht mehr geht.
RUN mkdir -p /app/data/audio /app/data/icons && chown -R nextjs:nodejs /app/data
VOLUME ["/app/data"]

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
