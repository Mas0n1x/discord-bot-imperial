const fs = require('fs');
const path = require('path');
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

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

const commands = [
  // ==================== ABMELDUNGSSYSTEM ====================
  new SlashCommandBuilder()
    .setName('abmelden')
    .setDescription('Melde dich fuer einen Zeitraum ab')
    .addStringOption(option =>
      option.setName('grund')
        .setDescription('Grund fuer die Abmeldung')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('von')
        .setDescription('Startdatum (YYYY-MM-DD)')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('bis')
        .setDescription('Enddatum (YYYY-MM-DD)')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('abmeldungen')
    .setDescription('Zeige aktive Abmeldungen an')
    .addUserOption(option =>
      option.setName('benutzer')
        .setDescription('Abmeldungen eines bestimmten Benutzers anzeigen')
        .setRequired(false)),

  new SlashCommandBuilder()
    .setName('abmeldung-loeschen')
    .setDescription('Loesche eine Abmeldung')
    .addIntegerOption(option =>
      option.setName('id')
        .setDescription('ID der Abmeldung')
        .setRequired(true)),

  // ==================== SANKTIONSSYSTEM ====================
  new SlashCommandBuilder()
    .setName('sanktion')
    .setDescription('Erteile eine Sanktion an einen Benutzer')
    .addUserOption(option =>
      option.setName('benutzer')
        .setDescription('Der zu sanktionierende Benutzer')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('typ')
        .setDescription('Art der Sanktion')
        .setRequired(true)
        .addChoices(
          { name: 'Warn 1', value: 'Warn 1' },
          { name: 'Warn 2', value: 'Warn 2' },
          { name: 'Suspendierung (1 Tag)', value: 'Suspendierung 1 Tag' },
          { name: 'Suspendierung (2 Tage)', value: 'Suspendierung 2 Tage' },
          { name: 'Degradierung', value: 'Degradierung' },
          { name: 'Degradierung + 1 Tag Suspendierung', value: 'Degradierung + 1 Tag Suspendierung' },
          { name: 'Kuendigung', value: 'Kuendigung' }
        ))
    .addStringOption(option =>
      option.setName('grund')
        .setDescription('Grund fuer die Sanktion')
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('geldstrafe')
        .setDescription('Hoehe der Geldstrafe in $')
        .setRequired(true)
        .setMinValue(0)),

  new SlashCommandBuilder()
    .setName('sanktionen')
    .setDescription('Zeige Sanktionen an')
    .addUserOption(option =>
      option.setName('benutzer')
        .setDescription('Sanktionen eines bestimmten Benutzers anzeigen')
        .setRequired(false)),

  new SlashCommandBuilder()
    .setName('sanktion-aufheben')
    .setDescription('Hebe eine Sanktion auf')
    .addIntegerOption(option =>
      option.setName('id')
        .setDescription('ID der Sanktion')
        .setRequired(true)),

  // ==================== INFO ====================
  new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Zeige Informationen ueber einen Benutzer')
    .addUserOption(option =>
      option.setName('benutzer')
        .setDescription('Der Benutzer')
        .setRequired(false)),

  // ==================== PANEL ====================
  new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Erstelle/Aktualisiere das Abmeldungs-Panel im aktuellen Kanal'),

  new SlashCommandBuilder()
    .setName('tuningchip-panel')
    .setDescription('Erstelle/Aktualisiere das Tuningchip-Panel im aktuellen Kanal'),

  new SlashCommandBuilder()
    .setName('stance-panel')
    .setDescription('Erstelle/Aktualisiere das Stance-Tuning-Panel im aktuellen Kanal'),

  new SlashCommandBuilder()
    .setName('xenon-panel')
    .setDescription('Erstelle/Aktualisiere das Xenon-Tuning-Panel im aktuellen Kanal'),
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Starte Registrierung der Slash-Commands...');

    if (process.env.GUILD_ID) {
      // Server-spezifische Commands (schneller zum Testen)
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
        { body: commands }
      );
      console.log(`Commands fuer Server ${process.env.GUILD_ID} registriert!`);
    } else {
      // Globale Commands (kann bis zu 1 Stunde dauern)
      await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: commands }
      );
      console.log('Globale Commands registriert!');
    }

    console.log('Slash-Commands erfolgreich registriert!');
  } catch (error) {
    console.error('Fehler beim Registrieren der Commands:', error);
  }
})();
