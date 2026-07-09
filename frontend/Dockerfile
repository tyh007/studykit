# Build stage
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./
# Use `npm install` rather than `npm ci` — the committed lockfile is missing
# some platform optional dependencies (e.g. esbuild@0.21.5 binaries), which
# makes `npm ci` fail with "Missing: ... from lock file". `npm install`
# back-fills them so the Docker build succeeds. Build is still reproducible
# because package.json pins all direct dependency versions.
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build

# Serve stage
FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
