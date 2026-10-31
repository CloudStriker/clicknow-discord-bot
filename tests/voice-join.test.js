import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits } from 'discord.js';

import { GuildPlayer, VoiceJoinError, voicePermissionProblem } from '../src/players.js';

// Seen live: in a private voice channel the bot had no Connect permission,
// Discord silently ignored the join (connection stuck in "signalling"), and
// the bot replied "Queued…" while staying silent. These pin the fix: check
// permissions up front, and give up with a clear message if the connection
// never becomes ready.

const ALL = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.Connect,
  PermissionFlagsBits.Speak,
  PermissionFlagsBits.MoveMembers,
];

function fakeVoiceChannel({ granted = ALL, full = false } = {}) {
  const me = { id: 'bot-user-1' };
  return {
    id: 'private-vc',
    name: 'secret-room',
    full,
    guild: { id: 'guild-1', voiceAdapterCreator: () => ({}), members: { me } },
    members: new Map(),
    permissionsFor: (member) => {
      assert.equal(member, me, 'permissions are checked for the bot itself');
      return { has: (flag) => granted.includes(flag) };
    },
  };
}

function makePlayer({ waitReady = async () => {} } = {}) {
  const calls = { joined: 0 };
  const deps = {
    joinVoiceChannel: () => {
      calls.joined += 1;
      return { on() {}, subscribe() {}, destroy() {} };
    },
    createAudioPlayer: () => ({ on() {}, play() {}, stop() {}, removeAllListeners() {} }),
    waitReady,
    makeAudioResource: async () => ({ resource: {}, kill() {} }),
  };
  const player = new GuildPlayer(
    'guild-1',
    { user: { id: 'bot-user-1' }, channels: { cache: new Map() } },
    { get: (id) => ({ autoLeaveOn: true, silenceTimeoutMin: 5, volume: 100, guildId: id }), set() {} },
    { cookiesFile: null, ytDlpPath: 'yt-dlp' },
    deps,
  );
  return { player, calls };
}

const interactionIn = (channel) => ({
  guildId: 'guild-1',
  member: { voice: { channel } },
  channel: { send: async () => {} },
});
const track = { title: 'song', url: 'https://youtu.be/x', durationSec: 0, requesterTag: 'u' };

test('voicePermissionProblem: null when the bot may view, connect and speak', () => {
  assert.equal(voicePermissionProblem(fakeVoiceChannel()), null);
});

test('voicePermissionProblem: names every missing permission', () => {
  const channel = fakeVoiceChannel({ granted: [PermissionFlagsBits.ViewChannel] });
  assert.match(voicePermissionProblem(channel), /missing: Connect, Speak\)/);
});

test('voicePermissionProblem: a full channel needs Move Members', () => {
  const granted = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak];
  assert.match(voicePermissionProblem(fakeVoiceChannel({ granted, full: true })), /full/);
  assert.equal(voicePermissionProblem(fakeVoiceChannel({ full: true })), null);
});

test('enqueue refuses a channel the bot cannot join, without joining or queueing', async () => {
  const { player, calls } = makePlayer();
  const channel = fakeVoiceChannel({ granted: [PermissionFlagsBits.ViewChannel] });

  await assert.rejects(player.enqueue(interactionIn(channel), [track]), VoiceJoinError);
  assert.equal(calls.joined, 0);
  assert.equal(player.queue.length, 0);
});

test('enqueue gives up cleanly when the connection never becomes ready', async () => {
  const { player } = makePlayer({
    waitReady: async () => {
      throw new Error('The operation was aborted');
    },
  });

  await assert.rejects(player.enqueue(interactionIn(fakeVoiceChannel()), [track]), VoiceJoinError);
  assert.equal(player.channelId, null, 'half-open connection torn down');
  assert.equal(player.queue.length, 0);
});
