# Discord Bot Imperial

Ein Discord Bot mit Abmeldungs- und Sanktionssystem sowie Tuning-Dokumentation fuer Fahrzeuge.

## Features

- **Abmeldungssystem**: Mitarbeiter koennen sich mit Grund und Zeitraum abmelden
- **Sanktionssystem**: Moderatoren koennen Sanktionen mit Geldstrafen ausstellen
- **Tuning-Dokumentation**: Erfassung von Tuningchip, Stance und Xenon Modifikationen
- **Interaktive Panels**: Button-basierte Eingabe ueber Modals

## Voraussetzungen

- Node.js 18+
- Discord Bot Token

## Installation

1. Abhaengigkeiten installieren:
```bash
npm install
```

2. `.env` Datei erstellen (siehe `.env.example`):
```env
DISCORD_TOKEN=dein_bot_token_hier
CLIENT_ID=deine_client_id_hier
GUILD_ID=deine_server_id_hier
```

3. Slash Commands registrieren:
```bash
npm run deploy
```

4. Bot starten:
```bash
npm start
```

## Slash Commands

### Abmeldungen
- `/abmelden` - Neue Abmeldung erstellen
- `/abmeldungen` - Aktive Abmeldungen anzeigen
- `/abmeldung-loeschen` - Abmeldung loeschen

### Sanktionen
- `/sanktion` - Sanktion ausstellen (Moderator)
- `/sanktionen` - Sanktionen anzeigen
- `/sanktion-aufheben` - Sanktion aufheben (Moderator)

### Panels (Admin)
- `/panel` - Abmeldungs-Panel erstellen
- `/tuningchip-panel` - Tuningchip-Panel erstellen
- `/stance-panel` - Stance-Panel erstellen
- `/xenon-panel` - Xenon-Panel erstellen

### Info
- `/userinfo` - Benutzerinformationen anzeigen

## Datenbank

Der Bot verwendet SQLite (better-sqlite3) und speichert die Datenbank unter `data/bot.db`.

## Docker

```bash
docker build -t discord-bot-imperial .
docker run -d --env-file .env discord-bot-imperial
```

## Lizenz

MIT
