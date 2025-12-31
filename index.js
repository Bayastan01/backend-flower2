const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const rateLimiter = require('./middleware/rateLimiter');
const bot = require('./bot');
const googleAuth = require('./google-auth');

require('dotenv').config();

// Проверка обязательных переменных окружения
const requiredEnvVars = ['BOT_TOKEN', 'CHANNEL_ID', 'BOT_USERNAME', 'CHANNEL_USERNAME'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  console.error('❌ Отсутствуют обязательные переменные окружения:', missingEnvVars);
  console.error('ℹ️ Убедитесь, что файл .env существует и содержит все необходимые переменные');
  process.exit(1);
}

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
    webapp: process.env.WEBAPP_URL || 'https://flowers-telegram-kyrgyzstan.up.railway.app',
    status: 'active',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    service: 'flower-bot-api',
    bot: process.env.BOT_USERNAME ? 'configured' : 'missing',
    channel: process.env.CHANNEL_USERNAME ? 'configured' : 'missing',
    timestamp: new Date().toISOString() 
  });
});

// Маршрут для веб-приложения Telegram
app.get('/webapp', (req, res) => {
  const webappUrl = process.env.WEBAPP_URL || 'https://flowers-telegram-kyrgyzstan.up.railway.app/';
  res.redirect(webappUrl);
});

// Маршруты Google авторизации
app.post('/api/auth/google', googleAuth.handleGoogleAuth);
app.get('/api/auth/user/:userId', googleAuth.getUserInfo);

// Маршрут для импорта контактов
app.post('/api/upload-contacts', googleAuth.handleContactsUpload);

// Маршрут для проверки статуса пользователя
app.get('/api/user/:userId/status', googleAuth.getUserStatus);

// Маршрут для публикации объявления
app.post('/api/publish-ad', googleAuth.handleMediaPublish);

// Маршрут для получения информации о боте
app.get('/api/bot/info', (req, res) => {
  res.json({
    botUsername: process.env.BOT_USERNAME,
    channelUsername: process.env.CHANNEL_USERNAME,
    frontendUrl: process.env.FRONTEND_URL || 'https://flowers-telegram-kyrgyzstan.up.railway.app',
    backendUrl: process.env.BACKEND_URL || `https://${req.get('host')}`,
    googleClientId: process.env.GOOGLE_CLIENT_ID || 'not-configured'
  });
});

// Обработка 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
    path: req.path
  });
});

// Обработка ошибок
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'production' ? 'Server error' : err.message
  });
});

// Запуск бота с обработкой ошибок
try {
  bot.launch().then(() => {
    console.log(`🤖 Bot @${process.env.BOT_USERNAME || 'unknown'} started successfully`);
    console.log(`📢 Channel: ${process.env.CHANNEL_USERNAME || 'not-configured'}`);
  }).catch(err => {
    console.error('Failed to start bot:', err);
  });
} catch (error) {
  console.error('Error starting bot:', error);
}

// Обработка корректного завершения
process.once('SIGINT', () => {
  try {
    bot.stop('SIGINT');
  } catch (error) {
    console.error('Error stopping bot:', error);
  }
});

process.once('SIGTERM', () => {
  try {
    bot.stop('SIGTERM');
  } catch (error) {
    console.error('Error stopping bot:', error);
  }
});

// Запуск сервера
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 WebApp URL: ${process.env.WEBAPP_URL || 'https://flowers-telegram-kyrgyzstan.up.railway.app'}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  console.log(`🔐 Google Client ID: ${process.env.GOOGLE_CLIENT_ID ? 'configured' : 'not-configured'}`);
  
  // Безопасный вывод Telegram bot URL
  if (process.env.BOT_USERNAME) {
    const botUsername = process.env.BOT_USERNAME.replace('@', '');
    console.log(`📱 Telegram Bot: https://t.me/${botUsername}`);
  } else {
    console.log(`📱 Telegram Bot: not configured`);
  }
});

// Обработка ошибок сервера
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use`);
    process.exit(1);
  } else {
    console.error('Server error:', error);
  }
});