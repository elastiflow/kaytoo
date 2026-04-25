FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig*.json eslint.config.js vitest.config.ts ./
COPY src ./src
COPY test ./test

RUN npm run lint && npm test && npm run build
RUN npm prune --omit=dev

FROM gcr.io/distroless/nodejs24-debian12:nonroot

WORKDIR /app

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

ENV NODE_ENV=production

CMD ["dist/main.js"]

