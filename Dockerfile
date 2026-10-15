FROM oven/bun:1.3.10 AS build
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run check

FROM oven/bun:1.3.10-slim
WORKDIR /app
ENV NODE_ENV=production APP_MODE=testing PORT=3000 DATABASE_PATH=/var/data/testing/garden.db
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/dist ./client/dist
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/package.json ./package.json
EXPOSE 3000
CMD ["bun", "run", "start"]
