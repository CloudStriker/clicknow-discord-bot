import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { botChannelProblem } from './guard.js';

export default {
  data: new SlashCommandBuilder()
    .setContexts(InteractionContextType.Guild)
    .setName('remove')
    .setDescription('Remove a track from the queue by its position')
    .addIntegerOption((opt) =>
      opt
        .setName('position')
        .setDescription('Track position in /queue (1 = next track)')
        .setMinValue(1)
        .setRequired(true),
    ),

  async execute(interaction, ctx) {
    const player = ctx.players.for(interaction.guildId);
    const problem = botChannelProblem(interaction, player);
    if (problem) {
      await interaction.reply(problem);
      return;
    }

    const pos = interaction.options.getInteger('position', true);
    const removed = player.removeAt(pos);

    if (!removed) {
      await interaction.reply(
        `There is no track #${pos} — the queue has ${player.queue.length} track(s). See /queue.`,
      );
      return;
    }

    await interaction.reply(`🗑️ Removed #${pos} **${removed.title}**.`);
  },
};
