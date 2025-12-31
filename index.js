const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const rateLimiter = require('./middleware/rateLimiter');
const bot = require('./bot');
const googleAuth = require('./google-auth');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: process.env.MAX_FILE_SIZE || '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: process.env.MAX_FILE_SIZE || '50mb' }));
app.use(rateLimiter);

// Маршруты
app.get('/', (req, res) => {
  res.json({ 
    message: 'Flower Bot API is running',
    bot: process.env.BOT_USERNAME,
    channel: process.env.CHANNEL_USERNAME,
    webapp: process.env.WEBAPP_URL
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Маршрут для веб-приложения Telegram
app.get('/webapp', (req, res) => {
  const webappUrl = process.env.WEBAPP_URL || 'https://flowers-telegram-kyrgyzstan.up.railway.app/';
  res.redirect(webappUrl);
});

// Маршруты Google авторизации
app.post('/api/auth/google', googleAuth.handleGoogleAuth);
app.get('/api/auth/user/:userId', googleAuth.getUserInfo);

// Маршрут для получения информации о боте
app.get('/api/bot/info', (req, res) => {
  res.json({
    botUsername: process.env.BOT_USERNAME,
    channelUsername: process.env.CHANNEL_USERNAME,
    frontendUrl: process.env.FRONTEND_URL,
    backendUrl: process.env.BACKEND_URL
  });
});

// Запуск бота
bot.launch().then(() => {
  console.log(`🤖 Bot @${process.env.BOT_USERNAME} started successfully`);
  console.log(`📢 Channel: ${process.env.CHANNEL_USERNAME}`);
}).catch(err => {
  console.error('Failed to start bot:', err);
});

// Обработка корректного завершения
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// Запуск сервера
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 WebApp URL: ${process.env.WEBAPP_URL}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
});