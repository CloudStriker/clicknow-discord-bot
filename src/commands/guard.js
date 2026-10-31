/**
 * Reusable check: is the user in the same voice channel as the bot?
 *
 * Used by control commands (/pause, /skip, /stop…) and button clicks.
 * Returns a human-friendly string if there is a problem, or null if fine.
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {import('../players.js').GuildPlayer} player
 * @returns {string|null}
 */
export function botChannelProblem(interaction, player) {
  if (!player.channelId) {
    return 'Nothing is playing right now.';
  }
  const userChannelId = interaction.member?.voice?.channelId ?? null;
  if (userChannelId !== player.channelId) {
    return "You're not in the bot's voice channel 🙂";
  }
  return null;
}
