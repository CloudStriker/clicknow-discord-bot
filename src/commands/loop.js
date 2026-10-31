import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { botChannelProblem } from './guard.js';

const DESCRIPTIONS = {
  off: 'normal playback.',
  track: 'repeating the current track.',
  queue: 'repeating the queue.',
};

export default {
  data: new SlashCommandBuilder()
    .setContexts(InteractionContextType.Guild)
    .setName('loop')
    .setDescription('Change the loop mode for this server')
    .addStringOption((opt) =>
      opt
        .setName('mode')
        .setDescription('Loop mode')
        .setRequired(true)
        .addChoices(
          { name: 'off', value: 'off' },
          { name: 'track', value: 'track' },
          { name: 'queue', value: 'queue' },
        ),
    ),

  async execute(interaction, ctx) {
    const player = ctx.players.for(interaction.guildId);
    const problem = botChannelProblem(interaction, player);
    if (problem) {
      await interaction.reply(problem);
      return;
    }

    const mode = interaction.options.getString('mode', true);
    player.setLoopMode(mode);
    await player.refreshNowPlaying?.();

    const emoji = mode === 'track' ? '🔂' : '🔁';
    await interaction.reply(`${emoji} Loop: **${mode}** — ${DESCRIPTIONS[mode] ?? mode}`);
  },
};
