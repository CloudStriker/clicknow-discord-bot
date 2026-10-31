// Registers the slash commands with Discord. Run once after adding or
// changing commands:
//
//     npm run deploy-commands
//
// Global commands can take up to an hour to appear in every server; usually
// they show up within minutes. (Guild-specific registration is faster but
// needs a guild id — not worth it for a small personal bot.)

import { REST, Routes } from 'discord.js';

import { config } from './config.js';
import { commands } from './commands/index.js';

const body = commands.map((command) => command.data.toJSON());

const rest = new REST().setToken(config.token);

console.log(`Registering ${body.length} slash command(s)…`);
const data = await rest.put(Routes.applicationCommands(config.clientId), { body });
console.log(`✅ Registered ${data.length} global commands. Discord can take up to an hour to show updates.`);
