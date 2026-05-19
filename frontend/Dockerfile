# ── Stage 1: build with Vite ──────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_UMAMI_URL=
ARG VITE_UMAMI_WEBSITE_ID=
RUN VITE_UMAMI_URL="${VITE_UMAMI_URL}" \
    VITE_UMAMI_WEBSITE_ID="${VITE_UMAMI_WEBSITE_ID}" \
    npm run build

# ── Stage 2: serve with nginx ─────────────────────────────────────────────────
FROM nginx:alpine

COPY --from=builder /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
