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

# Drei Dinge, ohne die ein YouTube-Downloader auf einer Datacenter-IP nicht
# lange lebt. Erfahrungen aus VAULT, ausfuehrlich in
# ~/Documents/GITHUB-GITLAB-TRANSFER-PLAN.md.
#
# 1. yt-dlp als Standalone-Build (bringt sein eigenes Python mit). Bewusst
#    `latest` und NICHT gepinnt: das Image ist nur der Startwert, zur Laufzeit
#    haelt sich eine schreibbare Kopie auf dem Volume selbst aktuell
#    (src/lib/media.ts, selbstaktuellesYtdlp). YouTube aendert seine
#    Player-Interna im Wochentakt; ein eingebranntes yt-dlp waere nach ein
#    paar Wochen tot und man muesste nur deswegen neu deployen.
#
# 2. deno als JavaScript-Runtime. yt-dlp fuehrt inzwischen YouTubes
#    Player-Code aus (EJS). Ohne JS-Runtime laeuft ein degradierter Fallback,
#    der schneller im Bot-Check landet und als deprecated gilt. yt-dlp findet
#    deno selbst auf dem PATH, es braucht keine Konfiguration.
#
# 3. ffmpeg/ffprobe zum Extrahieren und Schneiden.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ffmpeg ca-certificates curl unzip tzdata \
 && curl -fsSL -o /usr/local/bin/yt-dlp \
      "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux" \
 && chmod 0755 /usr/local/bin/yt-dlp \
 && curl -fsSL -o /tmp/deno.zip \
      "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-unknown-linux-gnu.zip" \
 && unzip -o /tmp/deno.zip -d /usr/local/bin \
 && rm /tmp/deno.zip \
 && chmod 0755 /usr/local/bin/deno \
 && apt-get purge -y curl unzip && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/* \
 && /usr/local/bin/yt-dlp --version \
 && /usr/local/bin/deno --version | head -1 \
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
RUN mkdir -p /app/data/audio /app/data/icons /app/data/bin \
 && chown -R nextjs:nodejs /app/data
VOLUME ["/app/data"]

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
