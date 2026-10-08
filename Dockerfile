# Imagem de desenvolvimento: o app roda pelo dev server do Vite, porque ele e
# quem serve /api/data e /api/save -- e e por /api/save que o diagrama volta
# para o disco do Mac.
FROM node:24-alpine

WORKDIR /app

# As dependencias sao instaladas DENTRO da imagem (binarios linux/arm64).
# O node_modules do host, com binarios do macOS, e mascarado por um volume
# nomeado no compose e nunca chega aqui.
COPY package.json package-lock.json* ./
RUN npm ci || npm install

ENV MECHA_POLL=1
EXPOSE 5180

CMD ["npm", "run", "dev"]
