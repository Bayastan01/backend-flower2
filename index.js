const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const rateLimiter = require('./middleware/rateLimiter');
const bot = require('./bot');
const googleAuth = require('./google-auth');
const config = require('./config');

const app = express();
const PORT = config.port;

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: config.maxFileSize }));
app.use(bodyParser.urlencoded({ extended: true, limit: config.maxFileSize }));
app.use(rateLimiter);

// Логирование запросов
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// Маршруты
app.get('/', (req, res) => {
  res.json({ 
    message: 'Flower Bot API is running',
    bot: config.botUsername,
    channel: config.channelUsername,
    webapp: config.webappUrl,
    status: 'active',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    service: 'flower-bot-api',
    environment: config.nodeEnv,
    timestamp: new Date().toISOString() 
  });
});

// Маршрут для веб-приложения Telegram
app.get('/webapp', (req, res) => {
  res.redirect(config.webappUrl);
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
    botUsername: config.botUsername,
    channelUsername: config.channelUsername,
    frontendUrl: config.frontendUrl,
    backendUrl: config.backendUrl,
    googleClientId: config.googleClientId
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
    message: config.nodeEnv === 'production' ? 'Server error' : err.message
  });
});

// Запуск бота с обработкой ошибок
try {
  bot.launch().then(() => {
    console.log(`🤖 Bot ${config.botUsername} started successfully`);
    console.log(`📢 Channel: ${config.channelUsername}`);
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
  console.log(`🌐 WebApp URL: ${config.webappUrl}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  console.log(`🔐 Google Client ID: ${config.googleClientId ? 'configured' : 'not-configured'}`);
  
  // Безопасный вывод Telegram bot URL
  if (config.botUsername) {
    const cleanBotUsername = config.botUsername.replace('@', '');
    console.log(`📱 Telegram Bot: https://t.me/${cleanBotUsername}`);
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