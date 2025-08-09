require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  StreamType,
} = require('@discordjs/voice');
const { spawn } = require('child_process');

const TOKEN = process.env.DISCORD_TOKEN;
const PORT = process.env.PORT;

const app = express();

// ====== EXPRESS ENDPOINTS ======
app.get('/', (req, res) => {
  res.send('✅ TikTok Discord Bot is running.');
});

let tiktokUrl = '';
let currentStreamUrl = '';
app.get('/status', (req, res) => {
  res.json({
    streaming: !!currentStreamUrl,
    tiktokUrl,
    currentStreamUrl,
  });
});

// ====== DISCORD BOT VARIABLES ======
let ffmpegProcess = null;
let player = createAudioPlayer();
let connection = null;
let isRestarting = false;

// ====== STREAM START FUNCTION ======
function startStream() {
  if (!tiktokUrl) return;

  console.log(`🎬 Extracting TikTok Live stream: ${tiktokUrl}`);
  const streamlink = spawn('streamlink', ['--stream-url', tiktokUrl, 'best']);

  let streamUrlBuffer = '';
  streamlink.stdout.on('data', (data) => {
    streamUrlBuffer += data.toString().trim();
  });

  streamlink.on('close', () => {
    if (!streamUrlBuffer.startsWith('http')) {
      console.log('❌ Stream URL not found. Retrying in 10s...');
      setTimeout(startStream, 10000);
      return;
    }

    currentStreamUrl = streamUrlBuffer;
    playStream();
  });

  streamlink.stderr.on('data', (data) => {
    console.error('Streamlink error:', data.toString());
  });
}

// ====== PLAY STREAM FUNCTION ======
function playStream() {
  console.log(`🎧 Playing stream from: ${currentStreamUrl}`);

  if (ffmpegProcess) ffmpegProcess.kill();

  ffmpegProcess = spawn('ffmpeg', [
    '-re',
    '-i', currentStreamUrl,
    '-analyzeduration', '0',
    '-loglevel', '0',
    '-f', 's16le',
    '-ar', '48000',
    '-ac', '2',
    'pipe:1',
  ]);

  ffmpegProcess.on('close', () => {
    console.log('⚠️ Stream stopped. Restarting in 10s...');
    if (!isRestarting) {
      isRestarting = true;
      setTimeout(() => {
        isRestarting = false;
        startStream();
      }, 10000);
    }
  });

  const resource = createAudioResource(ffmpegProcess.stdout, {
    inputType: StreamType.Raw,
  });
  player.play(resource);
}

// ====== DISCORD BOT START FUNCTION ======
function startBot() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });

  client.once('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
  });

  client.on('messageCreate', async (message) => {
    if (!message.content.startsWith('!playlive') || message.author.bot) return;

    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) return message.reply('❌ Join a voice channel first.');

    const args = message.content.split(' ');
    tiktokUrl = args[1];

    if (!tiktokUrl || !tiktokUrl.startsWith('http')) {
      return message.reply('❌ Invalid link.\nUsage: `!playlive https://www.tiktok.com/@user/live`');
    }

    connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: message.guild.id,
      adapterCreator: message.guild.voiceAdapterCreator,
    });

    connection.subscribe(player);
    startStream();

    message.reply(`🔊 Now streaming from: ${tiktokUrl}`);
  });

  client.login(TOKEN);
}

// ====== START EXPRESS FIRST ======
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Web server running on port ${PORT}`);
  setTimeout(startBot, 2000); // delay so Render detects the port
});

