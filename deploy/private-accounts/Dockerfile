FROM node:24.22.2-trixie-slim@sha256:0820eaa85e07d0490446dd01d14707e17e6108a36988cf374899cd057eb3812d
WORKDIR /gateway
COPY deploy/private-accounts/package.json deploy/private-accounts/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY deploy/private-accounts/auth.mjs deploy/private-accounts/server.mjs ./
COPY deploy/private-accounts/oauth.mjs ./
COPY deploy/private-accounts/ui.mjs ./
COPY deploy/private-accounts/assets ./assets
COPY public/ui-themes.css ./assets/ui-themes.css
COPY deploy/private-accounts/deployment-source.zip /source/deployment-source.zip
RUN mkdir /tokens && chown 65532:65532 /tokens
USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.mjs"]
