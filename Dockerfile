FROM node:20-alpine

# Python und build-tools fuer better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Dependencies installieren
COPY package*.json ./
RUN npm install

# better-sqlite3 native module neu kompilieren
RUN npm rebuild better-sqlite3

# Bot-Code kopieren
COPY . .

# Daten- und Assets-Verzeichnis erstellen
RUN mkdir -p /app/data /app/assets

# Bot starten
CMD ["node", "bot.js"]
