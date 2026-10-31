import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { botChannelProblem } from './guard.js';

export default {
  data: new SlashCommandBuilder()
    .setContexts(InteractionContextType.Guild)
    .setName('clear')
    .setDescription('Clear the queue (the current track keeps playing)'),

  async execute(interaction, ctx) {
    const player = ctx.players.for(interaction.guildId);
    const problem = botChannelProblem(interaction, player);
    if (problem) {
      await interaction.reply(problem);
      return;
    }

    const removed = player.clearQueue();
    if (removed === 0) {
      await interaction.reply('The queue is already empty.');
      return;
    }

    await interaction.reply(`🧹 Cleared ${removed} track(s). The current track keeps playing.`);
  },
};
