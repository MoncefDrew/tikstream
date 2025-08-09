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
const PORT = process.env.PORT || 10000;
const BASE_URL = process.env.BASE_URL;

const app = express();

app.get('/', (req, res) => {
  res.send('✅ TikTok Discord Bot is running.');
});

let tiktokUrl = '';
let currentStreamUrl = '';
let streamExpiry = 0;

app.get('/status', (req, res) => {
  res.json({
    streaming: !!currentStreamUrl,
    tiktokUrl,
    currentStreamUrl,
    streamExpiry,
    now: Math.floor(Date.now() / 1000),
  });
});

// Discord + streaming state
let ffmpegProcess = null;
let player = createAudioPlayer();
let connection = null;
let isRestarting = false;

let inactivityTimeout = null; // timeout to detect stream blocks
const INACTIVITY_LIMIT_MS = 30000; // 30 seconds no data means blocked

function resetInactivityTimeout() {
  if (inactivityTimeout) clearTimeout(inactivityTimeout);
  inactivityTimeout = setTimeout(() => {
    console.error('⚠️ Stream inactive for 30s. Restarting bot...');
    restartBot();
  }, INACTIVITY_LIMIT_MS);
}

function restartBot() {
  console.log('🛑 Restarting bot...');

  if (ffmpegProcess) {
    ffmpegProcess.kill('SIGKILL');
    ffmpegProcess = null;
  }
  currentStreamUrl = '';
  streamExpiry = 0;
  isRestarting = false;

  if (connection) {
    connection.destroy();
    connection = null;
  }

  player.stop();

  if (tiktokUrl) {
    startStream();
  } else {
    console.log('No TikTok URL set, bot idle.');
  }
}

function getExpiryFromUrl(url) {
  try {
    const urlObj = new URL(url);
    const expiresParam = urlObj.searchParams.get('expires');
    return expiresParam ? Number(expiresParam) : 0;
  } catch {
    return 0;
  }
}

function startStream() {
  if (!tiktokUrl) return;

  const now = Math.floor(Date.now() / 1000);
  if (currentStreamUrl && streamExpiry > now + 10) {
    console.log('🟢 Current stream URL still valid, no need to refresh.');
    return;
  }

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
    streamExpiry = getExpiryFromUrl(currentStreamUrl);
    console.log(`⏰ Stream URL expires at Unix timestamp: ${streamExpiry}`);

    playStream();
  });

  streamlink.stderr.on('data', (data) => {
    console.error('Streamlink error:', data.toString());
  });
}

function playStream() {
  console.log(`🎧 Playing stream from: ${currentStreamUrl}`);

  if (ffmpegProcess) {
    console.log('Killing previous ffmpeg process');
    ffmpegProcess.kill('SIGKILL');
  }

  ffmpegProcess = spawn('ffmpeg', [
    '-re',
    '-i', currentStreamUrl,
    '-analyzeduration', '0',
    '-loglevel', 'quiet',
    '-f', 's16le',
    '-ar', '48000',
    '-ac', '2',
    'pipe:1',
  ]);

  // Reset inactivity timer on data flow
  ffmpegProcess.stdout.on('data', () => {
    resetInactivityTimeout();
  });

  ffmpegProcess.stderr.on('data', (data) => {
    console.error('FFmpeg stderr:', data.toString());
  });

  ffmpegProcess.on('error', (error) => {
    console.error('FFmpeg error:', error);
  });

  ffmpegProcess.on('exit', (code, signal) => {
    console.log(`FFmpeg exited with code ${code}, signal ${signal}`);
  });

  ffmpegProcess.on('close', () => {
    console.log('⚠️ Stream stopped.');
    clearTimeout(inactivityTimeout);
    if (!isRestarting) {
      isRestarting = true;

      const now = Math.floor(Date.now() / 1000);
      if (streamExpiry > now + 10) {
        console.log('Stream ended early, refreshing stream URL in 10s...');
        setTimeout(() => {
          isRestarting = false;
          startStream();
        }, 10000);
      } else {
        console.log('Stream URL expired, refreshing stream URL...');
        setTimeout(() => {
          isRestarting = false;
          startStream();
        }, 1000);
      }
    }
  });

  const resource = createAudioResource(ffmpegProcess.stdout, {
    inputType: StreamType.Raw,
  });
  player.play(resource);

  resetInactivityTimeout();
}

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

app.listen(PORT, BASE_URL, () => {
  console.log(`🌐 Web server running on port ${PORT}`);
  setTimeout(startBot, 2000);
});

