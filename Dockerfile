# API image for Cloud Run. Two stages: build bundles the API (and the
# shared package) with esbuild; runtime has only production dependencies.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @easytenant/api --include-workspace-root --ignore-scripts
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @easytenant/api

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @easytenant/api --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/apps/api/dist apps/api/dist
ARG GIT_SHA=dev
ENV GIT_SHA=$GIT_SHA
USER node
EXPOSE 8080
CMD ["node", "--enable-source-maps", "apps/api/dist/server.js"]
