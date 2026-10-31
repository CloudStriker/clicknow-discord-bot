import { SlashCommandBuilder } from 'discord.js';
import { botChannelProblem } from './guard.js';

/** /skip — drop the current track, start the next one. */
export default {
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Skip the current track'),

  async execute(interaction, ctx) {
    const player = ctx.players.for(interaction.guildId);
    const problem = botChannelProblem(interaction, player);
    if (problem) {
      await interaction.reply(problem);
      return;
    }

    const skipped = ctx.players.skip(interaction.guildId);
    await interaction.reply(
      skipped ? '⏭️ Skipped.' : 'Nothing is playing right now.',
    );
  },
};
