FROM node:24-bookworm-slim AS ui
WORKDIR /build
COPY package*.json ./
RUN npm ci --include=dev --no-audit --no-fund
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git openssh-client ca-certificates curl unzip openjdk-17-jdk-headless && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=ui /build/dist ./dist
COPY server ./server
COPY package.json ./
ENV ANDROID_HOME=/opt/android-sdk
RUN curl -fsSL --retry 3 https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip -o /tmp/android-tools.zip \
    && echo '5fdcc763663eefb86a5b8879697aa6088b041e70  /tmp/android-tools.zip' | sha1sum -c - \
    && mkdir -p $ANDROID_HOME/cmdline-tools \
    && unzip -q /tmp/android-tools.zip -d $ANDROID_HOME/cmdline-tools \
    && mv $ANDROID_HOME/cmdline-tools/cmdline-tools $ANDROID_HOME/cmdline-tools/latest \
    && yes | $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --licenses >/dev/null
RUN $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager 'platform-tools' 'platforms;android-36' 'build-tools;35.0.0' \
    && rm /tmp/android-tools.zip \
    && mkdir -p /app/.data /home/node/.ssh /home/node/.android /home/node/.gradle \
    && chown -R node:node /app /home/node/.ssh /home/node/.android /home/node/.gradle $ANDROID_HOME
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 DATA_DIR=/app/.data
EXPOSE 8080 8200
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
