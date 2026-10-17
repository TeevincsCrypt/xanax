FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
# SQLite lives on a mounted volume so orders survive deploys.
ENV DATABASE_URL=file:/data/xanax.db
EXPOSE 3000
CMD ["node", "--no-warnings=ExperimentalWarning", "--import", "tsx", "src/server.ts"]
