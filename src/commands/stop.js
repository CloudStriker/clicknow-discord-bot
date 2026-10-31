import { SlashCommandBuilder } from 'discord.js';

/** /stop — clear the queue and leave the voice channel. */
export default {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop playing, clear the queue, and leave voice'),

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

    ctx.players.stop(interaction.guildId);
    await interaction.reply('⏹️ Stopped — queue cleared, leaving voice. Bye! 👋');
  },
};
