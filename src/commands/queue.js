import { SlashCommandBuilder } from 'discord.js';

/** /queue — what is playing and what comes next. */
export default {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Show the current track and the queue'),

  async execute(interaction, ctx) {
    const player = ctx.players.for(interaction.guildId);

    if (player.queue.length === 0 && !player.nowPlaying) {
      await interaction.reply('The queue is empty. Add something with /play! 🎵');
      return;
    }

    const lines = [];
    const current = player.nowPlaying;
    if (current) {
      lines.push(`▶️ **${current.title}** *(now)*`);
    }

    const upcoming = Math.min(player.queue.length, 9);
    for (let i = 0; i < upcoming; i++) {
      const t = player.queue.peek(i);
      lines.push(`${i + 1}. **${t.title}**`);
    }
    if (player.queue.length > upcoming) {
      lines.push(`… and ${player.queue.length - upcoming} more`);
    }

    await interaction.reply(lines.join('\n'));
  },
};
