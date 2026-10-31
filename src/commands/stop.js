import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { botChannelProblem } from './guard.js';

/** /stop — clear the queue and leave the voice channel. */
export default {
  data: new SlashCommandBuilder()
    .setContexts(InteractionContextType.Guild)
    .setName('stop')
    .setDescription('Stop playing, clear the queue, and leave voice'),

  async execute(interaction, ctx) {
    const player = ctx.players.for(interaction.guildId);
    const problem = botChannelProblem(interaction, player);
    if (problem) {
      await interaction.reply(problem);
      return;
    }

    ctx.players.stop(interaction.guildId);
    await interaction.reply('⏹️ Stopped — queue cleared, leaving voice. Bye! 👋');
  },
};
