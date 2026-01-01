const express = require('express');
const cors = require('cors');
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// КОРНЕВОЙ МАРШРУТ - ОБЯЗАТЕЛЬНО ПЕРВЫЙ
app.get('/', (req, res) => {
  console.log('✅ GET / request received');
  res.json({
    message: '🌺 Flower Market Backend API',
    version: '3.0.0',
    status: 'WORKING',
    timestamp: new Date().toISOString(),
    endpoints: {
      root: 'GET /',
      health: 'GET /health',
      telegramData: 'GET /api/telegram-data/:tempId',
      userCheck: 'GET /api/user/check/:telegramId',
      sessionCheck: 'GET /api/session/:sessionToken',
      publishAd: 'POST /api/publish-ad'
    }
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    server: 'Flower Market Backend',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'production',
    port: process.env.PORT || 8080
  });
});

// Тестовый endpoint
app.get('/api/test', (req, res) => {
  res.json({
    success: true,
    message: '✅ API is working!',
    timestamp: new Date().toISOString()
  });
});

// Получение информации о Telegram пользователе
app.get('/api/telegram-data/:tempId', (req, res) => {
  const tempId = req.params.tempId;
  console.log(`GET /api/telegram-data/${tempId}`);
  
  res.json({
    success: true,
    telegramId: 'test_' + Date.now(),
    firstName: 'Тестовый пользователь',
    username: 'test_user',
    sessionToken: 'session_' + Date.now()
  });
});

// Проверка пользователя
app.get('/api/user/check/:telegramId', (req, res) => {
  const telegramId = req.params.telegramId;
  console.log(`GET /api/user/check/${telegramId}`);
  
  res.json({
    success: true,
    exists: false,
    isLoggedIn: false,
    telegramId: telegramId
  });
});

// Проверка сессии
app.get('/api/session/:sessionToken', (req, res) => {
  const sessionToken = req.params.sessionToken;
  console.log(`GET /api/session/${sessionToken}`);
  
  // Тестовый пользователь
  if (sessionToken.includes('test')) {
    res.json({
      success: true,
      user: {
        id: 'test_123',
        telegramId: '123456789',
        name: 'Тестовый пользователь',
        telegramInfo: {
          firstName: 'Тест',
          username: 'test_user'
        },
        isLoggedIn: true
      },
      sessionToken: sessionToken
    });
  } else {
    res.json({
      success: false,
      error: 'Session not found or expired'
    });
  }
});

// Публикация объявления
app.post('/api/publish-ad', (req, res) => {
  console.log('POST /api/publish-ad', req.body);
  
  const { title, description, price, contactInfo } = req.body;
  
  res.json({
    success: true,
    message: `✅ Объявление "${title}" успешно опубликовано!`,
    adId: Date.now(),
    title: title,
    price: price,
    contactInfo: contactInfo,
    telegramMessageId: Math.floor(Math.random() * 10000),
    publishedAt: new Date().toISOString()
  });
});

// 404 handler - должен быть ПОСЛЕ всех маршрутов
app.use((req, res) => {
  console.log(`❌ 404: ${req.method} ${req.originalUrl}`);
  res.status(404).json({
    error: 'Route not found',
    requestedUrl: req.originalUrl,
    method: req.method,
    availableEndpoints: [
      'GET /',
      'GET /health',
      'GET /api/test',
      'GET /api/telegram-data/:tempId',
      'GET /api/user/check/:telegramId',
      'GET /api/session/:sessionToken',
      'POST /api/publish-ad'
    ]
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log('='.repeat(50));
  console.log('🚀 FLOWER MARKET BACKEND ЗАПУЩЕН');
  console.log('='.repeat(50));
  console.log(`📡 Порт: ${PORT}`);
  console.log(`🌐 URL: https://backend-flower2-production.up.railway.app/`);
  console.log(`✅ Корневой маршрут: GET /`);
  console.log(`✅ Health check: GET /health`);
  console.log(`✅ Тест API: GET /api/test`);
  console.log('='.repeat(50));
});