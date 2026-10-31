import { SlashCommandBuilder } from 'discord.js';
import { botChannelProblem } from './guard.js';

export default {
  data: new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Pause the current track'),

  async execute(interaction, ctx) {
    const player = ctx.players.for(interaction.guildId);
    const problem = botChannelProblem(interaction, player);
    if (problem) {
      await interaction.reply(problem);
      return;
    }

    const res = player.pause(interaction.user.tag);
    if (res === 'paused') {
      await player.refreshNowPlaying();
      await interaction.reply('⏸️ Paused.');
    } else if (res === 'already-paused') {
      await interaction.reply('Already paused 🙂');
    } else {
      await interaction.reply('Nothing is playing right now.');
    }
  },
};
