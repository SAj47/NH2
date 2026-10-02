const { test, describe, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { MessageFlags, PermissionFlagsBits: P } = require('discord.js');
const CONFIG = require('../config');
const { createWorld } = require('./helpers/fakeDiscord');
const { voiceApi, resolveTargetChannel, joinSilently, leave } = require('../features/voiceControl');
const joinCmd = require('../commands/join');
const leaveCmd = require('../commands/leave');

describe('/join و /leave (joinVoiceChannel مُستبدَل، بلا شبكة حقيقية)', () => {
    let w, joinCalls, connections;
    after(async () => { if (w) await w.close(); });
    beforeEach(async () => {
        if (w) await w.close();
        w = await createWorld(CONFIG);
        joinCalls = []; connections = new Map();
        mock.method(voiceApi, 'joinVoiceChannel', cfg => {
            joinCalls.push(cfg);
            const conn = { joinConfig: cfg, destroy: mock.fn(() => connections.delete(cfg.guildId)) };
            connections.set(cfg.guildId, conn); return conn;
        });
        mock.method(voiceApi, 'getVoiceConnection', gid => connections.get(gid));
    });

    const A = '920000000000000001', B = '920000000000000002';
    const putInVoice = (member, channelId) => w.guild.voiceStates._add({ user_id: member.id, channel_id: channelId, session_id: 's', deaf: false, mute: false, self_deaf: false, self_mute: false, suppress: false });
    const ix = ({ member, channelOption = null } = {}) => {
        const out = [];
        return { out, inGuild: () => true, guild: w.guild, member, user: member.user,
            options: { getChannel: () => channelOption },
            reply: async o => out.push(['reply', o]), deferReply: async o => out.push(['defer', o]), editReply: async o => out.push(['edit', o]) };
    };

    test('العضو في روم صوتي: /join بلا خيار ينضم إلى روم العضو', async () => {
        const m = w.addMember(); putInVoice(m, A);
        const i = ix({ member: m }); await joinCmd.execute(i);
        assert.equal(joinCalls.length, 1);
        assert.equal(joinCalls[0].channelId, A); assert.equal(joinCalls[0].guildId, w.GUILD);
        assert.equal(typeof joinCalls[0].adapterCreator, 'function');
        assert.equal(joinCalls[0].selfMute, true); assert.equal(joinCalls[0].selfDeaf, true);
        assert.match(i.out.find(([t]) => t === 'edit')[1].embeds[0].toJSON().description, /Joined/);
    });

    test('العضو ليس في روم ولم يحدد خياراً: رسالة واضحة، ولا اتصال', async () => {
        const m = w.addMember();
        const i = ix({ member: m }); await joinCmd.execute(i);
        assert.equal(joinCalls.length, 0); assert.match(i.out[0][1].content, /Join a voice channel first/);
    });

    test('تحديد روم بالخيار channel', async () => {
        const m = w.addMember();
        const i = ix({ member: m, channelOption: w.chan('Gaming VC') }); await joinCmd.execute(i);
        assert.equal(joinCalls[0].channelId, B);
    });

    test('لا صلاحية Connect: يرفض برسالة ولا يتصل', async () => {
        const w2 = await createWorld(CONFIG, { welcomeAccess: 'full', staffAccess: true });
        // نمنع البوت من صلاحية Connect عبر تصفير صلاحيات الرتبة (نفس منطق botPerms لكن أدق: نمرر عبر خيار الاختبار التالي)
        await w2.close();
        const w3 = await createWorld(CONFIG, { botPerms: 0n });
        const m = w3.addMember(); w3.guild.voiceStates._add({ user_id: m.id, channel_id: '920000000000000001', session_id: 's', deaf: false, mute: false, self_deaf: false, self_mute: false, suppress: false });
        const outs = []; const i = { inGuild: () => true, guild: w3.guild, member: m, user: m.user,
            options: { getChannel: () => null }, reply: async o => outs.push(['reply', o]),
            deferReply: async o => outs.push(['defer', o]), editReply: async o => outs.push(['edit', o]) };
        await joinCmd.execute(i);
        assert.match(outs.find(([t]) => t === 'edit')[1], /don't have permission/);
        await w3.close();
    });

    test('نداء ثانٍ لنفس الروم: "already in" بلا اتصال جديد', async () => {
        const m = w.addMember(); putInVoice(m, A);
        await joinCmd.execute(ix({ member: m }));
        const i2 = ix({ member: m }); await joinCmd.execute(i2);
        assert.equal(joinCalls.length, 1); assert.match(i2.out.find(([t]) => t === 'edit')[1].embeds[0].toJSON().description, /Already in/);
    });

    test('لا يشغّل أي صوت: selfMute و selfDeaf صحيحان دائماً', async () => {
        const m = w.addMember(); putInVoice(m, B);
        await joinCmd.execute(ix({ member: m }));
        assert.equal(joinCalls[0].selfMute, true); assert.equal(joinCalls[0].selfDeaf, true);
    });

    test('/leave: يقطع الاتصال الموجود', async () => {
        const m = w.addMember(); putInVoice(m, A);
        await joinCmd.execute(ix({ member: m }));
        const out = []; await leaveCmd.execute({ inGuild: () => true, guild: w.guild, reply: async o => out.push(o) });
        assert.equal(out[0].content, '👋 Left the voice channel.'); assert.equal(connections.has(w.GUILD), false);
    });

    test('/leave بلا اتصال أصلاً: رسالة واضحة', async () => {
        const out = []; await leaveCmd.execute({ inGuild: () => true, guild: w.guild, reply: async o => out.push(o) });
        assert.match(out[0].content, /not in a voice channel/);
    });

    test('كل ردود /join و /leave خاصة (ephemeral)', async () => {
        const m = w.addMember(); putInVoice(m, A);
        const i = ix({ member: m }); await joinCmd.execute(i);
        assert.equal(i.out[0][1].flags, MessageFlags.Ephemeral);
        const out = []; await leaveCmd.execute({ inGuild: () => true, guild: w.guild, reply: async o => out.push(o) });
        assert.equal(out[0].flags, MessageFlags.Ephemeral);
    });
});
