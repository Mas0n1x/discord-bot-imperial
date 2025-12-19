#!/bin/bash

# Discord Bot Startskript - verhindert mehrere Instanzen

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$SCRIPT_DIR/bot.pid"
LOG_FILE="/tmp/bot.log"

# Alle laufenden Bot-Instanzen stoppen
echo "Stoppe alle Bot-Instanzen..."

# PID-Datei prüfen
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    kill -9 "$OLD_PID" 2>/dev/null
    rm -f "$PID_FILE"
fi

# Alle node bot.js Prozesse beenden
for pid in $(pgrep -f "node bot.js"); do
    kill -9 "$pid" 2>/dev/null
done

sleep 2

# Sicherstellen dass alle weg sind
for pid in $(pgrep -f "node bot.js"); do
    kill -9 "$pid" 2>/dev/null
done

sleep 1

# Jetzt Bot starten
echo "Starte Bot..."
cd "$SCRIPT_DIR"

# Log-Datei leeren
> "$LOG_FILE"

# Bot starten
node bot.js >> "$LOG_FILE" 2>&1 &
BOT_PID=$!
echo $BOT_PID > "$PID_FILE"

echo "Bot gestartet mit PID $BOT_PID"

# Warten und prüfen
sleep 6

if ps -p $BOT_PID > /dev/null 2>&1; then
    echo "Bot läuft!"
    cat "$LOG_FILE"
else
    echo "Bot konnte nicht gestartet werden:"
    cat "$LOG_FILE"
fi
