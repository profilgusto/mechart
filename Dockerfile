# syntax=docker/dockerfile:1

# --- Estagio 1: build do site estatico ---
# Instala as dependencias e roda `vite build`. Nada daqui vai para a imagem
# final alem dos arquivos gerados em dist/.
FROM node:24-alpine AS build

WORKDIR /app

# Copia primeiro so os manifestos: o `npm ci` fica em cache enquanto o
# package-lock.json nao mudar.
COPY package.json package-lock.json ./
RUN npm ci

# O restante do codigo. `.git`, node_modules e dist ficam de fora pelo
# .dockerignore. `data/` entra porque o catalogo (data/components/) e embutido no
# bundle via `?raw` (ver src/data/load.ts).
COPY . .
RUN npm run build


# --- Estagio 2: runtime estatico ---
# nginx-unprivileged roda como usuario nao-root (uid 101) e escuta na 8080.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

# Config do servidor: SPA, cache, compressao e headers de seguranca.
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Apenas os arquivos gerados no estagio de build.
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080
