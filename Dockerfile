# lilboard — self-host image (Next.js standalone + node:sqlite).
# The Cloudflare Worker runtime lives in worker/ and deploys via wrangler,
# not this image.

FROM node:26-alpine AS deps
WORKDIR /app
RUN npm install -g pnpm@12
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml next.config.ts tsconfig.json ./
COPY packages ./packages
COPY worker/package.json ./worker/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY app ./app
COPY lib ./lib
COPY public ./public
COPY bin ./bin
RUN pnpm build

FROM node:26-alpine AS run
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    LILBOARD_DATA=/data
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/bin ./bin
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget -qO- http://127.0.0.1:3000/ >/dev/null 2>&1 || exit 1
CMD ["node", "server.js"]
