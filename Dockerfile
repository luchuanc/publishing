FROM node:24-bookworm-slim AS ui
WORKDIR /build
COPY package*.json ./
RUN npm ci --include=dev --no-audit --no-fund
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git openssh-client ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=ui /build/dist ./dist
COPY server ./server
COPY package.json ./
RUN mkdir -p /app/.data /home/node/.ssh && chown -R node:node /app /home/node/.ssh
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 DATA_DIR=/app/.data
EXPOSE 8080 8201-8299
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
