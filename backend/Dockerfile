FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --only=production

COPY . .

RUN mkdir -p /data/uploads /data/exports

EXPOSE 3001

# Initialize database and then start server
CMD ["sh", "-c", "node init-db.js && node index.js"]
