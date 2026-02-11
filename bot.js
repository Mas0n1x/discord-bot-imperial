const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder } = require('discord.js');
// ModalBuilder, TextInputBuilder, TextInputStyle werden nur noch fuer Abmeldungen verwendet
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// ==================== SINGLETON LOCK ====================
// Verhindert mehrere Bot-Instanzen gleichzeitig
// In Docker-Containern ist PID 1 immer der Hauptprozess, daher nutzen wir /tmp für Lock-Dateien
const LOCK_FILE = process.env.DOCKER_CONTAINER ? '/tmp/bot.lock' : path.join(__dirname, 'bot.lock');

function acquireLock() {
  try {
    // In Docker: Lock-Datei beim Start immer entfernen (Container-Neustart)
    // PID 1 Check ist in Docker nicht zuverlässig, da PID 1 immer existiert
    if (process.pid === 1 && fs.existsSync(LOCK_FILE)) {
      console.log('Docker-Container erkannt (PID 1), entferne alte Lock-Datei...');
      fs.unlinkSync(LOCK_FILE);
    }

    // Prüfe ob Lock-Datei existiert
    if (fs.existsSync(LOCK_FILE)) {
      const lockData = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
      const lockPid = lockData.pid;
      const lockTime = lockData.timestamp;

      // Prüfe ob der Prozess noch läuft (nur sinnvoll wenn nicht PID 1)
      if (lockPid !== 1) {
        try {
          process.kill(lockPid, 0); // Signal 0 prüft nur ob Prozess existiert
          // Prozess läuft noch - Lock ist aktiv
          console.error(`FEHLER: Bot läuft bereits! (PID: ${lockPid}, gestartet: ${new Date(lockTime).toLocaleString('de-DE')})`);
          console.error('Beende diesen Prozess...');
          process.exit(1);
        } catch (e) {
          // Prozess läuft nicht mehr - alter Lock, kann überschrieben werden
          console.log('Alter Lock gefunden, Prozess existiert nicht mehr. Übernehme Lock...');
        }
      } else {
        // PID 1 Lock - in Docker bedeutet dies Container-Neustart
        console.log('Alter PID-1-Lock gefunden, überschreibe (Container-Neustart)...');
      }
    }

    // Lock erstellen
    const lockData = {
      pid: process.pid,
      timestamp: Date.now(),
      started: new Date().toISOString()
    };
    fs.writeFileSync(LOCK_FILE, JSON.stringify(lockData, null, 2));
    console.log(`Lock erworben (PID: ${process.pid})`);
    return true;
  } catch (error) {
    console.error('Fehler beim Lock-Management:', error);
    return false;
  }
}

function releaseLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const lockData = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
      // Nur eigenen Lock löschen
      if (lockData.pid === process.pid) {
        fs.unlinkSync(LOCK_FILE);
        console.log('Lock freigegeben');
      }
    }
  } catch (error) {
    console.error('Fehler beim Freigeben des Locks:', error);
  }
}

// Lock beim Start erwerben
if (!acquireLock()) {
  process.exit(1);
}

// Lock bei Beendigung freigeben
process.on('exit', releaseLock);
process.on('SIGINT', () => { releaseLock(); process.exit(0); });
process.on('SIGTERM', () => { releaseLock(); process.exit(0); });
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  // Discord API Fehler (z.B. Unknown interaction) sind nicht kritisch - Bot weiterlaufen lassen
  if (err.code && typeof err.code === 'number') {
    console.error('Discord API Fehler - Bot laeuft weiter');
    return;
  }
  releaseLock();
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
  // Nicht crashen bei Promise-Fehlern (z.B. Discord API Timeouts)
});

// .env manuell laden
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const [key, ...values] = line.split('=');
    if (key && values.length > 0) {
      process.env[key.trim()] = values.join('=').trim();
    }
  });
}

// Datenbank initialisieren
const db = new Database(path.join(__dirname, 'data', 'bot.db'));

// Tabellen erstellen
db.exec(`
  CREATE TABLE IF NOT EXISTS abmeldungen (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    grund TEXT NOT NULL,
    von DATE NOT NULL,
    bis DATE NOT NULL,
    erstellt_am DATETIME DEFAULT CURRENT_TIMESTAMP,
    aktiv INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS sanktionen (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    typ TEXT NOT NULL,
    grund TEXT NOT NULL,
    geldstrafe INTEGER DEFAULT 0,
    ausgestellt_von TEXT NOT NULL,
    ausgestellt_von_name TEXT NOT NULL,
    erstellt_am DATETIME DEFAULT CURRENT_TIMESTAMP,
    ablauf_datum DATETIME,
    aktiv INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS panel_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    typ TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tuningchip (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    kennzeichen TEXT NOT NULL,
    beschreibung TEXT NOT NULL,
    bild_url TEXT,
    erstellt_von TEXT NOT NULL,
    erstellt_von_name TEXT NOT NULL,
    erstellt_am DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS stance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    kennzeichen TEXT NOT NULL,
    bild_url TEXT,
    erstellt_von TEXT NOT NULL,
    erstellt_von_name TEXT NOT NULL,
    erstellt_am DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS xenon (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    kennzeichen TEXT NOT NULL,
    farbe TEXT NOT NULL,
    bild_url TEXT,
    erstellt_von TEXT NOT NULL,
    erstellt_von_name TEXT NOT NULL,
    erstellt_am DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS eigentuning (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    erstellt_von TEXT NOT NULL,
    erstellt_von_name TEXT NOT NULL,
    rechnungssteller TEXT NOT NULL,
    einkaufspreis INTEGER NOT NULL,
    rechnungshoehe INTEGER NOT NULL,
    erstellt_am DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migration: geldstrafe Spalte hinzufuegen falls nicht vorhanden
try {
  db.exec('ALTER TABLE sanktionen ADD COLUMN geldstrafe INTEGER DEFAULT 0');
} catch (e) {
  // Spalte existiert bereits, ignorieren
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent
  ]
});

// Kanal-IDs
const ABMELDUNG_CHANNEL_ID = '1438789068136648754';
const SANKTION_CHANNEL_ID = '1449796531413586131';
const TUNINGCHIP_CHANNEL_ID = '1416981931324604516';
const STANCE_CHANNEL_ID = '1416976497708892230';
const XENON_CHANNEL_ID = '1416976639690281141';

// Logo-Pfad
const LOGO_PATH = '/srv/samba/share/logo_firma.png';

// Hilfsfunktion: Datum formatieren
function formatDate(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Hilfsfunktion: Embed-Farben
const COLORS = {
  SUCCESS: 0x00ff00,
  WARNING: 0xffaa00,
  ERROR: 0xff0000,
  INFO: 0x0099ff,
  PANEL: 0x2b2d31
};

// Hilfsfunktion: Alle Nachrichten in einem Kanal loeschen (fuer Tuning-Kanaele)
async function clearChannel(channel) {
  try {
    let totalDeleted = 0;
    let iterations = 0;
    const maxIterations = 50; // Sicherheitslimit

    while (iterations < maxIterations) {
      iterations++;
      const messages = await channel.messages.fetch({ limit: 100 });

      if (messages.size === 0) {
        console.log(`Kanal ${channel.name} geleert - ${totalDeleted} Nachrichten geloescht`);
        break;
      }

      // Filtere Nachrichten die juenger als 14 Tage sind (Discord Limit fuer bulkDelete)
      const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
      const deletable = messages.filter(m => m.createdTimestamp > twoWeeksAgo);
      const oldMessages = messages.filter(m => m.createdTimestamp <= twoWeeksAgo);

      let deletedCount = 0;

      // Bulk delete fuer neuere Nachrichten
      if (deletable.size > 0) {
        try {
          const deleted = await channel.bulkDelete(deletable, true);
          deletedCount += deleted.size;
        } catch (e) {
          console.error('Bulk delete Fehler:', e.message);
        }
      }

      // Einzeln loeschen fuer aeltere Nachrichten (mit Rate-Limit Pause)
      for (const msg of oldMessages.values()) {
        try {
          await msg.delete();
          deletedCount++;
          // Kurze Pause um Rate-Limits zu vermeiden
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (e) {
          // Ignorieren wenn Nachricht nicht geloescht werden kann
        }
      }

      totalDeleted += deletedCount;

      // Wenn nichts mehr geloescht werden konnte, abbrechen
      if (deletedCount === 0) {
        console.log(`Keine weiteren Nachrichten loeschbar in ${channel.name}`);
        break;
      }
    }

    return true;
  } catch (error) {
    console.error('Fehler beim Loeschen der Nachrichten:', error);
    return false;
  }
}

// Hilfsfunktion: Abgelaufene Abmeldungen deaktivieren
function deactivateExpiredAbmeldungen() {
  const heute = new Date();
  heute.setHours(23, 59, 59, 999); // Ende des Tages
  const heuteStr = heute.toISOString().split('T')[0];

  const stmt = db.prepare(`
    UPDATE abmeldungen
    SET aktiv = 0
    WHERE aktiv = 1 AND bis < ?
  `);
  const result = stmt.run(heuteStr);

  if (result.changes > 0) {
    console.log(`${result.changes} abgelaufene Abmeldung(en) deaktiviert`);
  }

  return result.changes;
}

// Panel aktualisieren - loescht altes Panel und erstellt neues ganz unten
async function updateAbmeldungsPanel(channel) {
  try {
    // Hole alle aktiven Abmeldungen
    const stmt = db.prepare(`
      SELECT * FROM abmeldungen
      WHERE aktiv = 1
      ORDER BY von ASC
    `);
    const abmeldungen = stmt.all();

    // Erstelle das Embed
    const embed = new EmbedBuilder()
      .setTitle('Abmeldungssystem')
      .setDescription('Klicke auf den Button um dich abzumelden.\n\n**Aktuelle Abmeldungen:**')
      .setColor(COLORS.PANEL)
      .setThumbnail('attachment://logo_firma.png')
      .setTimestamp();

    if (abmeldungen.length === 0) {
      embed.addFields({ name: '\u200B', value: '*Keine aktiven Abmeldungen*' });
    } else {
      // Gruppiere nach aktuellen und zukuenftigen Abmeldungen
      const heute = new Date();
      heute.setHours(0, 0, 0, 0);

      abmeldungen.forEach(row => {
        const vonDate = new Date(row.von);
        const bisDate = new Date(row.bis);
        const isAktiv = vonDate <= heute && bisDate >= heute;
        const status = isAktiv ? '🔴 Abwesend' : '🟡 Geplant';

        embed.addFields({
          name: `${status} | ${row.username}`,
          value: `📅 **${formatDate(row.von)}** bis **${formatDate(row.bis)}**\n📝 ${row.grund}`,
          inline: false
        });
      });
    }

    embed.setFooter({ text: `${abmeldungen.length} aktive Abmeldung(en)` });

    // Button erstellen
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('abmelden_button')
          .setLabel('Abmelden')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('📋'),
        new ButtonBuilder()
          .setCustomId('abmeldung_beenden_button')
          .setLabel('Abmeldung beenden')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('✅')
      );

    // Logo laden
    let attachment = null;
    if (fs.existsSync(LOGO_PATH)) {
      attachment = new AttachmentBuilder(LOGO_PATH, { name: 'logo_firma.png' });
    }

    // Pruefe ob bereits ein Panel existiert - wenn ja, loesche es
    const panelStmt = db.prepare('SELECT * FROM panel_messages WHERE channel_id = ? AND typ = ?');
    const existingPanel = panelStmt.get(channel.id, 'abmeldung');

    if (existingPanel) {
      try {
        const oldMessage = await channel.messages.fetch(existingPanel.message_id);
        await oldMessage.delete();
      } catch (e) {
        // Nachricht existiert nicht mehr, ignorieren
      }
      // Loesche DB-Eintrag
      db.prepare('DELETE FROM panel_messages WHERE id = ?').run(existingPanel.id);
    }

    // Neues Panel ganz unten erstellen
    const sendData = { embeds: [embed], components: [row] };
    if (attachment) sendData.files = [attachment];
    const message = await channel.send(sendData);

    // Panel-ID speichern
    db.prepare('INSERT INTO panel_messages (channel_id, message_id, typ) VALUES (?, ?, ?)').run(channel.id, message.id, 'abmeldung');

    return message;
  } catch (error) {
    console.error('Fehler beim Aktualisieren des Panels:', error);
  }
}


client.once('ready', async () => {
  console.log(`Bot ist online als ${client.user.tag}!`);

  // Abgelaufene Abmeldungen deaktivieren
  deactivateExpiredAbmeldungen();

  // Abmeldungs-Panel (Nachrichten bleiben erhalten, nur Panel wird aktualisiert)
  try {
    const channel = await client.channels.fetch(ABMELDUNG_CHANNEL_ID);
    if (channel) {
      await updateAbmeldungsPanel(channel);
      console.log('Abmeldungs-Panel aktualisiert/erstellt');
    }
  } catch (error) {
    console.error('Fehler beim Initialisieren des Abmeldungs-Panels:', error);
  }

});

client.on('interactionCreate', async interaction => {
  try {
  // ==================== BUTTON INTERAKTIONEN ====================
  if (interaction.isButton()) {
    if (interaction.customId === 'abmelden_button') {
      // Modal fuer Abmeldung oeffnen
      const modal = new ModalBuilder()
        .setCustomId('abmeldung_modal')
        .setTitle('Abmeldung erstellen');

      const grundInput = new TextInputBuilder()
        .setCustomId('grund')
        .setLabel('Grund der Abmeldung')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('z.B. Urlaub, Krankheit, Private Gruende...')
        .setRequired(true)
        .setMaxLength(500);

      const vonInput = new TextInputBuilder()
        .setCustomId('von')
        .setLabel('Von (Datum)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('TT.MM.JJJJ (z.B. 25.12.2024)')
        .setRequired(true)
        .setMaxLength(10);

      const bisInput = new TextInputBuilder()
        .setCustomId('bis')
        .setLabel('Bis (Datum)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('TT.MM.JJJJ (z.B. 31.12.2024)')
        .setRequired(true)
        .setMaxLength(10);

      modal.addComponents(
        new ActionRowBuilder().addComponents(grundInput),
        new ActionRowBuilder().addComponents(vonInput),
        new ActionRowBuilder().addComponents(bisInput)
      );

      await interaction.showModal(modal);
    }

    else if (interaction.customId === 'abmeldung_beenden_button') {
      const user = interaction.user;

      // Pruefe ob User eine aktive Abmeldung hat
      const stmt = db.prepare('SELECT * FROM abmeldungen WHERE user_id = ? AND aktiv = 1 ORDER BY erstellt_am DESC LIMIT 1');
      const abmeldung = stmt.get(user.id);

      if (!abmeldung) {
        await interaction.reply({ content: 'Du hast keine aktive Abmeldung.', ephemeral: true });
        return;
      }

      // Abmeldung beenden
      db.prepare('UPDATE abmeldungen SET aktiv = 0 WHERE id = ?').run(abmeldung.id);

      // Nur ephemeral bestaetigen, keine sichtbare Nachricht
      await interaction.reply({
        content: `Deine Abmeldung wurde beendet. Willkommen zurueck!`,
        ephemeral: true
      });

      // Panel aktualisieren (loescht altes, erstellt neues unten)
      await updateAbmeldungsPanel(interaction.channel);
    }
  }

  // ==================== MODAL INTERAKTIONEN ====================
  else if (interaction.isModalSubmit()) {
    if (interaction.customId === 'abmeldung_modal') {
      // Sofort deferReply um 3-Sekunden-Timeout zu vermeiden
      await interaction.deferReply({ ephemeral: true });

      const grund = interaction.fields.getTextInputValue('grund');
      const vonRaw = interaction.fields.getTextInputValue('von');
      const bisRaw = interaction.fields.getTextInputValue('bis');
      const user = interaction.user;

      // Datum parsen (TT.MM.JJJJ -> YYYY-MM-DD)
      function parseDate(dateStr) {
        const parts = dateStr.split('.');
        if (parts.length === 3) {
          return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
        }
        return dateStr;
      }

      const von = parseDate(vonRaw);
      const bis = parseDate(bisRaw);

      // Validierung
      const vonDate = new Date(von);
      const bisDate = new Date(bis);

      if (isNaN(vonDate.getTime()) || isNaN(bisDate.getTime())) {
        await interaction.editReply({ content: 'Ungueltiges Datumsformat. Bitte verwende TT.MM.JJJJ' });
        return;
      }

      if (bisDate < vonDate) {
        await interaction.editReply({ content: 'Das Enddatum muss nach dem Startdatum liegen.' });
        return;
      }

      try {
        const stmt = db.prepare(`
          INSERT INTO abmeldungen (user_id, username, grund, von, bis)
          VALUES (?, ?, ?, ?, ?)
        `);
        const displayName = interaction.member?.displayName || user.tag;
        stmt.run(user.id, displayName, grund, von, bis);

        // Nur ephemeral bestaetigen, keine sichtbare Nachricht
        await interaction.editReply({
          content: `Deine Abmeldung vom ${formatDate(von)} bis ${formatDate(bis)} wurde erfasst.`
        });

        // Panel aktualisieren (loescht altes, erstellt neues unten)
        await updateAbmeldungsPanel(interaction.channel);

      } catch (error) {
        console.error(error);
        try {
          await interaction.editReply({ content: 'Fehler beim Speichern der Abmeldung.' });
        } catch (e) {
          console.error('Konnte Fehlermeldung nicht senden:', e.message);
        }
      }
    }

  }

  // ==================== SLASH COMMANDS ====================
  else if (interaction.isChatInputCommand()) {
    const { commandName, options, user, member } = interaction;

    // ==================== ABMELDUNGSSYSTEM ====================

    if (commandName === 'abmelden') {
      const grund = options.getString('grund');
      const von = options.getString('von');
      const bis = options.getString('bis');

      try {
        const stmt = db.prepare(`
          INSERT INTO abmeldungen (user_id, username, grund, von, bis)
          VALUES (?, ?, ?, ?, ?)
        `);
        const displayName = member?.displayName || user.tag;
        stmt.run(user.id, displayName, grund, von, bis);

        // Ephemeral Bestaetigung
        await interaction.reply({
          content: `Deine Abmeldung vom ${formatDate(von)} bis ${formatDate(bis)} wurde erfasst.`,
          ephemeral: true
        });

        // Panel aktualisieren
        try {
          const channel = await client.channels.fetch(ABMELDUNG_CHANNEL_ID);
          if (channel) await updateAbmeldungsPanel(channel);
        } catch (e) { }

      } catch (error) {
        console.error(error);
        await interaction.reply({ content: 'Fehler beim Speichern der Abmeldung.', ephemeral: true });
      }
    }

    else if (commandName === 'abmeldungen') {
      const targetUser = options.getUser('benutzer');

      try {
        let stmt, rows;

        if (targetUser) {
          stmt = db.prepare(`
            SELECT * FROM abmeldungen
            WHERE user_id = ? AND aktiv = 1
            ORDER BY erstellt_am DESC
            LIMIT 10
          `);
          rows = stmt.all(targetUser.id);
        } else {
          stmt = db.prepare(`
            SELECT * FROM abmeldungen
            WHERE aktiv = 1
            ORDER BY erstellt_am DESC
            LIMIT 10
          `);
          rows = stmt.all();
        }

        if (rows.length === 0) {
          await interaction.reply({ content: 'Keine aktiven Abmeldungen gefunden.', ephemeral: true });
          return;
        }

        const embed = new EmbedBuilder()
          .setTitle('Aktive Abmeldungen')
          .setColor(COLORS.INFO)
          .setTimestamp();

        rows.forEach((row, index) => {
          embed.addFields({
            name: `#${row.id} - ${row.username}`,
            value: `**Von:** ${formatDate(row.von)} | **Bis:** ${formatDate(row.bis)}\n**Grund:** ${row.grund}`
          });
        });

        await interaction.reply({ embeds: [embed], ephemeral: true });
      } catch (error) {
        console.error(error);
        await interaction.reply({ content: 'Fehler beim Abrufen der Abmeldungen.', ephemeral: true });
      }
    }

    else if (commandName === 'abmeldung-loeschen') {
      const abmeldungId = options.getInteger('id');

      try {
        const checkStmt = db.prepare('SELECT * FROM abmeldungen WHERE id = ?');
        const abmeldung = checkStmt.get(abmeldungId);

        if (!abmeldung) {
          await interaction.reply({ content: 'Abmeldung nicht gefunden.', ephemeral: true });
          return;
        }

        // Nur eigene Abmeldungen oder mit Admin-Rechten
        if (abmeldung.user_id !== user.id && !member.permissions.has(PermissionFlagsBits.Administrator)) {
          await interaction.reply({ content: 'Du kannst nur deine eigenen Abmeldungen loeschen.', ephemeral: true });
          return;
        }

        const stmt = db.prepare('UPDATE abmeldungen SET aktiv = 0 WHERE id = ?');
        stmt.run(abmeldungId);

        await interaction.reply({ content: `Abmeldung #${abmeldungId} wurde geloescht.`, ephemeral: true });

        // Panel aktualisieren
        try {
          const channel = await client.channels.fetch(ABMELDUNG_CHANNEL_ID);
          if (channel) await updateAbmeldungsPanel(channel);
        } catch (e) { }

      } catch (error) {
        console.error(error);
        await interaction.reply({ content: 'Fehler beim Loeschen der Abmeldung.', ephemeral: true });
      }
    }

    // ==================== PANEL COMMANDS ====================

    else if (commandName === 'panel') {
      if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({ content: 'Du hast keine Berechtigung fuer diesen Befehl.', ephemeral: true });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      try {
        await updateAbmeldungsPanel(interaction.channel);
        await interaction.editReply({ content: 'Panel wurde erstellt/aktualisiert!' });
      } catch (error) {
        console.error(error);
        await interaction.editReply({ content: 'Fehler beim Erstellen des Panels.' });
      }
    }

    // ==================== TUNING DOKUMENTATION ====================

    else if (commandName === 'tuningchip') {
      const kunde = options.getString('kunde');
      const kennzeichen = options.getString('kennzeichen').toUpperCase();
      const beschreibung = options.getString('beschreibung');
      const bild = options.getAttachment('bild');

      try {
        // In DB speichern
        const stmt = db.prepare(`
          INSERT INTO tuningchip (name, kennzeichen, beschreibung, bild_url, erstellt_von, erstellt_von_name)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        const result = stmt.run(kunde, kennzeichen, beschreibung, bild.url, user.id, user.tag);
        const docId = result.lastInsertRowid;

        // Embed erstellen
        const embed = new EmbedBuilder()
          .setTitle('Tuningchip Dokumentation')
          .setColor(COLORS.SUCCESS)
          .addFields(
            { name: 'Kunde', value: kunde, inline: true },
            { name: 'Kennzeichen', value: kennzeichen, inline: true },
            { name: 'Bearbeitet von', value: `<@${user.id}>`, inline: true },
            { name: 'Durchgefuehrte Aenderungen', value: beschreibung }
          )
          .setImage(bild.url)
          .setFooter({ text: `Dokumentations-ID: #${docId}` })
          .setTimestamp();

        // Ephemeral Bestaetigung
        await interaction.reply({ content: 'Dokumentation wurde erfasst!', ephemeral: true });

        // Im Tuningchip-Kanal posten
        try {
          const tuningChannel = await client.channels.fetch(TUNINGCHIP_CHANNEL_ID);
          if (tuningChannel) {
            await tuningChannel.send({ embeds: [embed] });
          }
        } catch (e) {
          console.error('Fehler beim Senden in Tuningchip-Kanal:', e);
        }
      } catch (error) {
        console.error(error);
        await interaction.reply({ content: 'Fehler beim Speichern der Dokumentation.', ephemeral: true });
      }
    }

    else if (commandName === 'stance') {
      const kunde = options.getString('kunde');
      const kennzeichen = options.getString('kennzeichen').toUpperCase();
      const bild = options.getAttachment('bild');

      try {
        // In DB speichern
        const stmt = db.prepare(`
          INSERT INTO stance (name, kennzeichen, bild_url, erstellt_von, erstellt_von_name)
          VALUES (?, ?, ?, ?, ?)
        `);
        const result = stmt.run(kunde, kennzeichen, bild.url, user.id, user.tag);
        const docId = result.lastInsertRowid;

        // Embed erstellen
        const embed = new EmbedBuilder()
          .setTitle('Stance-Tuning Dokumentation')
          .setColor(COLORS.SUCCESS)
          .addFields(
            { name: 'Kunde', value: kunde, inline: true },
            { name: 'Kennzeichen', value: kennzeichen, inline: true },
            { name: 'Bearbeitet von', value: `<@${user.id}>`, inline: true }
          )
          .setImage(bild.url)
          .setFooter({ text: `Dokumentations-ID: #${docId}` })
          .setTimestamp();

        // Ephemeral Bestaetigung
        await interaction.reply({ content: 'Dokumentation wurde erfasst!', ephemeral: true });

        // Im Stance-Kanal posten
        try {
          const stanceChannel = await client.channels.fetch(STANCE_CHANNEL_ID);
          if (stanceChannel) {
            await stanceChannel.send({ embeds: [embed] });
          }
        } catch (e) {
          console.error('Fehler beim Senden in Stance-Kanal:', e);
        }
      } catch (error) {
        console.error(error);
        await interaction.reply({ content: 'Fehler beim Speichern der Dokumentation.', ephemeral: true });
      }
    }

    else if (commandName === 'xenon') {
      const kunde = options.getString('kunde');
      const kennzeichen = options.getString('kennzeichen').toUpperCase();
      const farbe = options.getString('farbe');
      const bild = options.getAttachment('bild');

      try {
        // In DB speichern
        const stmt = db.prepare(`
          INSERT INTO xenon (name, kennzeichen, farbe, bild_url, erstellt_von, erstellt_von_name)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        const result = stmt.run(kunde, kennzeichen, farbe, bild.url, user.id, user.tag);
        const docId = result.lastInsertRowid;

        // Embed erstellen
        const embed = new EmbedBuilder()
          .setTitle('Xenon-Scheinwerfer Dokumentation')
          .setColor(COLORS.SUCCESS)
          .addFields(
            { name: 'Kunde', value: kunde, inline: true },
            { name: 'Kennzeichen', value: kennzeichen, inline: true },
            { name: 'Xenon-Farbe', value: farbe, inline: true },
            { name: 'Bearbeitet von', value: `<@${user.id}>`, inline: true }
          )
          .setImage(bild.url)
          .setFooter({ text: `Dokumentations-ID: #${docId}` })
          .setTimestamp();

        // Ephemeral Bestaetigung
        await interaction.reply({ content: 'Dokumentation wurde erfasst!', ephemeral: true });

        // Im Xenon-Kanal posten
        try {
          const xenonChannel = await client.channels.fetch(XENON_CHANNEL_ID);
          if (xenonChannel) {
            await xenonChannel.send({ embeds: [embed] });
          }
        } catch (e) {
          console.error('Fehler beim Senden in Xenon-Kanal:', e);
        }
      } catch (error) {
        console.error(error);
        await interaction.reply({ content: 'Fehler beim Speichern der Dokumentation.', ephemeral: true });
      }
    }

    // ==================== EIGENTUNING ====================

    else if (commandName === 'eigentuning') {
      const rechnungssteller = options.getString('rechnungssteller');
      const einkaufspreis = options.getInteger('einkaufspreis');
      const rechnungshoehe = options.getInteger('rechnungshoehe');
      const displayName = member?.nickname || member?.nick || member?.displayName || user.tag;

      try {
        // In DB speichern
        const stmt = db.prepare(`
          INSERT INTO eigentuning (erstellt_von, erstellt_von_name, rechnungssteller, einkaufspreis, rechnungshoehe)
          VALUES (?, ?, ?, ?, ?)
        `);
        const result = stmt.run(user.id, displayName, rechnungssteller, einkaufspreis, rechnungshoehe);
        const docId = result.lastInsertRowid;

        // Embed erstellen
        const embed = new EmbedBuilder()
          .setTitle('Eigentuning Dokumentation')
          .setColor(COLORS.SUCCESS)
          .addFields(
            { name: 'Eigentuning von', value: displayName, inline: true },
            { name: 'Rechnungsausstellung von', value: rechnungssteller, inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
            { name: 'Einkaufspreis', value: `$${einkaufspreis.toLocaleString('de-DE')}`, inline: true },
            { name: 'Hoehe der ausgestellten Rechnung', value: `$${rechnungshoehe.toLocaleString('de-DE')}`, inline: true }
          )
          .setFooter({ text: `Dokumentations-ID: #${docId}` })
          .setTimestamp();

        // Logo laden
        let attachment = null;
        if (fs.existsSync(LOGO_PATH)) {
          attachment = new AttachmentBuilder(LOGO_PATH, { name: 'logo_firma.png' });
          embed.setThumbnail('attachment://logo_firma.png');
        }

        // Ephemeral Bestaetigung
        await interaction.reply({ content: 'Eigentuning wurde dokumentiert!', ephemeral: true });

        // Im selben Kanal posten
        const sendData = { embeds: [embed] };
        if (attachment) sendData.files = [attachment];
        await interaction.channel.send(sendData);

      } catch (error) {
        console.error(error);
        await interaction.reply({ content: 'Fehler beim Speichern des Eigentunings.', ephemeral: true });
      }
    }

    // ==================== SANKTIONSSYSTEM ====================

    else if (commandName === 'sanktion') {
      // Berechtigung pruefen
      if (!member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
        await interaction.reply({ content: 'Du hast keine Berechtigung fuer diesen Befehl.', ephemeral: true });
        return;
      }

      const targetUser = options.getUser('benutzer');
      const typ = options.getString('typ');
      const grund = options.getString('grund');
      const geldstrafe = options.getInteger('geldstrafe');

      // Ablaufdatum basierend auf Sanktionstyp berechnen
      let ablaufDatum = null;
      const now = new Date();

      if (typ === 'Suspendierung 1 Tag' || typ === 'Degradierung + 1 Tag Suspendierung') {
        now.setDate(now.getDate() + 1);
        ablaufDatum = now.toISOString();
      } else if (typ === 'Suspendierung 2 Tage') {
        now.setDate(now.getDate() + 2);
        ablaufDatum = now.toISOString();
      }

      try {
        const stmt = db.prepare(`
          INSERT INTO sanktionen (user_id, username, typ, grund, geldstrafe, ausgestellt_von, ausgestellt_von_name, ablauf_datum)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const result = stmt.run(targetUser.id, targetUser.tag, typ, grund, geldstrafe, user.id, user.tag, ablaufDatum);

        // Sanktions-Embed erstellen
        const embed = new EmbedBuilder()
          .setTitle('Sanktion ausgestellt')
          .setColor(COLORS.ERROR)
          .setThumbnail(targetUser.displayAvatarURL())
          .addFields(
            { name: 'Benutzer', value: `<@${targetUser.id}>`, inline: true },
            { name: 'Sanktionstyp', value: typ, inline: true },
            { name: 'Geldstrafe', value: `$${geldstrafe.toLocaleString('de-DE')}`, inline: true },
            { name: 'Grund', value: grund },
            { name: 'Ausgestellt von', value: `<@${user.id}>`, inline: true },
            { name: 'Sanktions-ID', value: `#${result.lastInsertRowid}`, inline: true }
          )
          .setTimestamp();

        if (ablaufDatum) {
          embed.addFields({ name: 'Suspendierung bis', value: formatDate(ablaufDatum), inline: true });
        }

        // Bestaetigung an den ausfuehrenden User
        await interaction.reply({ content: 'Sanktion wurde ausgestellt und im Sanktionskanal angekuendigt.', ephemeral: true });

        // Im Sanktionskanal ankuendigen
        try {
          const sanktionChannel = await client.channels.fetch(SANKTION_CHANNEL_ID);
          if (sanktionChannel) {
            await sanktionChannel.send({ embeds: [embed] });
          }
        } catch (e) {
          console.error('Fehler beim Senden in Sanktionskanal:', e);
        }
      } catch (error) {
        console.error(error);
        await interaction.reply({ content: 'Fehler beim Erstellen der Sanktion.', ephemeral: true });
      }
    }

    else if (commandName === 'sanktionen') {
      const targetUser = options.getUser('benutzer');

      try {
        let stmt, rows;

        if (targetUser) {
          stmt = db.prepare(`
            SELECT * FROM sanktionen
            WHERE user_id = ?
            ORDER BY erstellt_am DESC
            LIMIT 15
          `);
          rows = stmt.all(targetUser.id);
        } else {
          stmt = db.prepare(`
            SELECT * FROM sanktionen
            WHERE aktiv = 1
            ORDER BY erstellt_am DESC
            LIMIT 15
          `);
          rows = stmt.all();
        }

        if (rows.length === 0) {
          await interaction.reply({ content: 'Keine Sanktionen gefunden.', ephemeral: true });
          return;
        }

        const embed = new EmbedBuilder()
          .setTitle(targetUser ? `Sanktionen von ${targetUser.tag}` : 'Aktive Sanktionen')
          .setColor(COLORS.WARNING)
          .setTimestamp();

        rows.forEach(row => {
          const status = row.aktiv ? 'Aktiv' : 'Aufgehoben';
          const geldstrafeText = row.geldstrafe ? `$${row.geldstrafe.toLocaleString('de-DE')}` : '$0';
          embed.addFields({
            name: `#${row.id} - ${row.typ} [${status}]`,
            value: `**Benutzer:** ${row.username}\n**Grund:** ${row.grund}\n**Geldstrafe:** ${geldstrafeText}\n**Von:** ${row.ausgestellt_von_name}\n**Ablauf:** ${row.ablauf_datum ? formatDate(row.ablauf_datum) : '-'}`
          });
        });

        await interaction.reply({ embeds: [embed] });
      } catch (error) {
        console.error(error);
        await interaction.reply({ content: 'Fehler beim Abrufen der Sanktionen.', ephemeral: true });
      }
    }

    else if (commandName === 'sanktion-aufheben') {
      if (!member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
        await interaction.reply({ content: 'Du hast keine Berechtigung fuer diesen Befehl.', ephemeral: true });
        return;
      }

      const sanktionId = options.getInteger('id');

      try {
        const checkStmt = db.prepare('SELECT * FROM sanktionen WHERE id = ?');
        const sanktion = checkStmt.get(sanktionId);

        if (!sanktion) {
          await interaction.reply({ content: 'Sanktion nicht gefunden.', ephemeral: true });
          return;
        }

        const stmt = db.prepare('UPDATE sanktionen SET aktiv = 0 WHERE id = ?');
        stmt.run(sanktionId);

        const embed = new EmbedBuilder()
          .setTitle('Sanktion aufgehoben')
          .setColor(COLORS.SUCCESS)
          .addFields(
            { name: 'Sanktions-ID', value: `#${sanktionId}`, inline: true },
            { name: 'Benutzer', value: sanktion.username, inline: true },
            { name: 'Typ', value: sanktion.typ, inline: true },
            { name: 'Aufgehoben von', value: user.tag }
          )
          .setTimestamp();

        await interaction.reply({ embeds: [embed] });
      } catch (error) {
        console.error(error);
        await interaction.reply({ content: 'Fehler beim Aufheben der Sanktion.', ephemeral: true });
      }
    }

    // ==================== INFO BEFEHLE ====================

    else if (commandName === 'userinfo') {
      const targetUser = options.getUser('benutzer') || user;

      try {
        // Sanktionen zaehlen
        const sanktionenStmt = db.prepare('SELECT COUNT(*) as count FROM sanktionen WHERE user_id = ?');
        const sanktionenCount = sanktionenStmt.get(targetUser.id).count;

        const aktiveSanktionenStmt = db.prepare('SELECT COUNT(*) as count FROM sanktionen WHERE user_id = ? AND aktiv = 1');
        const aktiveSanktionen = aktiveSanktionenStmt.get(targetUser.id).count;

        // Abmeldungen zaehlen
        const abmeldungenStmt = db.prepare('SELECT COUNT(*) as count FROM abmeldungen WHERE user_id = ? AND aktiv = 1');
        const abmeldungenCount = abmeldungenStmt.get(targetUser.id).count;

        const embed = new EmbedBuilder()
          .setTitle(`Benutzerinfo: ${targetUser.tag}`)
          .setThumbnail(targetUser.displayAvatarURL())
          .setColor(COLORS.INFO)
          .addFields(
            { name: 'User ID', value: targetUser.id, inline: true },
            { name: 'Account erstellt', value: formatDate(targetUser.createdAt), inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
            { name: 'Aktive Abmeldungen', value: abmeldungenCount.toString(), inline: true },
            { name: 'Aktive Sanktionen', value: aktiveSanktionen.toString(), inline: true },
            { name: 'Sanktionen gesamt', value: sanktionenCount.toString(), inline: true }
          )
          .setTimestamp();

        await interaction.reply({ embeds: [embed] });
      } catch (error) {
        console.error(error);
        await interaction.reply({ content: 'Fehler beim Abrufen der Benutzerinfo.', ephemeral: true });
      }
    }
  }
  } catch (error) {
    console.error('Fehler im interactionCreate Handler:', error);
    // Versuche dem User eine Fehlermeldung zu senden
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: 'Ein unerwarteter Fehler ist aufgetreten.' });
      } else {
        await interaction.reply({ content: 'Ein unerwarteter Fehler ist aufgetreten.', ephemeral: true });
      }
    } catch (e) {
      // Ignorieren - Interaktion ist wahrscheinlich abgelaufen
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
