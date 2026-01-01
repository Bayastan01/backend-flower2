const express = require('express');
const cors = require('cors');
const { OAuth2Client } = require('google-auth-library');
const TelegramBot = require('node-telegram-bot-api');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors({
  origin: ['https://flowers-telegram-kyrgyzstan.up.railway.app', 'http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));

app.options('*', cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Создаем папку для uploads если не существует
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Проверка переменных окружения
console.log('=== FLOWER MARKET BACKEND ===');
console.log('Timestamp:', new Date().toISOString());
console.log('Environment:', process.env.NODE_ENV || 'development');
console.log('Port:', process.env.PORT || 8080);

// Конфигурация
const config = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  CHANNEL_ID: process.env.CHANNEL_ID,
  ADMIN_CHAT_ID: process.env.ADMIN_CHAT_ID,
  FRONTEND_URL: process.env.FRONTEND_URL || 'https://flowers-telegram-kyrgyzstan.up.railway.app',
  BACKEND_URL: process.env.BACKEND_URL || 'https://backend-flower2-production.up.railway.app',
  SESSION_SECRET: process.env.SESSION_SECRET || 'flower-market-secret-key-2024'
};

console.log('Config check:');
console.log('- BOT_TOKEN:', config.BOT_TOKEN ? '✓ Set' : '✗ Missing');
console.log('- GOOGLE_CLIENT_ID:', config.GOOGLE_CLIENT_ID ? '✓ Set' : '✗ Missing');
console.log('- GOOGLE_CLIENT_SECRET:', config.GOOGLE_CLIENT_SECRET ? '✓ Set' : '✗ Missing');
console.log('- CHANNEL_ID:', config.CHANNEL_ID ? '✓ Set' : '✗ Missing');
console.log('- ADMIN_CHAT_ID:', config.ADMIN_CHAT_ID ? '✓ Set' : '✗ Missing');

// Инициализация сервисов
let googleClient = null;
let bot = null;
let botInitialized = false;

// Хранение данных (в продакшене использовать Redis или DB)
const users = new Map();        // telegramId -> user
const sessions = new Map();     // sessionToken -> user
const telegramData = new Map(); // tempId -> telegram data
const pendingAuth = new Map();  // stateToken -> auth data
const ads = new Map();          // adId -> ad
const userAds = new Map();      // telegramId -> [adIds]

// Генерация токенов
function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function generateTempId() {
  return 'temp_' + Date.now() + '_' + crypto.randomBytes(16).toString('hex');
}

function generateStateToken() {
  return 'state_' + Date.now() + '_' + crypto.randomBytes(16).toString('hex');
}

function generateAdId() {
  return 'ad_' + Date.now() + '_' + crypto.randomBytes(8).toString('hex');
}

// Инициализация Google OAuth
function initializeGoogleOAuth() {
  if (config.GOOGLE_CLIENT_ID) {
    try {
      googleClient = new OAuth2Client(
        config.GOOGLE_CLIENT_ID,
        config.GOOGLE_CLIENT_SECRET,
        `${config.BACKEND_URL}/api/auth/google/callback`
      );
      console.log('✅ Google OAuth initialized');
    } catch (error) {
      console.error('❌ Google OAuth init error:', error.message);
    }
  } else {
    console.warn('⚠️ GOOGLE_CLIENT_ID not set, Google auth disabled');
  }
}

// Инициализация Telegram бота
function initializeTelegramBot() {
  if (!config.BOT_TOKEN) {
    console.warn('⚠️ BOT_TOKEN not set, Telegram bot disabled');
    return;
  }

  try {
    console.log('🤖 Initializing Telegram bot...');
    
    bot = new TelegramBot(config.BOT_TOKEN, {
      polling: {
        interval: 3000,
        timeout: 30,
        autoStart: true,
        params: { timeout: 30 }
      },
      webHook: false
    });

    // ==================== BOT COMMANDS ====================

    // Команда /start
    bot.onText(/\/start/, async (msg) => {
      const chatId = msg.chat.id;
      const telegramId = msg.from.id.toString();
      const firstName = msg.from.first_name || 'Пользователь';
      const username = msg.from.username || '';
      
      console.log(`👤 /start from ${firstName} (ID: ${telegramId})`);
      
      // Создаем или получаем пользователя
      let user = users.get(telegramId);
      const isNewUser = !user;
      
      if (!user) {
        user = {
          id: telegramId,
          telegramId: telegramId,
          telegramInfo: {
            firstName: msg.from.first_name,
            lastName: msg.from.last_name,
            username: username,
            languageCode: msg.from.language_code || 'ru',
            isBot: msg.from.is_bot || false
          },
          googleInfo: null,
          isLoggedIn: false,
          createdAt: new Date(),
          isApproved: true,
          ads: [],
          draft: null,
          sessionToken: null,
          lastActivity: new Date(),
          stats: {
            adsPublished: 0,
            lastAdDate: null
          }
        };
        users.set(telegramId, user);
        console.log(`✅ New user created: ${firstName} (${telegramId})`);
      }
      
      // Генерируем временный ID для веб-приложения
      const tempId = generateTempId();
      telegramData.set(tempId, {
        telegramId: telegramId,
        firstName: firstName,
        username: username,
        timestamp: Date.now()
      });
      
      // Удаляем через 5 минут
      setTimeout(() => telegramData.delete(tempId), 5 * 60 * 1000);
      
      // Создаем URL для веб-приложения
      const webAppUrl = `${config.FRONTEND_URL}?telegram_id=${telegramId}&temp_id=${tempId}`;
      
      // Формируем клавиатуру
      const keyboard = {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '🌺 Создать объявление',
                web_app: { url: webAppUrl }
              }
            ],
            [
              {
                text: '📋 Мои объявления',
                callback_data: 'my_ads'
              },
              {
                text: '❓ Помощь',
                callback_data: 'help'
              }
            ]
          ]
        }
      };
      
      // Формируем сообщение
      let message = `🌸 *Добро пожаловать в Flower Market, ${firstName}!* 🌸\n\n`;
      
      if (isNewUser) {
        message += `Рады приветствовать вас в нашем маркетплейсе цветов!\n\n`;
      }
      
      if (user.googleInfo) {
        message += `✅ Вы авторизованы как *${user.googleInfo.name}*\n`;
        message += `📧 Email: ${user.googleInfo.email}\n\n`;
      } else {
        message += `📱 *Ваш Telegram ID:* \`${telegramId}\`\n\n`;
        message += `Для создания объявлений нужно:\n`;
        message += `1. Нажать кнопку ниже\n`;
        message += `2. Войти через Google\n`;
        message += `3. Заполнить форму объявления\n\n`;
      }
      
      message += `📊 *Статистика:*\n`;
      message += `• Опубликовано объявлений: ${user.stats.adsPublished || 0}\n`;
      
      if (user.stats.lastAdDate) {
        const lastAd = new Date(user.stats.lastAdDate);
        message += `• Последнее объявление: ${lastAd.toLocaleDateString('ru-RU')}\n`;
      }
      
      message += `\n💡 *Совет:* Добавляйте качественные фотографии для лучшего отклика!`;
      
      try {
        await bot.sendMessage(chatId, message, {
          parse_mode: 'Markdown',
          ...keyboard,
          disable_web_page_preview: true
        });
        
        // Если это новый пользователь, отправляем дополнительное приветствие
        if (isNewUser && config.ADMIN_CHAT_ID) {
          const adminMessage = `👤 *Новый пользователь зарегистрирован*\n\n` +
            `• Имя: ${firstName}\n` +
            `• ID: ${telegramId}\n` +
            `• Username: ${username ? '@' + username : 'нет'}\n` +
            `• Время: ${new Date().toLocaleString('ru-RU')}`;
          
          await bot.sendMessage(config.ADMIN_CHAT_ID, adminMessage, { parse_mode: 'Markdown' });
        }
        
      } catch (error) {
        console.error('Error sending start message:', error.message);
      }
    });

    // Команда /help
    bot.onText(/\/help/, async (msg) => {
      const chatId = msg.chat.id;
      
      const helpMessage = `💡 *Помощь по использованию Flower Market*\n\n` +
        `*Основные команды:*\n` +
        `/start - Запустить бота и создать объявление\n` +
        `/help - Получить справку\n` +
        `/myads - Мои объявления\n\n` +
        `*Как создать объявление:*\n` +
        `1. Нажмите /start\n` +
        `2. Нажмите кнопку "Создать объявление"\n` +
        `3. Войдите через Google\n` +
        `4. Заполните форму\n` +
        `5. Опубликуйте объявление\n\n` +
        `*Требования к объявлениям:*\n` +
        `• Четкие фотографии цветов\n` +
        `• Реальная цена\n` +
        `• Корректные контакты\n` +
        `• Описание на русском языке\n\n` +
        `*Канал с объявлениями:* @flowers_market_kg\n\n` +
        `📞 *Поддержка:* @flowers_support`;
      
      try {
        await bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
      } catch (error) {
        console.error('Error sending help message:', error.message);
      }
    });

    // Команда /myads
    bot.onText(/\/myads/, async (msg) => {
      const chatId = msg.chat.id;
      const telegramId = msg.from.id.toString();
      
      const user = users.get(telegramId);
      if (!user) {
        await bot.sendMessage(chatId, '❌ Сначала запустите бота командой /start');
        return;
      }
      
      const userAdIds = userAds.get(telegramId) || [];
      const userAdsList = userAdIds.map(id => ads.get(id)).filter(ad => ad);
      
      if (userAdsList.length === 0) {
        await bot.sendMessage(chatId, '📭 У вас пока нет опубликованных объявлений.\n\nСоздайте первое объявление через кнопку в меню /start');
        return;
      }
      
      let message = `📋 *Ваши объявления (${userAdsList.length})*\n\n`;
      
      userAdsList.slice(0, 10).forEach((ad, index) => {
        message += `*${index + 1}. ${ad.title}*\n`;
        message += `💰 Цена: ${ad.price}\n`;
        message += `📅 Дата: ${new Date(ad.publishedAt).toLocaleDateString('ru-RU')}\n`;
        message += `📊 Статус: ${ad.status === 'published' ? '✅ Опубликовано' : '❌ Ошибка'}\n`;
        
        if (ad.telegramMessageId && ad.status === 'published') {
          const channelUsername = config.CHANNEL_ID ? config.CHANNEL_ID.replace('@', '') : 'flowers_market_kg';
          message += `🔗 Ссылка: https://t.me/${channelUsername}/${ad.telegramMessageId}\n`;
        }
        
        message += `\n`;
      });
      
      if (userAdsList.length > 10) {
        message += `\n... и еще ${userAdsList.length - 10} объявлений`;
      }
      
      try {
        await bot.sendMessage(chatId, message, { 
          parse_mode: 'Markdown',
          disable_web_page_preview: true
        });
      } catch (error) {
        console.error('Error sending myads message:', error.message);
      }
    });

    // Обработка callback-запросов
    bot.on('callback_query', async (callbackQuery) => {
      const chatId = callbackQuery.message.chat.id;
      const telegramId = callbackQuery.from.id.toString();
      const data = callbackQuery.data;
      
      try {
        switch (data) {
          case 'my_ads':
            await bot.answerCallbackQuery(callbackQuery.id);
            
            const user = users.get(telegramId);
            if (!user) {
              await bot.sendMessage(chatId, '❌ Сначала запустите бота командой /start');
              return;
            }
            
            const userAdIds = userAds.get(telegramId) || [];
            if (userAdIds.length === 0) {
              await bot.sendMessage(chatId, '📭 У вас пока нет объявлений');
            } else {
              const webAppUrl = `${config.FRONTEND_URL}?telegram_id=${telegramId}`;
              const keyboard = {
                reply_markup: {
                  inline_keyboard: [[
                    {
                      text: '🌺 Создать новое',
                      web_app: { url: webAppUrl }
                    }
                  ]]
                }
              };
              
              await bot.sendMessage(
                chatId, 
                `📊 У вас ${userAdIds.length} объявлений\n\nДля просмотра всех объявлений используйте команду /myads`,
                keyboard
              );
            }
            break;
            
          case 'help':
            await bot.answerCallbackQuery(callbackQuery.id);
            const helpText = `💡 *Быстрая помощь*\n\n` +
              `• Для создания объявления нажмите "Создать объявление"\n` +
              `• Для просмотра своих объявлений: /myads\n` +
              `• Полная справка: /help\n\n` +
              `Канал: @flowers_market_kg`;
            
            await bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
            break;
            
          default:
            await bot.answerCallbackQuery(callbackQuery.id, { text: 'Команда не распознана' });
        }
      } catch (error) {
        console.error('Callback query error:', error.message);
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Произошла ошибка' });
      }
    });

    // Обработка всех сообщений (для логирования)
    bot.on('message', async (msg) => {
      if (!msg.text || msg.text.startsWith('/')) return;
      
      console.log(`📩 Message from ${msg.chat.id}: ${msg.text.substring(0, 100)}...`);
      
      // Автоответ на обычные сообщения
      if (msg.chat.type === 'private') {
        try {
          await bot.sendMessage(
            msg.chat.id,
            `💬 Я получил ваше сообщение!\n\nДля работы с объявлениями используйте команду /start\nДля помощи: /help`,
            { parse_mode: 'Markdown' }
          );
        } catch (error) {
          console.error('Error responding to message:', error.message);
        }
      }
    });

    // Успешная инициализация бота
    bot.getMe().then(botInfo => {
      console.log(`✅ Telegram Bot started: @${botInfo.username} (${botInfo.first_name})`);
      botInitialized = true;
      
      // Устанавливаем команды бота
      bot.setMyCommands([
        { command: 'start', description: '🚀 Запустить бота и создать объявление' },
        { command: 'help', description: '❓ Получить помощь по использованию' },
        { command: 'myads', description: '📋 Показать мои объявления' }
      ]);
      
      console.log('✅ Bot commands set');
      
    }).catch(error => {
      console.error('❌ Failed to initialize Telegram bot:', error.message);
      botInitialized = false;
    });

  } catch (error) {
    console.error('❌ Error initializing Telegram bot:', error.message);
    botInitialized = false;
  }
}

// Инициализация сервисов
initializeGoogleOAuth();
initializeTelegramBot();

// ==================== API ROUTES ====================

// КОРНЕВОЙ МАРШРУТ
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: '🌺 Flower Market Backend API',
    version: '2.0.0',
    status: 'online',
    timestamp: new Date().toISOString(),
    services: {
      telegramBot: botInitialized ? '✅ Active' : '❌ Inactive',
      googleOAuth: googleClient ? '✅ Initialized' : '❌ Not configured'
    },
    stats: {
      users: users.size,
      sessions: sessions.size,
      ads: ads.size,
      activeSessions: Array.from(sessions.values()).filter(s => s.isLoggedIn).length
    },
    endpoints: {
      root: 'GET /',
      health: 'GET /health',
      telegramData: 'GET /api/telegram-data/:tempId',
      userCheck: 'GET /api/user/check/:telegramId',
      googleAuthUrl: 'POST /api/auth/google/url',
      googleCallback: 'GET /api/auth/google/callback',
      sessionCheck: 'GET /api/session/:sessionToken',
      draftSave: 'POST /api/draft/save',
      draftGet: 'GET /api/draft/:sessionToken',
      publishAd: 'POST /api/publish-ad',
      uploadImage: 'POST /api/upload/image',
      myAds: 'GET /api/user/:telegramId/ads',
      logout: 'POST /api/logout',
      stats: 'GET /api/stats'
    },
    config: {
      frontendUrl: config.FRONTEND_URL,
      backendUrl: config.BACKEND_URL,
      channelId: config.CHANNEL_ID || 'Not set',
      hasBotToken: !!config.BOT_TOKEN,
      hasGoogleClientId: !!config.GOOGLE_CLIENT_ID
    }
  });
});

// Health check
app.get('/health', (req, res) => {
  const healthStatus = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    services: {
      telegramBot: {
        initialized: botInitialized,
        status: botInitialized ? 'healthy' : 'unhealthy',
        hasToken: !!config.BOT_TOKEN
      },
      googleOAuth: {
        initialized: !!googleClient,
        hasClientId: !!config.GOOGLE_CLIENT_ID,
        hasClientSecret: !!config.GOOGLE_CLIENT_SECRET
      },
      database: {
        users: users.size,
        sessions: sessions.size,
        ads: ads.size,
        status: 'in-memory'
      }
    },
    system: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      env: process.env.NODE_ENV || 'development'
    }
  };
  
  res.json(healthStatus);
});

// Статистика API
app.get('/api/stats', (req, res) => {
  const now = new Date();
  const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  
  // Подсчет активности за последние 24 часа
  const recentUsers = Array.from(users.values()).filter(u => 
    u.lastActivity && new Date(u.lastActivity) > last24Hours
  ).length;
  
  const recentAds = Array.from(ads.values()).filter(ad => 
    ad.publishedAt && new Date(ad.publishedAt) > last24Hours
  ).length;
  
  res.json({
    success: true,
    stats: {
      total: {
        users: users.size,
        sessions: sessions.size,
        ads: ads.size,
        activeSessions: Array.from(sessions.values()).filter(s => s.isLoggedIn).length
      },
      recent24h: {
        activeUsers: recentUsers,
        newAds: recentAds,
        sessionCreations: Array.from(sessions.values()).filter(s => 
          s.createdAt && new Date(s.createdAt) > last24Hours
        ).length
      },
      bot: {
        initialized: botInitialized,
        hasChannel: !!config.CHANNEL_ID
      }
    },
    timestamp: now.toISOString()
  });
});

// Получение информации о Telegram пользователе
app.get('/api/telegram-data/:tempId', (req, res) => {
  try {
    const tempId = req.params.tempId;
    console.log(`GET /api/telegram-data/${tempId}`);
    
    const data = telegramData.get(tempId);
    
    if (data) {
      telegramData.delete(tempId);
      
      // Ищем или создаем пользователя
      let user = users.get(data.telegramId);
      if (!user) {
        user = {
          id: data.telegramId,
          telegramId: data.telegramId,
          telegramInfo: {
            firstName: data.firstName,
            username: data.username,
            languageCode: 'ru',
            isBot: false
          },
          googleInfo: null,
          isLoggedIn: false,
          createdAt: new Date(),
          isApproved: true,
          ads: [],
          draft: null,
          sessionToken: null,
          lastActivity: new Date(),
          stats: {
            adsPublished: 0,
            lastAdDate: null
          }
        };
        users.set(data.telegramId, user);
        console.log(`✅ User created from telegram data: ${data.firstName} (${data.telegramId})`);
      }
      
      res.json({
        success: true,
        telegramId: data.telegramId,
        firstName: data.firstName,
        username: data.username,
        userExists: !!user.googleInfo,
        isLoggedIn: user.isLoggedIn
      });
    } else {
      res.status(404).json({ 
        success: false, 
        error: 'Telegram data not found or expired',
        code: 'TELEGRAM_DATA_EXPIRED'
      });
    }
  } catch (error) {
    console.error('Error getting telegram data:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error',
      details: error.message 
    });
  }
});

// Проверка пользователя
app.get('/api/user/check/:telegramId', (req, res) => {
  try {
    const telegramId = req.params.telegramId;
    console.log(`GET /api/user/check/${telegramId}`);
    
    const user = users.get(telegramId);
    
    if (user) {
      res.json({
        success: true,
        exists: true,
        isLoggedIn: user.isLoggedIn,
        user: {
          id: user.id,
          telegramId: user.telegramId,
          name: user.googleInfo?.name || user.telegramInfo.firstName,
          email: user.googleInfo?.email,
          picture: user.googleInfo?.picture,
          isApproved: user.isApproved,
          telegramInfo: user.telegramInfo,
          stats: user.stats
        }
      });
    } else {
      res.json({ 
        success: true,
        exists: false,
        message: 'User not found'
      });
    }
  } catch (error) {
    console.error('Error checking user:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error'
    });
  }
});

// Генерация URL для авторизации Google
app.post('/api/auth/google/url', (req, res) => {
  try {
    const { telegramId } = req.body;
    
    if (!telegramId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Telegram ID is required',
        code: 'MISSING_TELEGRAM_ID'
      });
    }

    if (!googleClient) {
      return res.status(503).json({ 
        success: false, 
        error: 'Google OAuth service is not configured',
        code: 'GOOGLE_OAUTH_NOT_CONFIGURED'
      });
    }

    // Генерируем state токен
    const stateToken = generateStateToken();
    pendingAuth.set(stateToken, {
      telegramId: telegramId,
      timestamp: Date.now(),
      userAgent: req.get('User-Agent'),
      ip: req.ip
    });

    // Удаляем через 10 минут
    setTimeout(() => pendingAuth.delete(stateToken), 10 * 60 * 1000);

    // Генерируем URL для авторизации
    const authUrl = googleClient.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/userinfo.email',
        'openid'
      ],
      state: stateToken,
      prompt: 'consent',
      include_granted_scopes: true,
      redirect_uri: `${config.BACKEND_URL}/api/auth/google/callback`
    });

    console.log(`🔗 Generated Google auth URL for telegramId: ${telegramId}`);
    
    res.json({
      success: true,
      authUrl: authUrl,
      stateToken: stateToken,
      expiresIn: 600 // 10 минут в секундах
    });

  } catch (error) {
    console.error('❌ Error generating auth URL:', error.message);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to generate authentication URL',
      code: 'AUTH_URL_GENERATION_FAILED',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Callback для Google OAuth
app.get('/api/auth/google/callback', async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;
    
    console.log('🔐 Google OAuth callback received');
    console.log('- Has code:', !!code);
    console.log('- State:', state || 'None');
    console.log('- Error:', error || 'None');
    
    if (error) {
      const errorMsg = error_description || error;
      console.error(`❌ Google OAuth error: ${errorMsg}`);
      return res.redirect(`${config.FRONTEND_URL}/?error=${encodeURIComponent(`Google auth error: ${errorMsg}`)}`);
    }

    if (!code || !state) {
      console.error('Missing code or state in callback');
      return res.redirect(`${config.FRONTEND_URL}/?error=${encodeURIComponent('Missing authentication parameters')}`);
    }

    // Проверяем state токен
    const pendingAuthData = pendingAuth.get(state);
    if (!pendingAuthData) {
      console.error('Invalid or expired state token:', state);
      return res.redirect(`${config.FRONTEND_URL}/?error=${encodeURIComponent('Invalid or expired authentication session')}`);
    }

    const { telegramId } = pendingAuthData;
    pendingAuth.delete(state);

    if (!googleClient) {
      console.error('Google client not initialized');
      return res.redirect(`${config.FRONTEND_URL}/?error=${encodeURIComponent('Authentication service not available')}`);
    }

    // Обмениваем код на токен
    console.log('Exchanging code for token...');
    const { tokens } = await googleClient.getToken({
      code: code,
      redirect_uri: `${config.BACKEND_URL}/api/auth/google/callback`
    });
    
    googleClient.setCredentials(tokens);

    // Получаем информацию о пользователе
    console.log('Verifying ID token...');
    const ticket = await googleClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: config.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    console.log(`✅ Google auth successful for: ${payload.email} (${payload.name})`);
    
    // Ищем или создаем пользователя
    let user = users.get(telegramId);
    const isNewUser = !user;
    
    if (!user) {
      user = {
        id: telegramId,
        telegramId: telegramId,
        telegramInfo: {
          firstName: 'Пользователь',
          lastName: '',
          username: '',
          languageCode: 'ru',
          isBot: false
        },
        googleInfo: null,
        isLoggedIn: false,
        createdAt: new Date(),
        isApproved: true,
        ads: [],
        draft: null,
        sessionToken: null,
        lastActivity: new Date(),
        stats: {
          adsPublished: 0,
          lastAdDate: null
        }
      };
      console.log(`👤 Created new user for Telegram ID: ${telegramId}`);
    }
    
    // Обновляем Google информацию
    user.googleInfo = {
      googleId: payload.sub,
      name: payload.name,
      givenName: payload.given_name,
      familyName: payload.family_name,
      email: payload.email,
      picture: payload.picture,
      emailVerified: payload.email_verified || false,
      locale: payload.locale || 'ru',
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenExpiry: tokens.expiry_date,
      authTime: new Date().toISOString()
    };
    
    user.isLoggedIn = true;
    user.lastActivity = new Date();
    user.isApproved = true;
    
    // Генерируем сессию
    const sessionToken = generateSessionToken();
    user.sessionToken = sessionToken;
    sessions.set(sessionToken, user);
    
    // Сохраняем пользователя
    users.set(telegramId, user);
    
    console.log(`✅ User authenticated: ${user.googleInfo.name} (${user.googleInfo.email})`);
    
    // Отправляем уведомление администратору
    if (botInitialized && config.ADMIN_CHAT_ID) {
      try {
        let adminMessage = `📋 *Новый пользователь авторизовался*\n\n`;
        adminMessage += `👤 *Имя:* ${user.googleInfo.name}\n`;
        adminMessage += `📧 *Email:* ${user.googleInfo.email}\n`;
        adminMessage += `📱 *Telegram ID:* ${user.telegramId}\n`;
        
        if (user.telegramInfo.username) {
          adminMessage += `👤 *Telegram username:* @${user.telegramInfo.username}\n`;
        }
        
        adminMessage += `📅 *Тип:* ${isNewUser ? 'Новый пользователь' : 'Возвращение'}\n`;
        adminMessage += `✅ *Статус:* Автоматически одобрен\n`;
        adminMessage += `⏰ *Время:* ${new Date().toLocaleString('ru-RU')}`;
        
        await bot.sendMessage(config.ADMIN_CHAT_ID, adminMessage, { 
          parse_mode: 'Markdown',
          disable_web_page_preview: true 
        });
        console.log(`📤 Admin notification sent`);
      } catch (botError) {
        console.error('Admin notification failed:', botError.message);
      }
    }
    
    // Отправляем приветственное сообщение пользователю
    if (botInitialized && user.telegramId) {
      try {
        const webAppUrl = `${config.FRONTEND_URL}?session=${sessionToken}`;
        
        let welcomeMessage = `🎉 *Добро пожаловать${isNewUser ? '' : ' снова'}, ${user.googleInfo.name}!*\n\n`;
        welcomeMessage += `✅ Вы успешно ${isNewUser ? 'зарегистрировались' : 'авторизовались'} в Flower Market.\n\n`;
        
        if (isNewUser) {
          welcomeMessage += `*Что дальше?*\n`;
          welcomeMessage += `1. Нажмите кнопку ниже\n`;
          welcomeMessage += `2. Заполните форму объявления\n`;
          welcomeMessage += `3. Опубликуйте его в нашем канале\n\n`;
          welcomeMessage += `💡 *Совет:* Добавляйте качественные фотографии для лучшего отклика!`;
        } else {
          welcomeMessage += `Рады видеть вас снова!\n`;
          welcomeMessage += `У вас ${user.stats.adsPublished || 0} опубликованных объявлений.\n\n`;
          welcomeMessage += `Создайте новое объявление или просмотрите существующие.`;
        }
        
        const keyboard = {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: '🌺 Создать объявление',
                  web_app: { url: webAppUrl }
                }
              ],
              [
                {
                  text: '📋 Мои объявления',
                  callback_data: 'my_ads'
                },
                {
                  text: '❓ Помощь',
                  callback_data: 'help'
                }
              ]
            ]
          }
        };
        
        await bot.sendMessage(user.telegramId, welcomeMessage, { 
          parse_mode: 'Markdown',
          ...keyboard,
          disable_web_page_preview: true
        });
        
        console.log(`📤 Welcome message sent to user ${user.telegramId}`);
      } catch (botError) {
        console.error('Welcome message failed:', botError.message);
      }
    }
    
    // Перенаправляем на frontend с сессией
    const redirectUrl = `${config.FRONTEND_URL}?session=${sessionToken}`;
    console.log(`🔗 Redirecting to: ${redirectUrl}`);
    
    // HTML страница с автоматическим редиректом
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Flower Market - Авторизация</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0;
            padding: 20px;
          }
          .container {
            background: white;
            border-radius: 20px;
            padding: 40px;
            text-align: center;
            box-shadow: 0 10px 40px rgba(0,0,0,0.1);
            max-width: 400px;
            width: 100%;
          }
          .success-icon {
            font-size: 60px;
            color: #34c759;
            margin-bottom: 20px;
          }
          h1 {
            color: #333;
            margin-bottom: 10px;
          }
          p {
            color: #666;
            line-height: 1.5;
            margin-bottom: 30px;
          }
          .loader {
            border: 4px solid #f3f3f3;
            border-top: 4px solid #667eea;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 0 auto 20px;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="success-icon">✅</div>
          <h1>Авторизация успешна!</h1>
          <p>Добро пожаловать, ${user.googleInfo.name}!</p>
          <p>Перенаправляем вас в приложение...</p>
          <div class="loader"></div>
          <p style="font-size: 14px; color: #999; margin-top: 20px;">
            Если перенаправление не произошло, <a href="${redirectUrl}">нажмите сюда</a>
          </p>
        </div>
        <script>
          setTimeout(() => {
            window.location.href = "${redirectUrl}";
          }, 2000);
        </script>
      </body>
      </html>
    `;
    
    res.send(html);

  } catch (error) {
    console.error('❌ Google OAuth callback error:', error.message);
    
    // Детальный лог ошибки
    if (error.response) {
      console.error('Error response:', error.response.data);
    }
    
    const errorMessage = encodeURIComponent(error.message);
    const errorHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Ошибка авторизации</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0;
            padding: 20px;
          }
          .container {
            background: white;
            border-radius: 20px;
            padding: 40px;
            text-align: center;
            box-shadow: 0 10px 40px rgba(0,0,0,0.1);
            max-width: 400px;
            width: 100%;
          }
          .error-icon {
            font-size: 60px;
            color: #ff3b30;
            margin-bottom: 20px;
          }
          h1 {
            color: #333;
            margin-bottom: 10px;
          }
          p {
            color: #666;
            line-height: 1.5;
            margin-bottom: 30px;
          }
          .btn {
            background: #667eea;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 10px;
            font-size: 16px;
            cursor: pointer;
            text-decoration: none;
            display: inline-block;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="error-icon">❌</div>
          <h1>Ошибка авторизации</h1>
          <p>${error.message}</p>
          <a href="${config.FRONTEND_URL}" class="btn">Вернуться на главную</a>
        </div>
      </body>
      </html>
    `;
    
    res.send(errorHtml);
  }
});

// Проверка сессии
app.get('/api/session/:sessionToken', (req, res) => {
  try {
    const sessionToken = req.params.sessionToken;
    console.log(`GET /api/session/${sessionToken.substring(0, 10)}...`);
    
    const user = sessions.get(sessionToken);
    
    if (user && user.isLoggedIn) {
      // Обновляем время последней активности
      user.lastActivity = new Date();
      sessions.set(sessionToken, user);
      users.set(user.telegramId, user);
      
      res.json({
        success: true,
        user: {
          id: user.id,
          telegramId: user.telegramId,
          name: user.googleInfo?.name || user.telegramInfo.firstName,
          email: user.googleInfo?.email,
          picture: user.googleInfo?.picture,
          isApproved: user.isApproved,
          telegramInfo: user.telegramInfo,
          stats: user.stats
        },
        sessionToken: sessionToken
      });
    } else {
      res.status(401).json({ 
        success: false, 
        error: 'Session not found or expired',
        code: 'SESSION_EXPIRED'
      });
    }
  } catch (error) {
    console.error('Error checking session:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error'
    });
  }
});

// Сохранение черновика
app.post('/api/draft/save', async (req, res) => {
  try {
    const { sessionToken, draftData } = req.body;
    
    if (!sessionToken) {
      return res.status(400).json({ 
        success: false, 
        error: 'Session token is required',
        code: 'MISSING_SESSION_TOKEN'
      });
    }
    
    const user = sessions.get(sessionToken);
    if (!user || !user.isLoggedIn) {
      return res.status(401).json({ 
        success: false, 
        error: 'User not authenticated',
        code: 'USER_NOT_AUTHENTICATED'
      });
    }
    
    user.draft = {
      ...draftData,
      savedAt: new Date(),
      updatedAt: new Date()
    };
    
    user.lastActivity = new Date();
    users.set(user.telegramId, user);
    sessions.set(sessionToken, user);
    
    console.log(`💾 Draft saved for user ${user.telegramId}`);
    
    res.json({
      success: true,
      message: 'Черновик успешно сохранен',
      savedAt: user.draft.savedAt,
      hasPhotos: draftData.photos && draftData.photos.length > 0
    });
    
  } catch (error) {
    console.error('Error saving draft:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Ошибка сохранения черновика',
      code: 'DRAFT_SAVE_ERROR'
    });
  }
});

// Получение черновика
app.get('/api/draft/:sessionToken', async (req, res) => {
  try {
    const sessionToken = req.params.sessionToken;
    console.log(`GET /api/draft/${sessionToken.substring(0, 10)}...`);
    
    const user = sessions.get(sessionToken);
    if (!user || !user.isLoggedIn) {
      return res.status(401).json({ 
        success: false, 
        error: 'User not authenticated',
        code: 'USER_NOT_AUTHENTICATED'
      });
    }
    
    if (user.draft) {
      // Проверяем, не устарел ли черновик (старше 7 дней)
      const draftAge = new Date() - new Date(user.draft.savedAt);
      const maxDraftAge = 7 * 24 * 60 * 60 * 1000; // 7 дней
      
      if (draftAge > maxDraftAge) {
        // Удаляем устаревший черновик
        delete user.draft;
        users.set(user.telegramId, user);
        sessions.set(sessionToken, user);
        
        res.json({
          success: true,
          draft: null,
          exists: false,
          message: 'Черновик устарел и был удален'
        });
      } else {
        res.json({
          success: true,
          draft: user.draft,
          exists: true,
          savedAt: user.draft.savedAt,
          ageDays: Math.floor(draftAge / (24 * 60 * 60 * 1000))
        });
      }
    } else {
      res.json({
        success: true,
        draft: null,
        exists: false
      });
    }
    
  } catch (error) {
    console.error('Error getting draft:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Ошибка загрузки черновика',
      code: 'DRAFT_LOAD_ERROR'
    });
  }
});

// Загрузка изображения
app.post('/api/upload/image', async (req, res) => {
  try {
    const { sessionToken, image, filename } = req.body;
    
    if (!sessionToken) {
      return res.status(400).json({ 
        success: false, 
        error: 'Session token is required'
      });
    }
    
    const user = sessions.get(sessionToken);
    if (!user || !user.isLoggedIn) {
      return res.status(401).json({ 
        success: false, 
        error: 'User not authenticated'
      });
    }
    
    if (!image || !image.startsWith('data:image/')) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid image data'
      });
    }
    
    // Извлекаем тип и данные изображения
    const matches = image.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid image format'
      });
    }
    
    const imageType = matches[1];
    const imageData = matches[2];
    const buffer = Buffer.from(imageData, 'base64');
    
    // Проверяем размер (макс 10MB)
    if (buffer.length > 10 * 1024 * 1024) {
      return res.status(400).json({ 
        success: false, 
        error: 'Image size too large (max 10MB)'
      });
    }
    
    // Генерируем имя файла
    const safeFilename = filename || `photo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const filePath = path.join(uploadsDir, `${safeFilename}.${imageType}`);
    
    // Сохраняем файл
    fs.writeFileSync(filePath, buffer);
    
    // Создаем URL для доступа к файлу
    const imageUrl = `${config.BACKEND_URL}/uploads/${safeFilename}.${imageType}`;
    
    console.log(`📸 Image uploaded for user ${user.telegramId}: ${safeFilename}.${imageType} (${Math.round(buffer.length / 1024)}KB)`);
    
    res.json({
      success: true,
      imageUrl: imageUrl,
      filename: `${safeFilename}.${imageType}`,
      size: buffer.length,
      type: imageType
    });
    
  } catch (error) {
    console.error('Error uploading image:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Ошибка загрузки изображения'
    });
  }
});

// Статические файлы (для загруженных изображений)
app.use('/uploads', express.static(uploadsDir));

// Публикация объявления
app.post('/api/publish-ad', async (req, res) => {
  try {
    const { sessionToken, title, description, price, contactInfo, photos } = req.body;
    
    console.log('📝 Publish ad request received');
    
    if (!sessionToken) {
      return res.status(400).json({ 
        success: false, 
        error: 'Session token is required',
        code: 'MISSING_SESSION_TOKEN'
      });
    }
    
    if (!title || !description || !price || !contactInfo) {
      return res.status(400).json({ 
        success: false, 
        error: 'All fields are required: title, description, price, contactInfo',
        code: 'MISSING_REQUIRED_FIELDS'
      });
    }
    
    const user = sessions.get(sessionToken);
    if (!user || !user.isLoggedIn) {
      return res.status(401).json({ 
        success: false, 
        error: 'User not authenticated',
        code: 'USER_NOT_AUTHENTICATED'
      });
    }
    
    console.log(`📝 New ad from ${user.telegramId} (${user.googleInfo?.name || user.telegramInfo.firstName}):`, { 
      title: title.substring(0, 50) + (title.length > 50 ? '...' : ''),
      price: price,
      hasPhotos: photos && photos.length > 0 ? photos.length : 0
    });
    
    // Формируем сообщение для Telegram
    let telegramMessage = `🌸 *${title}* 🌸\n\n`;
    telegramMessage += `📝 *Описание:*\n${description}\n\n`;
    telegramMessage += `💰 *Цена:* ${price}\n`;
    telegramMessage += `📞 *Контакты:* ${contactInfo}\n\n`;
    telegramMessage += `👤 *Продавец:* ${user.googleInfo?.name || user.telegramInfo.firstName}\n`;
    
    if (user.telegramInfo.username) {
      telegramMessage += `💬 *Telegram:* @${user.telegramInfo.username}\n`;
    }
    
    if (user.googleInfo?.email) {
      telegramMessage += `📧 *Email:* ${user.googleInfo.email}\n`;
    }
    
    telegramMessage += `\n🕒 *Дата:* ${new Date().toLocaleString('ru-RU')}\n`;
    telegramMessage += `#цветы`;
    
    // Хештеги на основе заголовка
    const hashtags = title.toLowerCase().split(' ').filter(word => 
      word.length > 3 && !['цветы', 'букет', 'розы', 'тюльпаны', 'хризантемы'].includes(word)
    ).slice(0, 3);
    
    if (hashtags.length > 0) {
      telegramMessage += ` #${hashtags.join(' #')}`;
    }
    
    let telegramMessageId = null;
    let error = null;
    let sentMessage = null;
    
    // Отправляем в канал если бот активен и канал настроен
    if (botInitialized && config.CHANNEL_ID) {
      try {
        const sendOptions = {
          parse_mode: 'Markdown',
          disable_web_page_preview: true
        };
        
        // Если есть фото, отправляем с фото
        if (photos && photos.length > 0 && photos[0]) {
          try {
            // Отправляем первое фото с подписью
            sentMessage = await bot.sendPhoto(config.CHANNEL_ID, photos[0], {
              caption: telegramMessage,
              parse_mode: 'Markdown'
            });
            
            // Отправляем остальные фото без подписи
            for (let i = 1; i < Math.min(photos.length, 5); i++) {
              try {
                await bot.sendPhoto(config.CHANNEL_ID, photos[i]);
              } catch (photoError) {
                console.error(`Error sending photo ${i + 1}:`, photoError.message);
              }
            }
          } catch (photoSendError) {
            console.error('Error sending photo, trying text only:', photoSendError.message);
            // Если не удалось отправить фото, отправляем текстовое сообщение
            sentMessage = await bot.sendMessage(config.CHANNEL_ID, telegramMessage, sendOptions);
          }
        } else {
          // Только текстовое сообщение
          sentMessage = await bot.sendMessage(config.CHANNEL_ID, telegramMessage, sendOptions);
        }
        
        if (sentMessage) {
          telegramMessageId = sentMessage.message_id;
          console.log(`✅ Ad published to channel ${config.CHANNEL_ID}, message ID: ${telegramMessageId}`);
        }
      } catch (sendError) {
        error = sendError.message;
        console.error('Telegram send error:', sendError.message);
        
        // Пытаемся отправить упрощенное сообщение
        try {
          const simpleMessage = `🌸 ${title}\n\n💰 Цена: ${price}\n📞 Контакты: ${contactInfo}\n\n#цветы`;
          sentMessage = await bot.sendMessage(config.CHANNEL_ID, simpleMessage);
          if (sentMessage) {
            telegramMessageId = sentMessage.message_id;
            error = 'Сообщение отправлено в упрощенном формате из-за ошибки форматирования';
            console.log(`✅ Ad published in simple format, message ID: ${telegramMessageId}`);
          }
        } catch (simpleError) {
          console.error('Simple send also failed:', simpleError.message);
        }
      }
    } else {
      error = 'Бот или канал не настроены';
      console.warn('Bot or channel not configured, ad not published to Telegram');
    }
    
    // Создаем объявление
    const adId = generateAdId();
    const ad = {
      id: adId,
      title,
      description,
      price,
      contactInfo,
      photos: photos || [],
      telegramMessageId,
      publishedAt: new Date(),
      status: telegramMessageId ? 'published' : 'failed',
      error: error,
      userId: user.telegramId,
      userName: user.googleInfo?.name || user.telegramInfo.firstName,
      userTelegramId: user.telegramId,
      metadata: {
        characterCount: title.length + description.length,
        hasPhotos: photos && photos.length > 0,
        photoCount: photos ? photos.length : 0,
        sentToTelegram: !!telegramMessageId
      }
    };
    
    // Сохраняем объявление
    ads.set(adId, ad);
    
    // Добавляем в историю пользователя
    user.ads = user.ads || [];
    user.ads.push(adId);
    
    // Обновляем статистику пользователя
    user.stats.adsPublished = (user.stats.adsPublished || 0) + 1;
    user.stats.lastAdDate = new Date();
    
    // Обновляем индекс объявлений пользователя
    if (!userAds.has(user.telegramId)) {
      userAds.set(user.telegramId, []);
    }
    userAds.get(user.telegramId).push(adId);
    
    // Удаляем черновик
    delete user.draft;
    
    // Обновляем активность
    user.lastActivity = new Date();
    users.set(user.telegramId, user);
    sessions.set(sessionToken, user);
    
    // Отправляем уведомление пользователю
    if (botInitialized && user.telegramId) {
      try {
        let userMessage;
        
        if (telegramMessageId) {
          const channelUsername = config.CHANNEL_ID ? config.CHANNEL_ID.replace('@', '') : 'flowers_market_kg';
          const messageLink = `https://t.me/${channelUsername}/${telegramMessageId}`;
          
          userMessage = `✅ *Ваше объявление опубликовано!*\n\n` +
            `*Заголовок:* ${title}\n` +
            `*Цена:* ${price}\n` +
            `*Контакты:* ${contactInfo}\n\n` +
            `📢 *Ссылка на объявление:*\n` +
            `${messageLink}\n\n` +
            `💡 *Совет:* Отвечайте быстро на запросы покупателей!`;
        } else {
          userMessage = `⚠️ *Объявление не опубликовано в Telegram*\n\n` +
            `*Заголовок:* ${title}\n` +
            `*Цена:* ${price}\n` +
            `*Контакты:* ${contactInfo}\n\n` +
            `*Причина:* ${error || 'Ошибка при отправке'}\n\n` +
            `📋 *Объявление сохранено в вашей истории.*`;
        }
        
        const webAppUrl = `${config.FRONTEND_URL}?session=${sessionToken}`;
        
        const keyboard = {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: telegramMessageId ? '🌺 Создать еще' : '🔄 Попробовать снова',
                  web_app: { url: webAppUrl }
                }
              ],
              telegramMessageId ? [
                {
                  text: '📋 Мои объявления',
                  callback_data: 'my_ads'
                }
              ] : []
            ]
          }
        };
        
        await bot.sendMessage(user.telegramId, userMessage, { 
          parse_mode: 'Markdown',
          ...keyboard,
          disable_web_page_preview: true
        });
        
        console.log(`📤 User notification sent to ${user.telegramId}`);
      } catch (notifyError) {
        console.error('Could not notify user:', notifyError.message);
      }
    }
    
    // Отправляем уведомление администратору о новом объявлении
    if (botInitialized && config.ADMIN_CHAT_ID && telegramMessageId) {
      try {
        const adminMessage = `📢 *Новое объявление опубликовано*\n\n` +
          `• Заголовок: ${title}\n` +
          `• Цена: ${price}\n` +
          `• Автор: ${user.googleInfo?.name || user.telegramInfo.firstName}\n` +
          `• Telegram: ${user.telegramInfo.username ? '@' + user.telegramInfo.username : user.telegramId}\n` +
          `• ID сообщения: ${telegramMessageId}\n` +
          `• Время: ${new Date().toLocaleString('ru-RU')}`;
        
        await bot.sendMessage(config.ADMIN_CHAT_ID, adminMessage, { 
          parse_mode: 'Markdown',
          disable_web_page_preview: true
        });
      } catch (adminError) {
        console.error('Admin notification failed:', adminError.message);
      }
    }
    
    const response = {
      success: true,
      message: telegramMessageId ? '✅ Объявление успешно опубликовано в Telegram!' : '📋 Объявление сохранено (но не опубликовано в Telegram)',
      adId: adId,
      telegramMessageId: telegramMessageId,
      publishedAt: ad.publishedAt,
      error: error,
      stats: {
        userAdsCount: user.ads.length,
        totalAdsPublished: user.stats.adsPublished
      }
    };
    
    if (telegramMessageId && config.CHANNEL_ID) {
      const channelUsername = config.CHANNEL_ID.replace('@', '');
      response.telegramLink = `https://t.me/${channelUsername}/${telegramMessageId}`;
    }
    
    res.json(response);
    
  } catch (error) {
    console.error('❌ Error publishing ad:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Ошибка публикации объявления',
      code: 'AD_PUBLISH_ERROR',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Получение объявлений пользователя
app.get('/api/user/:telegramId/ads', async (req, res) => {
  try {
    const telegramId = req.params.telegramId;
    const { limit = 50, offset = 0 } = req.query;
    
    console.log(`GET /api/user/${telegramId}/ads`);
    
    const user = users.get(telegramId);
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }
    
    const userAdIds = userAds.get(telegramId) || [];
    const userAdsList = userAdIds
      .map(id => ads.get(id))
      .filter(ad => ad)
      .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
      .slice(offset, offset + parseInt(limit));
    
    res.json({
      success: true,
      ads: userAdsList,
      total: userAdIds.length,
      returned: userAdsList.length,
      offset: parseInt(offset),
      limit: parseInt(limit)
    });
    
  } catch (error) {
    console.error('Error getting user ads:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Ошибка загрузки объявлений'
    });
  }
});

// Выход
app.post('/api/logout', async (req, res) => {
  try {
    const { sessionToken } = req.body;
    
    console.log(`POST /api/logout for session ${sessionToken ? sessionToken.substring(0, 10) + '...' : 'none'}`);
    
    if (sessionToken && sessions.has(sessionToken)) {
      const user = sessions.get(sessionToken);
      if (user) {
        user.isLoggedIn = false;
        user.sessionToken = null;
        users.set(user.telegramId, user);
      }
      sessions.delete(sessionToken);
      console.log(`👋 User logged out, session: ${sessionToken.substring(0, 10)}...`);
    }
    
    res.json({ 
      success: true, 
      message: 'Logged out successfully'
    });
    
  } catch (error) {
    console.error('Error logging out:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Ошибка выхода из системы'
    });
  }
});

// Очистка старых данных
function cleanupOldData() {
  const now = new Date();
  let cleaned = { sessions: 0, pendingAuth: 0, telegramData: 0, ads: 0 };
  
  // Очистка сессий (7 дней)
  const SESSION_TIMEOUT = 7 * 24 * 60 * 60 * 1000;
  sessions.forEach((user, sessionToken) => {
    if (now - user.lastActivity > SESSION_TIMEOUT) {
      sessions.delete(sessionToken);
      cleaned.sessions++;
    }
  });
  
  // Очистка pending auth (10 минут)
  const PENDING_TIMEOUT = 10 * 60 * 1000;
  pendingAuth.forEach((data, token) => {
    if (now - data.timestamp > PENDING_TIMEOUT) {
      pendingAuth.delete(token);
      cleaned.pendingAuth++;
    }
  });
  
  // Очистка telegram данных (5 минут)
  const TELEGRAM_TIMEOUT = 5 * 60 * 1000;
  telegramData.forEach((data, tempId) => {
    if (now - data.timestamp > TELEGRAM_TIMEOUT) {
      telegramData.delete(tempId);
      cleaned.telegramData++;
    }
  });
  
  // Очистка старых объявлений (30 дней)
  const AD_TIMEOUT = 30 * 24 * 60 * 60 * 1000;
  ads.forEach((ad, adId) => {
    if (now - new Date(ad.publishedAt) > AD_TIMEOUT) {
      ads.delete(adId);
      cleaned.ads++;
    }
  });
  
  if (cleaned.sessions > 0 || cleaned.pendingAuth > 0 || cleaned.telegramData > 0 || cleaned.ads > 0) {
    console.log(`🧹 Cleanup: ${cleaned.sessions} sessions, ${cleaned.pendingAuth} pending auth, ${cleaned.telegramData} telegram data, ${cleaned.ads} old ads`);
  }
}

// Запускаем очистку каждый час
setInterval(cleanupOldData, 60 * 60 * 1000);

// 404 handler - ДОЛЖЕН БЫТЬ ПОСЛЕ ВСЕХ МАРШРУТОВ
app.use((req, res) => {
  console.log(`❌ 404 Not Found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({
    success: false,
    error: 'Route not found',
    requestedUrl: req.originalUrl,
    method: req.method,
    availableEndpoints: [
      'GET /',
      'GET /health',
      'GET /api/stats',
      'GET /api/telegram-data/:tempId',
      'GET /api/user/check/:telegramId',
      'POST /api/auth/google/url',
      'GET /api/auth/google/callback',
      'GET /api/session/:sessionToken',
      'POST /api/draft/save',
      'GET /api/draft/:sessionToken',
      'POST /api/upload/image',
      'POST /api/publish-ad',
      'GET /api/user/:telegramId/ads',
      'POST /api/logout'
    ]
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('❌ Server error:', err);
  res.status(500).json({ 
    success: false,
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
    code: 'INTERNAL_SERVER_ERROR'
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log('='.repeat(60));
  console.log('🚀 FLOWER MARKET BACKEND ЗАПУЩЕН');
  console.log('='.repeat(60));
  console.log(`📡 Server: http://0.0.0.0:${PORT}`);
  console.log(`🌐 Public URL: ${config.BACKEND_URL}`);
  console.log(`🔗 Frontend: ${config.FRONTEND_URL}`);
  console.log('='.repeat(60));
  console.log('✅ Services:');
  console.log(`   • Telegram Bot: ${botInitialized ? '✅ Active' : '❌ Inactive'}`);
  console.log(`   • Google OAuth: ${googleClient ? '✅ Initialized' : '❌ Not configured'}`);
  console.log(`   • Channel: ${config.CHANNEL_ID || '❌ Not set'}`);
  console.log('='.repeat(60));
  console.log('📋 Available endpoints:');
  console.log(`   • GET  / - API information`);
  console.log(`   • GET  /health - Health check`);
  console.log(`   • GET  /api/telegram-data/:tempId - Get Telegram user data`);
  console.log(`   • POST /api/auth/google/url - Get Google OAuth URL`);
  console.log(`   • GET  /api/auth/google/callback - Google OAuth callback`);
  console.log(`   • GET  /api/session/:sessionToken - Check session`);
  console.log(`   • POST /api/publish-ad - Publish advertisement`);
  console.log('='.repeat(60));
  console.log('💡 Next steps:');
  console.log('   1. Test the API: Open ' + config.BACKEND_URL + '/');
  console.log('   2. Check health: ' + config.BACKEND_URL + '/health');
  console.log('   3. Set BOT_TOKEN in environment for Telegram bot');
  console.log('   4. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET for Google auth');
  console.log('='.repeat(60));
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down Flower Market Backend...');
  
  if (bot && botInitialized) {
    console.log('Stopping Telegram bot polling...');
    bot.stopPolling();
  }
  
  console.log('✅ Server shutdown complete');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM, shutting down...');
  
  if (bot && botInitialized) {
    bot.stopPolling();
  }
  
  process.exit(0);
});

// Export for testing
module.exports = app;