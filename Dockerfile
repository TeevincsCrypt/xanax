FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY tsconfig.json ./
COPY client ./client
# Bundle the Privy login island (React) into public/js; the rest of the site is server-rendered.
RUN pnpm build:client
COPY src ./src
COPY scripts ./scripts
# SQLite lives on a mounted volume so orders survive deploys.
ENV DATABASE_URL=file:/data/xanax.db
EXPOSE 3000
CMD ["node", "--no-warnings=ExperimentalWarning", "--import", "tsx", "src/server.ts"]
