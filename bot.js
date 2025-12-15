const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder } = require('discord.js');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// ==================== SINGLETON LOCK ====================
// Verhindert mehrere Bot-Instanzen gleichzeitig
const LOCK_FILE = path.join(__dirname, 'bot.lock');

function acquireLock() {
  try {
    // Prüfe ob Lock-Datei existiert
    if (fs.existsSync(LOCK_FILE)) {
      const lockData = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
      const lockPid = lockData.pid;
      const lockTime = lockData.timestamp;

      // Prüfe ob der Prozess noch läuft
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
  releaseLock();
  process.exit(1);
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

// Tuningchip Panel aktualisieren
async function updateTuningchipPanel(channel) {
  try {
    const embed = new EmbedBuilder()
      .setTitle('Tuningchip Dokumentation')
      .setDescription('Dokumentiere hier alle Tuningchip-Aenderungen an Fahrzeugen.\n\nKlicke auf den Button um eine neue Aenderung zu erfassen.')
      .setColor(COLORS.PANEL)
      .setThumbnail('attachment://logo_firma.png')
      .setTimestamp();

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('tuningchip_button')
          .setLabel('Tuningchip erfassen')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🔧')
      );

    // Logo laden
    let attachment = null;
    if (fs.existsSync(LOGO_PATH)) {
      attachment = new AttachmentBuilder(LOGO_PATH, { name: 'logo_firma.png' });
    }

    // Pruefe ob bereits ein Panel existiert - wenn ja, loesche es
    const panelStmt = db.prepare('SELECT * FROM panel_messages WHERE channel_id = ? AND typ = ?');
    const existingPanel = panelStmt.get(channel.id, 'tuningchip');

    if (existingPanel) {
      try {
        const oldMessage = await channel.messages.fetch(existingPanel.message_id);
        await oldMessage.delete();
      } catch (e) {
        // Nachricht existiert nicht mehr, ignorieren
      }
      db.prepare('DELETE FROM panel_messages WHERE id = ?').run(existingPanel.id);
    }

    // Neues Panel ganz unten erstellen
    const sendData = { embeds: [embed], components: [row] };
    if (attachment) sendData.files = [attachment];
    const message = await channel.send(sendData);

    // Panel-ID speichern
    db.prepare('INSERT INTO panel_messages (channel_id, message_id, typ) VALUES (?, ?, ?)').run(channel.id, message.id, 'tuningchip');

    return message;
  } catch (error) {
    console.error('Fehler beim Aktualisieren des Tuningchip-Panels:', error);
  }
}

// Stance Panel aktualisieren
async function updateStancePanel(channel) {
  try {
    const embed = new EmbedBuilder()
      .setTitle('Stance-Tuning Dokumentation')
      .setDescription('Dokumentiere hier alle Stance-Tuning Aenderungen an Fahrzeugen.\n\nKlicke auf den Button um eine neue Aenderung zu erfassen.')
      .setColor(COLORS.PANEL)
      .setThumbnail('attachment://logo_firma.png')
      .setTimestamp();

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('stance_button')
          .setLabel('Stance-Tuning erfassen')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🚗')
      );

    // Logo laden
    let attachment = null;
    if (fs.existsSync(LOGO_PATH)) {
      attachment = new AttachmentBuilder(LOGO_PATH, { name: 'logo_firma.png' });
    }

    // Pruefe ob bereits ein Panel existiert - wenn ja, loesche es
    const panelStmt = db.prepare('SELECT * FROM panel_messages WHERE channel_id = ? AND typ = ?');
    const existingPanel = panelStmt.get(channel.id, 'stance');

    if (existingPanel) {
      try {
        const oldMessage = await channel.messages.fetch(existingPanel.message_id);
        await oldMessage.delete();
      } catch (e) {
        // Nachricht existiert nicht mehr, ignorieren
      }
      db.prepare('DELETE FROM panel_messages WHERE id = ?').run(existingPanel.id);
    }

    // Neues Panel ganz unten erstellen
    const sendData = { embeds: [embed], components: [row] };
    if (attachment) sendData.files = [attachment];
    const message = await channel.send(sendData);

    // Panel-ID speichern
    db.prepare('INSERT INTO panel_messages (channel_id, message_id, typ) VALUES (?, ?, ?)').run(channel.id, message.id, 'stance');

    return message;
  } catch (error) {
    console.error('Fehler beim Aktualisieren des Stance-Panels:', error);
  }
}

// Xenon Panel aktualisieren
async function updateXenonPanel(channel) {
  try {
    const embed = new EmbedBuilder()
      .setTitle('Xenon-Tuning Dokumentation')
      .setDescription('Dokumentiere hier alle Xenon-Tuning Aenderungen an Fahrzeugen.\n\nKlicke auf den Button um eine neue Aenderung zu erfassen.')
      .setColor(COLORS.PANEL)
      .setThumbnail('attachment://logo_firma.png')
      .setTimestamp();

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('xenon_button')
          .setLabel('Xenon-Tuning erfassen')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('💡')
      );

    // Logo laden
    let attachment = null;
    if (fs.existsSync(LOGO_PATH)) {
      attachment = new AttachmentBuilder(LOGO_PATH, { name: 'logo_firma.png' });
    }

    // Pruefe ob bereits ein Panel existiert - wenn ja, loesche es
    const panelStmt = db.prepare('SELECT * FROM panel_messages WHERE channel_id = ? AND typ = ?');
    const existingPanel = panelStmt.get(channel.id, 'xenon');

    if (existingPanel) {
      try {
        const oldMessage = await channel.messages.fetch(existingPanel.message_id);
        await oldMessage.delete();
      } catch (e) {
        // Nachricht existiert nicht mehr, ignorieren
      }
      db.prepare('DELETE FROM panel_messages WHERE id = ?').run(existingPanel.id);
    }

    // Neues Panel ganz unten erstellen
    const sendData = { embeds: [embed], components: [row] };
    if (attachment) sendData.files = [attachment];
    const message = await channel.send(sendData);

    // Panel-ID speichern
    db.prepare('INSERT INTO panel_messages (channel_id, message_id, typ) VALUES (?, ?, ?)').run(channel.id, message.id, 'xenon');

    return message;
  } catch (error) {
    console.error('Fehler beim Aktualisieren des Xenon-Panels:', error);
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

  // Tuningchip-Panel (nur Panel aktualisieren, Dokumentationen bleiben)
  try {
    const channel = await client.channels.fetch(TUNINGCHIP_CHANNEL_ID);
    if (channel) {
      await updateTuningchipPanel(channel);
      console.log('Tuningchip-Panel aktualisiert/erstellt');
    }
  } catch (error) {
    console.error('Fehler beim Initialisieren des Tuningchip-Panels:', error);
  }

  // Stance-Panel (nur Panel aktualisieren, Dokumentationen bleiben)
  try {
    const channel = await client.channels.fetch(STANCE_CHANNEL_ID);
    if (channel) {
      await updateStancePanel(channel);
      console.log('Stance-Panel aktualisiert/erstellt');
    }
  } catch (error) {
    console.error('Fehler beim Initialisieren des Stance-Panels:', error);
  }

  // Xenon-Panel (nur Panel aktualisieren, Dokumentationen bleiben)
  try {
    const channel = await client.channels.fetch(XENON_CHANNEL_ID);
    if (channel) {
      await updateXenonPanel(channel);
      console.log('Xenon-Panel aktualisiert/erstellt');
    }
  } catch (error) {
    console.error('Fehler beim Initialisieren des Xenon-Panels:', error);
  }
});

client.on('interactionCreate', async interaction => {
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

    else if (interaction.customId === 'tuningchip_button') {
      // Modal fuer Tuningchip oeffnen
      const modal = new ModalBuilder()
        .setCustomId('tuningchip_modal')
        .setTitle('Tuningchip Dokumentation');

      const nameInput = new TextInputBuilder()
        .setCustomId('name')
        .setLabel('Name des Kunden')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Vor- und Nachname')
        .setRequired(true)
        .setMaxLength(100);

      const kennzeichenInput = new TextInputBuilder()
        .setCustomId('kennzeichen')
        .setLabel('Kennzeichen (6 Zeichen)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('z.B. ABC123')
        .setRequired(true)
        .setMinLength(6)
        .setMaxLength(6);

      const beschreibungInput = new TextInputBuilder()
        .setCustomId('beschreibung')
        .setLabel('Was wurde gemacht?')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Beschreibe die durchgefuehrten Aenderungen...')
        .setRequired(true)
        .setMaxLength(1000);

      modal.addComponents(
        new ActionRowBuilder().addComponents(nameInput),
        new ActionRowBuilder().addComponents(kennzeichenInput),
        new ActionRowBuilder().addComponents(beschreibungInput)
      );

      await interaction.showModal(modal);
    }

    else if (interaction.customId === 'stance_button') {
      // Modal fuer Stance-Tuning oeffnen
      const modal = new ModalBuilder()
        .setCustomId('stance_modal')
        .setTitle('Stance-Tuning Dokumentation');

      const nameInput = new TextInputBuilder()
        .setCustomId('name')
        .setLabel('Name des Kunden')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Vor- und Nachname')
        .setRequired(true)
        .setMaxLength(100);

      const kennzeichenInput = new TextInputBuilder()
        .setCustomId('kennzeichen')
        .setLabel('Kennzeichen (6 Zeichen)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('z.B. ABC123')
        .setRequired(true)
        .setMinLength(6)
        .setMaxLength(6);

      modal.addComponents(
        new ActionRowBuilder().addComponents(nameInput),
        new ActionRowBuilder().addComponents(kennzeichenInput)
      );

      await interaction.showModal(modal);
    }

    else if (interaction.customId === 'xenon_button') {
      // Modal fuer Xenon-Tuning oeffnen
      const modal = new ModalBuilder()
        .setCustomId('xenon_modal')
        .setTitle('Xenon-Tuning Dokumentation');

      const nameInput = new TextInputBuilder()
        .setCustomId('name')
        .setLabel('Name des Kunden')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Vor- und Nachname')
        .setRequired(true)
        .setMaxLength(100);

      const kennzeichenInput = new TextInputBuilder()
        .setCustomId('kennzeichen')
        .setLabel('Kennzeichen (6 Zeichen)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('z.B. ABC123')
        .setRequired(true)
        .setMinLength(6)
        .setMaxLength(6);

      const farbeInput = new TextInputBuilder()
        .setCustomId('farbe')
        .setLabel('Xenon-Farbe')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('z.B. Blau, Weiss, Gelb...')
        .setRequired(true)
        .setMaxLength(50);

      modal.addComponents(
        new ActionRowBuilder().addComponents(nameInput),
        new ActionRowBuilder().addComponents(kennzeichenInput),
        new ActionRowBuilder().addComponents(farbeInput)
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
        await interaction.reply({ content: 'Ungueltiges Datumsformat. Bitte verwende TT.MM.JJJJ', ephemeral: true });
        return;
      }

      if (bisDate < vonDate) {
        await interaction.reply({ content: 'Das Enddatum muss nach dem Startdatum liegen.', ephemeral: true });
        return;
      }

      try {
        const stmt = db.prepare(`
          INSERT INTO abmeldungen (user_id, username, grund, von, bis)
          VALUES (?, ?, ?, ?, ?)
        `);
        stmt.run(user.id, user.tag, grund, von, bis);

        // Nur ephemeral bestaetigen, keine sichtbare Nachricht
        await interaction.reply({
          content: `Deine Abmeldung vom ${formatDate(von)} bis ${formatDate(bis)} wurde erfasst.`,
          ephemeral: true
        });

        // Panel aktualisieren (loescht altes, erstellt neues unten)
        await updateAbmeldungsPanel(interaction.channel);

      } catch (error) {
        console.error(error);
        await interaction.reply({ content: 'Fehler beim Speichern der Abmeldung.', ephemeral: true });
      }
    }

    else if (interaction.customId === 'tuningchip_modal') {
      const name = interaction.fields.getTextInputValue('name');
      const kennzeichen = interaction.fields.getTextInputValue('kennzeichen').toUpperCase();
      const beschreibung = interaction.fields.getTextInputValue('beschreibung');
      const user = interaction.user;
      const channel = interaction.channel;

      // Buttons fuer Bild-Upload
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`tuningchip_bild_ja_${user.id}_${kennzeichen}`)
            .setLabel('Bild hochladen')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('📷'),
          new ButtonBuilder()
            .setCustomId(`tuningchip_bild_nein_${user.id}_${kennzeichen}`)
            .setLabel('Ohne Bild fortfahren')
            .setStyle(ButtonStyle.Secondary)
        );

      // Temporaer in DB speichern (ohne Bild)
      const stmt = db.prepare(`
        INSERT INTO tuningchip (name, kennzeichen, beschreibung, bild_url, erstellt_von, erstellt_von_name)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      const result = stmt.run(name, kennzeichen, beschreibung, null, user.id, user.tag);
      const docId = result.lastInsertRowid;

      await interaction.reply({
        content: `Moechtest du ein Bild hinzufuegen? Du hast 60 Sekunden Zeit.`,
        components: [row],
        ephemeral: true
      });

      // Button Collector
      const filter = i => i.user.id === user.id && i.customId.startsWith('tuningchip_bild_');
      const collector = interaction.channel.createMessageComponentCollector({ filter, time: 60000, max: 1 });

      collector.on('collect', async i => {
        if (i.customId.startsWith('tuningchip_bild_ja_')) {
          await i.update({ content: 'Bitte lade jetzt ein Bild hoch (einfach in den Chat einfuegen). Du hast 60 Sekunden.', components: [] });

          // Warte auf Bild-Nachricht
          const msgFilter = m => m.author.id === user.id && m.attachments.size > 0;
          const msgCollector = channel.createMessageCollector({ filter: msgFilter, time: 60000, max: 1 });

          msgCollector.on('collect', async msg => {
            const bildUrl = msg.attachments.first().url;
            // Bild-URL in DB updaten
            db.prepare('UPDATE tuningchip SET bild_url = ? WHERE id = ?').run(bildUrl, docId);
            // Nachricht loeschen
            try { await msg.delete(); } catch (e) {}

            // Embed erstellen und posten
            const embed = new EmbedBuilder()
              .setTitle('Tuningchip Dokumentation')
              .setColor(COLORS.SUCCESS)
              .addFields(
                { name: 'Kunde', value: name, inline: true },
                { name: 'Kennzeichen', value: kennzeichen, inline: true },
                { name: 'Bearbeitet von', value: `<@${user.id}>`, inline: true },
                { name: 'Durchgefuehrte Aenderungen', value: beschreibung }
              )
              .setImage(bildUrl)
              .setFooter({ text: `Dokumentations-ID: #${docId}` })
              .setTimestamp();

            await channel.send({ embeds: [embed] });
            await updateTuningchipPanel(channel);
          });

          msgCollector.on('end', async collected => {
            if (collected.size === 0) {
              // Timeout - ohne Bild posten
              const embed = new EmbedBuilder()
                .setTitle('Tuningchip Dokumentation')
                .setColor(COLORS.SUCCESS)
                .addFields(
                  { name: 'Kunde', value: name, inline: true },
                  { name: 'Kennzeichen', value: kennzeichen, inline: true },
                  { name: 'Bearbeitet von', value: `<@${user.id}>`, inline: true },
                  { name: 'Durchgefuehrte Aenderungen', value: beschreibung }
                )
                .setFooter({ text: `Dokumentations-ID: #${docId}` })
                .setTimestamp();

              await channel.send({ embeds: [embed] });
              await updateTuningchipPanel(channel);
            }
          });
        } else {
          // Ohne Bild fortfahren
          await i.update({ content: 'Dokumentation wird ohne Bild erstellt.', components: [] });

          const embed = new EmbedBuilder()
            .setTitle('Tuningchip Dokumentation')
            .setColor(COLORS.SUCCESS)
            .addFields(
              { name: 'Kunde', value: name, inline: true },
              { name: 'Kennzeichen', value: kennzeichen, inline: true },
              { name: 'Bearbeitet von', value: `<@${user.id}>`, inline: true },
              { name: 'Durchgefuehrte Aenderungen', value: beschreibung }
            )
            .setFooter({ text: `Dokumentations-ID: #${docId}` })
            .setTimestamp();

          await channel.send({ embeds: [embed] });
          await updateTuningchipPanel(channel);
        }
      });

      collector.on('end', async collected => {
        if (collected.size === 0) {
          // Timeout - ohne Bild posten
          const embed = new EmbedBuilder()
            .setTitle('Tuningchip Dokumentation')
            .setColor(COLORS.SUCCESS)
            .addFields(
              { name: 'Kunde', value: name, inline: true },
              { name: 'Kennzeichen', value: kennzeichen, inline: true },
              { name: 'Bearbeitet von', value: `<@${user.id}>`, inline: true },
              { name: 'Durchgefuehrte Aenderungen', value: beschreibung }
            )
            .setFooter({ text: `Dokumentations-ID: #${docId}` })
            .setTimestamp();

          await channel.send({ embeds: [embed] });
          await updateTuningchipPanel(channel);
        }
      });
    }

    else if (interaction.customId === 'stance_modal') {
      const name = interaction.fields.getTextInputValue('name');
      const kennzeichen = interaction.fields.getTextInputValue('kennzeichen').toUpperCase();
      const user = interaction.user;
      const channel = interaction.channel;

      // Buttons fuer Bild-Upload
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`stance_bild_ja_${user.id}_${kennzeichen}`)
            .setLabel('Bild hochladen')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('📷'),
          new ButtonBuilder()
            .setCustomId(`stance_bild_nein_${user.id}_${kennzeichen}`)
            .setLabel('Ohne Bild fortfahren')
            .setStyle(ButtonStyle.Secondary)
        );

      // In DB speichern (ohne Bild)
      const stmt = db.prepare(`
        INSERT INTO stance (name, kennzeichen, bild_url, erstellt_von, erstellt_von_name)
        VALUES (?, ?, ?, ?, ?)
      `);
      const result = stmt.run(name, kennzeichen, null, user.id, user.tag);
      const docId = result.lastInsertRowid;

      await interaction.reply({
        content: `Moechtest du ein Bild hinzufuegen? Du hast 60 Sekunden Zeit.`,
        components: [row],
        ephemeral: true
      });

      // Button Collector
      const filter = i => i.user.id === user.id && i.customId.startsWith('stance_bild_');
      const collector = interaction.channel.createMessageComponentCollector({ filter, time: 60000, max: 1 });

      collector.on('collect', async i => {
        if (i.customId.startsWith('stance_bild_ja_')) {
          await i.update({ content: 'Bitte lade jetzt ein Bild hoch (einfach in den Chat einfuegen). Du hast 60 Sekunden.', components: [] });

          // Warte auf Bild-Nachricht
          const msgFilter = m => m.author.id === user.id && m.attachments.size > 0;
          const msgCollector = channel.createMessageCollector({ filter: msgFilter, time: 60000, max: 1 });

          msgCollector.on('collect', async msg => {
            const bildUrl = msg.attachments.first().url;
            db.prepare('UPDATE stance SET bild_url = ? WHERE id = ?').run(bildUrl, docId);
            try { await msg.delete(); } catch (e) {}

            const embed = new EmbedBuilder()
              .setTitle('Stance-Tuning Dokumentation')
              .setColor(COLORS.SUCCESS)
              .addFields(
                { name: 'Kunde', value: name, inline: true },
                { name: 'Kennzeichen', value: kennzeichen, inline: true },
                { name: 'Bearbeitet von', value: `<@${user.id}>`, inline: true }
              )
              .setImage(bildUrl)
              .setFooter({ text: `Dokumentations-ID: #${docId}` })
              .setTimestamp();

            await channel.send({ embeds: [embed] });
            await updateStancePanel(channel);
          });

          msgCollector.on('end', async collected => {
            if (collected.size === 0) {
              const embed = new EmbedBuilder()
                .setTitle('Stance-Tuning Dokumentation')
                .setColor(COLORS.SUCCESS)
                .addFields(
                  { name: 'Kunde', value: name, inline: true },
                  { name: 'Kennzeichen', value: kennzeichen, inline: true },
                  { name: 'Bearbeitet von', value: `<@${user.id}>`, inline: true }
                )
                .setFooter({ text: `Dokumentations-ID: #${docId}` })
                .setTimestamp();

              await channel.send({ embeds: [embed] });
              await updateStancePanel(channel);
            }
          });
        } else {
          await i.update({ content: 'Dokumentation wird ohne Bild erstellt.', components: [] });

          const embed = new EmbedBuilder()
            .setTitle('Stance-Tuning Dokumentation')
            .setColor(COLORS.SUCCESS)
            .addFields(
              { name: 'Kunde', value: name, inline: true },
              { name: 'Kennzeichen', value: kennzeichen, inline: true },
              { name: 'Bearbeitet von', value: `<@${user.id}>`, inline: true }
            )
            .setFooter({ text: `Dokumentations-ID: #${docId}` })
            .setTimestamp();

          await channel.send({ embeds: [embed] });
          await updateStancePanel(channel);
        }
      });

      collector.on('end', async collected => {
        if (collected.size === 0) {
          const embed = new EmbedBuilder()
            .setTitle('Stance-Tuning Dokumentation')
            .setColor(COLORS.SUCCESS)
            .addFields(
              { name: 'Kunde', value: name, inline: true },
              { name: 'Kennzeichen', value: kennzeichen, inline: true },
              { name: 'Bearbeitet von', value: `<@${user.id}>`, inline: true }
            )
            .setFooter({ text: `Dokumentations-ID: #${docId}` })
            .setTimestamp();

          await channel.send({ embeds: [embed] });
          await updateStancePanel(channel);
        }
      });
    }

    else if (interaction.customId === 'xenon_modal') {
      const name = interaction.fields.getTextInputValue('name');
      const kennzeichen = interaction.fields.getTextInputValue('kennzeichen').toUpperCase();
      const farbe = interaction.fields.getTextInputValue('farbe');
      const user = interaction.user;
      const channel = interaction.channel;

      // Buttons fuer Bild-Upload
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`xenon_bild_ja_${user.id}_${kennzeichen}`)
            .setLabel('Bild hochladen')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('📷'),
          new ButtonBuilder()
            .setCustomId(`xenon_bild_nein_${user.id}_${kennzeichen}`)
            .setLabel('Ohne Bild fortfahren')
            .setStyle(ButtonStyle.Secondary)
        );

      // In DB speichern (ohne Bild)
      const stmt = db.prepare(`
        INSERT INTO xenon (name, kennzeichen, farbe, bild_url, erstellt_von, erstellt_von_name)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      const result = stmt.run(name, kennzeichen, farbe, null, user.id, user.tag);
      const docId = result.lastInsertRowid;

      await interaction.reply({
        content: `Moechtest du ein Bild hinzufuegen? Du hast 60 Sekunden Zeit.`,
        components: [row],
        ephemeral: true
      });

      // Button Collector
      const filter = i => i.user.id === user.id && i.customId.startsWith('xenon_bild_');
      const collector = interaction.channel.createMessageComponentCollector({ filter, time: 60000, max: 1 });

      collector.on('collect', async i => {
        if (i.customId.startsWith('xenon_bild_ja_')) {
          await i.update({ content: 'Bitte lade jetzt ein Bild hoch (einfach in den Chat einfuegen). Du hast 60 Sekunden.', components: [] });

          // Warte auf Bild-Nachricht
          const msgFilter = m => m.author.id === user.id && m.attachments.size > 0;
          const msgCollector = channel.createMessageCollector({ filter: msgFilter, time: 60000, max: 1 });

          msgCollector.on('collect', async msg => {
            const bildUrl = msg.attachments.first().url;
            db.prepare('UPDATE xenon SET bild_url = ? WHERE id = ?').run(bildUrl, docId);
            try { await msg.delete(); } catch (e) {}

            const embed = new EmbedBuilder()
              .setTitle('Xenon-Tuning Dokumentation')
              .setColor(COLORS.SUCCESS)
              .addFields(
                { name: 'Kunde', value: name, inline: true },
                { name: 'Kennzeichen', value: kennzeichen, inline: true },
                { name: 'Xenon-Farbe', value: farbe, inline: true },
                { name: 'Bearbeitet von', value: `<@${user.id}>`, inline: true }
              )
              .setImage(bildUrl)
              .setFooter({ text: `Dokumentations-ID: #${docId}` })
              .setTimestamp();

            await channel.send({ embeds: [embed] });
            await updateXenonPanel(channel);
          });

          msgCollector.on('end', async collected => {
            if (collected.size === 0) {
              const embed = new EmbedBuilder()
                .setTitle('Xenon-Tuning Dokumentation')
                .setColor(COLORS.SUCCESS)
                .addFields(
                  { name: 'Kunde', value: name, inline: true },
                  { name: 'Kennzeichen', value: kennzeichen, inline: true },
                  { name: 'Xenon-Farbe', value: farbe, inline: true },
                  { name: 'Bearbeitet von', value: `<@${user.id}>`, inline: true }
                )
                .setFooter({ text: `Dokumentations-ID: #${docId}` })
                .setTimestamp();

              await channel.send({ embeds: [embed] });
              await updateXenonPanel(channel);
            }
          });
        } else {
          await i.update({ content: 'Dokumentation wird ohne Bild erstellt.', components: [] });

          const embed = new EmbedBuilder()
            .setTitle('Xenon-Tuning Dokumentation')
            .setColor(COLORS.SUCCESS)
            .addFields(
              { name: 'Kunde', value: name, inline: true },
              { name: 'Kennzeichen', value: kennzeichen, inline: true },
              { name: 'Xenon-Farbe', value: farbe, inline: true },
              { name: 'Bearbeitet von', value: `<@${user.id}>`, inline: true }
            )
            .setFooter({ text: `Dokumentations-ID: #${docId}` })
            .setTimestamp();

          await channel.send({ embeds: [embed] });
          await updateXenonPanel(channel);
        }
      });

      collector.on('end', async collected => {
        if (collected.size === 0) {
          const embed = new EmbedBuilder()
            .setTitle('Xenon-Tuning Dokumentation')
            .setColor(COLORS.SUCCESS)
            .addFields(
              { name: 'Kunde', value: name, inline: true },
              { name: 'Kennzeichen', value: kennzeichen, inline: true },
              { name: 'Xenon-Farbe', value: farbe, inline: true },
              { name: 'Bearbeitet von', value: `<@${user.id}>`, inline: true }
            )
            .setFooter({ text: `Dokumentations-ID: #${docId}` })
            .setTimestamp();

          await channel.send({ embeds: [embed] });
          await updateXenonPanel(channel);
        }
      });
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
        stmt.run(user.id, user.tag, grund, von, bis);

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

    else if (commandName === 'tuningchip-panel') {
      if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({ content: 'Du hast keine Berechtigung fuer diesen Befehl.', ephemeral: true });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      try {
        await updateTuningchipPanel(interaction.channel);
        await interaction.editReply({ content: 'Tuningchip-Panel wurde erstellt/aktualisiert!' });
      } catch (error) {
        console.error(error);
        await interaction.editReply({ content: 'Fehler beim Erstellen des Tuningchip-Panels.' });
      }
    }

    else if (commandName === 'stance-panel') {
      if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({ content: 'Du hast keine Berechtigung fuer diesen Befehl.', ephemeral: true });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      try {
        await updateStancePanel(interaction.channel);
        await interaction.editReply({ content: 'Stance-Panel wurde erstellt/aktualisiert!' });
      } catch (error) {
        console.error(error);
        await interaction.editReply({ content: 'Fehler beim Erstellen des Stance-Panels.' });
      }
    }

    else if (commandName === 'xenon-panel') {
      if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({ content: 'Du hast keine Berechtigung fuer diesen Befehl.', ephemeral: true });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      try {
        await updateXenonPanel(interaction.channel);
        await interaction.editReply({ content: 'Xenon-Panel wurde erstellt/aktualisiert!' });
      } catch (error) {
        console.error(error);
        await interaction.editReply({ content: 'Fehler beim Erstellen des Xenon-Panels.' });
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
});

client.login(process.env.DISCORD_TOKEN);
