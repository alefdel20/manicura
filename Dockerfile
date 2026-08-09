FROM node:20-slim

WORKDIR /app

# python3/make/g++: fallback para compilar better-sqlite3 si no hay
# binario prebuildeado para la plataforma del host.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/app/data/manicura.db

EXPOSE 3000
VOLUME ["/app/data"]

CMD ["node", "server/index.js"]
