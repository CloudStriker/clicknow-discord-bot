// Entry point: starts the Discord client and wires everything together.
//
// Run with:
//     npm start            (production / in Docker)
//     npm run dev          (local, auto-restart on file changes)
//
// Secrets come from .env — see README "Create the Discord app".

import { Client, Events, GatewayIntentBits, REST, Routes } from 'discord.js';

import { config } from './config.js';
import { SettingsStore } from './settings.js';
import { GuildPlayers } from './players.js';
import { commands, createCtx } from './commands/index.js';

// ── managers ──────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, // slash commands, guild/channel caches
    GatewayIntentBits.GuildVoiceStates, // who is in voice (needed by players)
  ],
});

const settings = new SettingsStore(config.settingsPath);
const players = new GuildPlayers(client, settings, config);
const ctx = createCtx({ players, settings, config });

// ── events ────────────────────────────────────────────────────────────
client.once(Events.ClientReady, async (ready) => {
  console.log(`✅ Logged in as ${ready.user.tag}`);
  console.log(`   Settings file: ${config.settingsPath}`);

  // Register slash commands on every boot (idempotent) so a fresh Docker
  // deploy always has commands — no separate step to forget.
  try {
    const rest = new REST().setToken(config.token);
    const body = commands.map((c) => c.data.toJSON());
    await rest.put(Routes.applicationCommands(config.clientId), { body });
    console.log(`✅ ${body.length} slash command(s) registered`);
  } catch (err) {
    console.error(`⚠️ Slash command registration failed: ${err.message}`);
  }

  // Safety net for "everyone left the channel" — runs once a minute.
  setInterval(() => players.housekeeping(), 60_000);
  ready.user.setActivity('your music requests 🎵', { type: 4 });
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = commands.find((c) => c.data.name === interaction.commandName);
  if (!command) return;

  const args = interaction.options.data.map((o) => `${o.name}=${o.value}`).join(' ');
  console.log(`[/${interaction.commandName}] ${args} (by ${interaction.user.tag})`);

  try {
    await command.execute(interaction, ctx);
  } catch (err) {
    if (err?.message === 'NOT_IN_VOICE') {
      await safeReply(interaction, 'Join a voice channel first 🙂');
      return;
    }
    console.error(`[/${interaction.commandName}]`, err);
    await safeReply(interaction, 'Something went wrong — check the server logs.');
  }
});

// Voice state updates drive auto-leave ("everyone left").
client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  try {
    players.onVoiceUpdate(oldState, newState);
  } catch (err) {
    console.error('[voice-state]', err);
  }
});

// Never let a stray error kill the container (Review-focus #1 spirit:
// the process going down is the one bug we cannot recover from).
process.on('uncaughtException', (err) => console.error('[uncaught]', err));
process.on('unhandledRejection', (err) => console.error('[unhandled]', err));

async function safeReply(interaction, message) {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: message, ephemeral: true });
    } else {
      await interaction.reply({ content: message, ephemeral: true });
    }
  } catch (replyErr) {
    console.error('[reply]', replyErr.message);
  }
}

client.login(config.token);
