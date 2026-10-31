import { SlashCommandBuilder } from 'discord.js';

/**
 * /settings — per-guild configuration, saved in settings.json.
 * With no options, shows the current values.
 */
export default {
  data: new SlashCommandBuilder()
    .setName('settings')
    .setDescription('Show or change this server’s bot settings')
    .addStringOption((opt) =>
      opt
        .setName('leave')
        .setDescription('Auto-leave: leave voice when nobody is left / silence timeout')
        .addChoices(
          { name: 'on', value: 'on' },
          { name: 'off', value: 'off' },
        ),
    )
    .addIntegerOption((opt) =>
      opt
        .setName('timeout')
        .setDescription('Silence timeout in minutes before leaving (1–30)')
        .setMinValue(1)
        .setMaxValue(30),
    ),

  async execute(interaction, ctx) {
    const leave = interaction.options.getString('leave');
    const timeout = interaction.options.getInteger('timeout');

    if (leave === null && timeout === null) {
      const s = ctx.settings.get(interaction.guildId);
      await interaction.reply(
        [
          '⚙️ **Settings for this server**',
          `• Auto-leave: **${s.autoLeaveOn ? 'on' : 'off'}**`,
          `• Silence timeout: **${s.silenceTimeoutMin} min**`,
          `• Volume: **${s.volume}%**`,
          '',
          'Change with `/settings leave:<on|off> timeout:<minutes>`.',
        ].join('\n'),
      );
      return;
    }

    const patch = {};
    if (leave !== null) patch.autoLeaveOn = leave === 'on';
    if (timeout !== null) patch.silenceTimeoutMin = timeout;
    ctx.settings.set(interaction.guildId, patch);

    const s = ctx.settings.get(interaction.guildId);
    await interaction.reply(
      [
        '⚙️ Settings saved:',
        `• Auto-leave: **${s.autoLeaveOn ? 'on' : 'off'}**`,
        `• Silence timeout: **${s.silenceTimeoutMin} min**`,
      ].join('\n'),
    );
  },
};
