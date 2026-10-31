import { SlashCommandBuilder } from 'discord.js';
import { queuePageContent } from '../controls.js';

/** /queue — what is playing and what comes next. */
export default {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Show the current track and the queue')
    .addIntegerOption((opt) =>
      opt
        .setName('page')
        .setDescription('Page number to view (10 tracks per page)')
        .setMinValue(1),
    ),

  async execute(interaction, ctx) {
    const player = ctx.players.for(interaction.guildId);
    const page = interaction.options.getInteger('page') ?? 1;

    const content = queuePageContent({
      current: player.nowPlaying,
      queue: player.queue,
      page,
    });

    await interaction.reply(content);
  },
};
