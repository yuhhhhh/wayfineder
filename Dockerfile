FROM node:22.23.1-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json biome.json vitest.config.ts ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22.23.1-bookworm-slim AS runtime
ENV NODE_ENV=production \
    WAYFINDER_DATA_DIR=/var/lib/wayfinder
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
RUN mkdir -p /var/lib/wayfinder && chown node:node /var/lib/wayfinder
USER node
CMD ["node", "--enable-source-maps", "dist/main.js"]

