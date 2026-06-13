# Alpona — single container serving the API and the built studio.
FROM node:22-bookworm-slim

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.5.3 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY datasets ./datasets

RUN pnpm install --frozen-lockfile
RUN pnpm --filter alpona-studio build

COPY deploy/boot.sh ./deploy/boot.sh

EXPOSE 3001
CMD ["sh", "deploy/boot.sh"]
