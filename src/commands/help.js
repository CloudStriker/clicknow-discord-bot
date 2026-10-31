import { SlashCommandBuilder } from 'discord.js';

import { commands } from './index.js';

/** /help — lists what the bot can do (built from the real command set). */
export default {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show everything this bot can do'),

  async execute(interaction) {
    // Built from the registered command list so /help can never drift out
    // of sync when new commands are added.
    const lines = ['🎼 **ClickNow-Discord-Bot — commands**', ''];

    for (const command of commands) {
      lines.push(`/\`${command.data.name}\` — ${command.data.description}`);
    }

    lines.push('');
    lines.push('Tips: playlist? paste its URL in /play · listeners can mix their');

    lines.push(' own loudness via right-click on the bot → User Volume.');

    await interaction.reply(lines.join('\n'));
  },
};
