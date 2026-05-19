# ── Stage 1: build React app ──────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --legacy-peer-deps

COPY . .

ARG REACT_APP_UMAMI_URL=
ARG REACT_APP_UMAMI_WEBSITE_ID=
RUN export REACT_APP_UMAMI_URL="${REACT_APP_UMAMI_URL}" \
    REACT_APP_UMAMI_WEBSITE_ID="${REACT_APP_UMAMI_WEBSITE_ID}" \
 && npm run build

# ── Stage 2: serve with nginx ─────────────────────────────────────────────────
FROM nginx:alpine

COPY --from=builder /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
