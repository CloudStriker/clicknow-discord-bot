import { SlashCommandBuilder } from 'discord.js';

import { classifyInput, discover } from '../ytdlp.js';

/** /play <query> — search text, a video URL, or a playlist URL. */
export default {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play from YouTube: paste a video/playlist URL or type words to search')
    .addStringOption((opt) =>
      opt
        .setName('query')
        .setDescription('Video URL, playlist URL, or search text')
        .setRequired(true),
    )
    .addIntegerOption((opt) =>
      opt
        .setName('grab_limit')
        .setDescription('How many tracks to take from a playlist (default 20)')
        .addChoices(
          { name: '20 tracks', value: 20 },
          { name: '50 tracks', value: 50 },
          { name: '100 tracks', value: 100 },
        ),
    ),

  async execute(interaction, ctx) {
    if (!interaction.member?.voice?.channel) {
      await interaction.reply('Join a voice channel first, then use /play 🙂');
      return;
    }

    // Discovery can take a few seconds — acknowledge right away.
    await interaction.deferReply();

    const text = interaction.options.getString('query', true);
    const grabLimit = interaction.options.getInteger('grab_limit') ?? 20;
    const classified = classifyInput(text); // search vs track vs playlist

    let tracks;
    try {
      tracks = await discover(classified, {
        text,
        grabLimit,
        requesterTag: interaction.user.tag,
        cookiesFile: ctx.config.cookiesFile,
        ytDlpPath: ctx.config.ytDlpPath,
      });
    } catch (err) {
      console.warn(`[/play] discovery failed: ${err.message}`);
      await interaction.editReply(
        err instanceof Error && err.name === 'YtDlpError'
          ? `Nothing found for "${text}" 🤔`
          : 'YouTube lookup failed — try again in a minute.',
      );
      return;
    }

    const result = await ctx.players.enqueue(interaction, tracks);
    await interaction.editReply(
      ctx.players.for(interaction.guildId).describeEnqueueResult(tracks, result) +
        (result.added > 1 ? ` (queue: ${result.queueLength})` : ''),
    );
  },
};
