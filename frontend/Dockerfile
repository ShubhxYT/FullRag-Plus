# ---- Stage 1: Build ----
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first for layer caching
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Copy source and build
COPY . .
RUN npm run build

# ---- Stage 2: Serve with nginx ----
FROM nginx:1.27-alpine

# Where nginx proxies /api/* to. Defaults match the Coolify setup (backend app
# with network alias "rag-backend"); docker-compose overrides BACKEND_HOST.
ENV BACKEND_HOST=rag-backend \
    BACKEND_PORT=8001 \
    NGINX_RESOLVER=127.0.0.11 \
    CLIENT_MAX_BODY_SIZE=60m

# Rendered to /etc/nginx/conf.d/default.conf by the image's entrypoint
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
