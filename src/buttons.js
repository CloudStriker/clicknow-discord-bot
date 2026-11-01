import { CONTROL_IDS, buildControls, queuePageContent } from './controls.js';
import { botChannelProblem } from './commands/guard.js';

/**
 * Handle a playback button interaction (ctl:pause, ctl:skip, ctl:stop, ctl:loop, ctl:queue).
 *
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {{players: import('./players.js').GuildPlayers}} ctx
 */
export async function handleControlButton(interaction, ctx) {
  const player = ctx.players.for(interaction.guildId);
  const problem = botChannelProblem(interaction, player);
  if (problem) {
    await interaction.reply({ content: problem, ephemeral: true });
    return;
  }

  // Spec #3: only the newest Now-playing message has working Controls. A
  // press on an older message (its disable edit failed or raced) is ignored,
  // never allowed to resurrect dead controls next to the live ones.
  if (interaction.message.id !== player.nowPlayingMessageId) {
    await interaction.reply({
      content: 'Those controls are out of date — use /nowplaying for fresh ones.',
      ephemeral: true,
    });
    return;
  }

  const { customId } = interaction;

  if (customId === CONTROL_IDS.pause) {
    if (player.paused) {
      player.resume();
    } else {
      player.pause(interaction.user.tag);
    }
    await interaction.update(player.nowPlayingPayload());
    return;
  }

  if (customId === CONTROL_IDS.loop) {
    player.cycleLoopMode();
    await interaction.update(player.nowPlayingPayload());
    return;
  }

  if (customId === CONTROL_IDS.skip) {
    await interaction.deferUpdate();
    ctx.players.skip(interaction.guildId);
    return;
  }

  if (customId === CONTROL_IDS.stop) {
    const disabled = buildControls({
      paused: player.paused,
      loopMode: player.loopMode,
      disabled: true,
    });
    await interaction.update({
      content: `⏹️ Stopped by ${interaction.user.tag}`,
      components: disabled,
    });
    ctx.players.stop(interaction.guildId);
    return;
  }

  if (customId === CONTROL_IDS.queue) {
    const content = queuePageContent({
      current: player.nowPlaying,
      queue: player.queue,
      page: 1,
    });
    await interaction.reply({ content, ephemeral: true });
    return;
  }
}
