FROM node:24-alpine

# Release-taggen (t.ex. v0.1.29) — visas av /api/health och MCP-servern.
ARG APP_VERSION=
ENV APP_VERSION=$APP_VERSION

WORKDIR /app

COPY package.json package-lock.json ./

# npm ci: exakt det som står i låsfilen (samma som CI testar), inget nyare.
RUN npm ci --omit=dev

COPY . .

USER node

EXPOSE 5000

CMD ["node", "server.js"]
