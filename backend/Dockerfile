FROM node:20-alpine

# Release-taggen (t.ex. v0.1.29) — visas av /api/health och MCP-servern.
ARG APP_VERSION=
ENV APP_VERSION=$APP_VERSION

WORKDIR /app

COPY package.json package-lock.json* ./

RUN npm install --omit=dev

COPY . .

USER node

EXPOSE 5000

CMD ["node", "server.js"]
