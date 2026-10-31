import { SlashCommandBuilder } from 'discord.js';

import { VoiceJoinError, voicePermissionProblem } from '../players.js';
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
    const voiceChannel = interaction.member?.voice?.channel;
    if (!voiceChannel) {
      await interaction.reply('Join a voice channel first, then use /play 🙂');
      return;
    }

    // Fail fast (before the YouTube lookup) when the bot can't join, e.g. a
    // private channel that doesn't allow the bot.
    const problem = voicePermissionProblem(voiceChannel);
    if (problem) {
      await interaction.reply(`🔒 ${problem}`);
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

    let result;
    try {
      result = await ctx.players.enqueue(interaction, tracks);
    } catch (err) {
      if (err instanceof VoiceJoinError) {
        await interaction.editReply(`🔒 ${err.message}`);
        return;
      }
      throw err;
    }
    const player = ctx.players.for(interaction.guildId);
    let reply =
      player.describeEnqueueResult(tracks, result) +
      (result.added > 1 ? ` (queue: ${result.queueLength})` : '');
    if (player.paused) {
      reply += '\n⏸️ Playback is paused — press ▶️ to resume.';
    }
    await interaction.editReply(reply);
  },
};
