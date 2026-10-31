import { SlashCommandBuilder } from 'discord.js';
import { botChannelProblem } from './guard.js';

export default {
  data: new SlashCommandBuilder()
    .setName('shuffle')
    .setDescription('Shuffle the waiting tracks in the queue'),

  async execute(interaction, ctx) {
    const player = ctx.players.for(interaction.guildId);
    const problem = botChannelProblem(interaction, player);
    if (problem) {
      await interaction.reply(problem);
      return;
    }

    if (player.queue.length === 0) {
      await interaction.reply('The queue is empty — nothing to shuffle.');
      return;
    }

    const count = player.shuffle();
    await interaction.reply(`🔀 Shuffled **${count}** track(s).`);
  },
};
