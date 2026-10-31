import { SlashCommandBuilder } from 'discord.js';

/** /volume 1–100 — 100 is full source loudness (above 100 would distort). */
export default {
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Set playback volume for this server (1–100%)')
    .addIntegerOption((opt) =>
      opt
        .setName('level')
        .setDescription('Percent loudness; 100 is the maximum clean level')
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true),
    ),

  async execute(interaction, ctx) {
    const level = interaction.options.getInteger('level', true);
    ctx.players.setVolume(interaction.guildId, level); // saved per guild
    await interaction.reply(`🔊 Volume set to **${level}%** (saved for this server).`);
  },
};
