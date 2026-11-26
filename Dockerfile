# BookMyStay Suite — one image: the API also serves the built React app (SERVE_CLIENT=true).
#   docker build -t bookmystay .
#   docker run --env-file .env.production -p 4000:4000 bookmystay

# ── Build: install everything, typecheck, test-free build of server + client ──
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --no-audit --no-fund
COPY server server
COPY client client
# Same-origin API in production; never put secrets in VITE_* variables (they ship to the browser).
ENV VITE_API_URL=/api/v1
RUN npm run build

# ── Runtime: production dependencies of the server only ──
FROM node:24-slim AS runtime
ENV NODE_ENV=production \
    PORT=4000 \
    SERVE_CLIENT=true
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev --workspace server --include-workspace-root=false --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist

USER node
WORKDIR /app/server
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
