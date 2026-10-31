import { SlashCommandBuilder } from 'discord.js';
import { botChannelProblem } from './guard.js';

export default {
  data: new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Resume the paused track'),

  async execute(interaction, ctx) {
    const player = ctx.players.for(interaction.guildId);
    const problem = botChannelProblem(interaction, player);
    if (problem) {
      await interaction.reply(problem);
      return;
    }

    const res = player.resume();
    if (res === 'resumed') {
      await player.refreshNowPlaying();
      await interaction.reply('▶️ Resumed.');
    } else if (res === 'not-paused') {
      await interaction.reply("It's not paused 🙂");
    } else {
      await interaction.reply('Nothing is playing right now.');
    }
  },
};
