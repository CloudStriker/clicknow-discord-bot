import { InteractionContextType, SlashCommandBuilder } from 'discord.js';

// No voice-channel check here (on purpose): /nowplaying only posts a
// message, it doesn't control playback — and every button on it is guarded
// separately by src/buttons.js (same-voice + newest-message checks).

export default {
  data: new SlashCommandBuilder()
    .setContexts(InteractionContextType.Guild)
    .setName('nowplaying')
    .setDescription('Show what is playing right now with controls'),

  async execute(interaction, ctx) {
    const player = ctx.players.for(interaction.guildId);
    const posted = await player.postNowPlaying(interaction.channel);

    if (posted) {
      await interaction.reply({ content: 'Posted below 👇', ephemeral: true });
    } else {
      await interaction.reply({ content: 'Nothing is playing right now.', ephemeral: true });
    }
  },
};
