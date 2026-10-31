import { SlashCommandBuilder } from 'discord.js';

/** /skip — drop the current track, start the next one. */
export default {
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Skip the current track'),

  async execute(interaction, ctx) {
    const player = ctx.players.for(interaction.guildId);

    if ((interaction.member?.voice?.channelId ?? null) !== player.channelId) {
      await interaction.reply(
        player.channelId
          ? "You're not in the bot's voice channel 🙂"
          : 'Nothing is playing right now.',
      );
      return;
    }

    const skipped = ctx.players.skip(interaction.guildId);
    await interaction.reply(
      skipped ? '⏭️ Skipped.' : 'Nothing is playing right now.',
    );
  },
};
