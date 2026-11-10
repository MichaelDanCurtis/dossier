FROM node:24.22.2-trixie-slim@sha256:0820eaa85e07d0490446dd01d14707e17e6108a36988cf374899cd057eb3812d
WORKDIR /gateway
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY auth.mjs server.mjs ./
COPY oauth.mjs ./
COPY ui.mjs ./
COPY assets ./assets
COPY deployment-source.zip /source/deployment-source.zip
RUN mkdir /tokens && chown 65532:65532 /tokens
USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.mjs"]
