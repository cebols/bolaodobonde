# Imagem de produção do Bolão da Copa 2026
FROM node:22-slim

WORKDIR /app

# Instala dependências primeiro (cache de build)
COPY package*.json ./
RUN npm install --omit=dev

# Copia o restante do app
COPY . .

# Banco SQLite em volume persistente (configure DB_PATH no host)
ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/data/bolao.db
VOLUME ["/data"]

EXPOSE 3000
CMD ["node", "server/index.js"]
