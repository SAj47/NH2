const { PermissionFlagsBits } = require('discord.js');
const { joinVoiceChannel, getVoiceConnection, VoiceConnectionStatus } = require('@discordjs/voice');

// مغلَّفة في كائن حتى تستطيع الاختبارات استبدالها بنسخة وهمية (لا اتصال شبكة حقيقي)
const voiceApi = { joinVoiceChannel, getVoiceConnection };

function resolveTargetChannel(interaction, member) {
    const requested = interaction.options.getChannel('channel');
    if (requested) return requested;
    return member.voice?.channel ?? null;
}

// ينضم إلى روم صوتي دون تشغيل أي صوت (self-mute + self-deaf: يبقى فقط في الروم)
async function joinSilently(channel) {
    const me = channel.guild.members.me ?? await channel.guild.members.fetchMe();
    const missing = channel.permissionsFor(me)?.missing([PermissionFlagsBits.Connect]) ?? ['Connect'];
    if (missing.length) return { ok: false, message: `❌ I don't have permission to join **${channel.name}** (missing ${missing.join(', ')}).` };

    const existing = voiceApi.getVoiceConnection(channel.guild.id);
    if (existing && existing.joinConfig.channelId === channel.id) {
        return { ok: true, alreadyThere: true, channel };
    }

    try {
        voiceApi.joinVoiceChannel({
            channelId: channel.id,
            guildId: channel.guild.id,
            adapterCreator: channel.guild.voiceAdapterCreator,
            selfMute: true,
            selfDeaf: true
        });
        return { ok: true, channel };
    } catch (err) {
        console.error(`❌ Failed to join voice channel "${channel.name}":`, err.message);
        return { ok: false, message: '❌ Could not join that voice channel.' };
    }
}

function leave(guild) {
    const connection = voiceApi.getVoiceConnection(guild.id);
    if (!connection) return { ok: false, message: "❌ I'm not in a voice channel here." };
    connection.destroy();
    return { ok: true };
}

module.exports = { voiceApi, resolveTargetChannel, joinSilently, leave, VoiceConnectionStatus };
