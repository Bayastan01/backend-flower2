const express = require('express');
const cors = require('cors');
const { OAuth2Client } = require('google-auth-library');
const TelegramBot = require('node-telegram-bot-api');
const crypto = require('crypto');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors({
  origin: ['https://flowers-telegram-kyrgyzstan.up.railway.app', 'https://flowers-telegram-kyrgyzstan.up.railway.app/'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));

app.options('*', cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Проверка переменных окружения
console.log('=== ENVIRONMENT CHECK ===');
console.log('- BOT_TOKEN:', process.env.BOT_TOKEN ? '✓ Set' : '✗ Missing');
console.log('- GOOGLE_CLIENT_ID:', process.env.GOOGLE_CLIENT_ID ? '✓ Set' : '✗ Missing');
console.log('- GOOGLE_CLIENT_SECRET:', process.env.GOOGLE_CLIENT_SECRET ? '✓ Set' : '✗ Missing');
console.log('- CHANNEL_ID:', process.env.CHANNEL_ID ? '✓ Set' : '✗ Missing');
console.log('- ADMIN_CHAT_ID:', process.env.ADMIN_CHAT_ID ? '✓ Set' : '✗ Missing');
console.log('- FRONTEND_URL:', process.env.FRONTEND_URL || 'Not set');
console.log('- BACKEND_URL:', process.env.BACKEND_URL || 'Not set');
console.log('- NODE_ENV:', process.env.NODE_ENV || 'development');

// Инициализация Google OAuth
let googleClient = null;
let bot = null;
let botInitialized = false;

// Хранение данных
const users = new Map();
const sessions = new Map();
const telegramData = new Map();
const pendingAuth = new Map();

// Генерация токенов
function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function generateTempId() {
  return 'temp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function generateStateToken() {
  return 'state_' + Date.now() + '_' + crypto.randomBytes(16).toString('hex');
}

// Инициализация
function initializeServices() {
  // Google OAuth
  if (process.env.GOOGLE_CLIENT_ID) {
    try {
      googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
      console.log('✅ Google OAuth initialized (simple mode)');
    } catch (error) {
      console.error('❌ Google OAuth init error:', error.message);
    }
  }
  
  // Telegram Bot
  if (process.env.BOT_TOKEN) {
    try {
      console.log('🤖 Initializing Telegram bot...');
      bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
      
      bot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id;
        const telegramId = msg.from.id.toString();
        const firstName = msg.from.first_name || 'Пользователь';
        
        console.log(`👤 User /start: ${firstName} (ID: ${telegramId})`);
        
        let user = users.get(telegramId);
        if (!user) {
          user = {
            id: telegramId,
            telegramId: telegramId,
            telegramInfo: {
              firstName: msg.from.first_name,
              username: msg.from.username
            },
            googleInfo: null,
            isLoggedIn: false,
            createdAt: new Date(),
            isApproved: true
          };
          users.set(telegramId, user);
        }
        
        const tempId = generateTempId();
        telegramData.set(tempId, {
          telegramId: telegramId,
          firstName: firstName,
          username: msg.from.username,
          timestamp: Date.now()
        });
        
        setTimeout(() => telegramData.delete(tempId), 5 * 60 * 1000);
        
        const frontendUrl = process.env.FRONTEND_URL || 'https://flowers-telegram-kyrgyzstan.up.railway.app';
        const webAppUrl = `${frontendUrl}?telegram_id=${telegramId}&temp_id=${tempId}`;
        
        const keyboard = {
          reply_markup: {
            inline_keyboard: [[
              {
                text: '🌺 Создать объявление',
                web_app: { url: webAppUrl }
              }
            ]]
          }
        };
        
        let message = `Добро пожаловать в Flower Market, ${firstName}! 🌸\n\n`;
        
        if (user.googleInfo) {
          message += `✅ Вы уже авторизованы как ${user.googleInfo.name}\n`;
          message += `📧 Email: ${user.googleInfo.email}\n\n`;
          message += `Нажмите кнопку ниже, чтобы создать новое объявление.`;
        } else {
          message += `Для создания объявлений нужно:\n`;
          message += `1. Нажать кнопку ниже\n`;
          message += `2. Войти через Google\n`;
          message += `3. Заполнить форму объявления\n\n`;
          message += `*Ваш Telegram ID:* \`${telegramId}\``;
        }
        
        await bot.sendMessage(chatId, message, { 
          parse_mode: 'Markdown', 
          ...keyboard 
        });
      });
      
      bot.getMe().then(botInfo => {
        console.log(`✅ Telegram Bot started: @${botInfo.username}`);
        botInitialized = true;
        bot.setMyCommands([
          { command: 'start', description: 'Запустить бота' },
          { command: 'help', description: 'Помощь' }
        ]);
      }).catch(error => {
        console.error('❌ Failed to get bot info:', error.message);
      });
      
    } catch (error) {
      console.error('❌ Failed to initialize Telegram bot:', error.message);
    }
  } else {
    console.warn('⚠️ BOT_TOKEN not found, Telegram bot disabled');
  }
}

// Запуск инициализации
initializeServices();

// ==================== ROUTES ====================

// КОРНЕВОЙ МАРШРУТ
app.get('/', (req, res) => {
  res.json({
    message: '🌺 Flower Market Backend API',
    version: '1.0.0',
    status: 'online',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    services: {
      telegramBot: botInitialized ? '✅ Active' : '❌ Inactive',
      googleOAuth: googleClient ? '✅ Initialized' : '❌ Not configured'
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
      logout: 'POST /api/logout'
    }
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    usersCount: users.size,
    sessionsCount: sessions.size,
    botInitialized: botInitialized,
    googleOAuthInitialized: !!googleClient,
    environment: process.env.NODE_ENV || 'development',
    requiredEnvVars: {
      BOT_TOKEN: process.env.BOT_TOKEN ? '✓ Set' : '✗ Missing',
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ? '✓ Set' : '✗ Missing',
      GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ? '✓ Set' : '✗ Missing',
      CHANNEL_ID: process.env.CHANNEL_ID ? '✓ Set' : '✗ Missing'
    }
  });
});

// Получение информации о Telegram пользователе
app.get('/api/telegram-data/:tempId', (req, res) => {
  try {
    const tempId = req.params.tempId;
    const data = telegramData.get(tempId);
    
    if (data) {
      telegramData.delete(tempId);
      res.json({
        success: true,
        telegramId: data.telegramId,
        firstName: data.firstName,
        username: data.username
      });
    } else {
      res.json({ 
        success: false, 
        error: 'Telegram data not found or expired' 
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Проверка пользователя
app.get('/api/user/check/:telegramId', (req, res) => {
  try {
    const telegramId = req.params.telegramId;
    const user = users.get(telegramId);
    
    if (user) {
      res.json({
        success: true,
        exists: true,
        isLoggedIn: user.isLoggedIn,
        user: {
          id: user.id,
          name: user.googleInfo?.name || user.telegramInfo.firstName,
          email: user.googleInfo?.email,
          picture: user.googleInfo?.picture,
          isApproved: user.isApproved
        }
      });
    } else {
      res.json({ 
        success: true,
        exists: false 
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Упрощенная авторизация через Google
app.post('/api/auth/google', async (req, res) => {
  console.log('🔐 Google auth request');
  
  try {
    const { token, telegramId } = req.body;
    
    if (!token || !telegramId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Token and Telegram ID are required' 
      });
    }

    if (!googleClient) {
      return res.status(500).json({ 
        success: false, 
        error: 'Google OAuth not configured' 
      });
    }

    // Верификация токена
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    console.log(`✅ Google auth successful for: ${payload.email}`);
    
    // Ищем или создаем пользователя
    let user = users.get(telegramId);
    if (!user) {
      user = {
        id: telegramId,
        telegramId: telegramId,
        telegramInfo: {
          firstName: 'Пользователь',
          languageCode: 'ru'
        },
        googleInfo: null,
        isLoggedIn: false,
        createdAt: new Date(),
        isApproved: true,
        ads: [],
        sessionToken: null,
        lastActivity: new Date()
      };
    }
    
    // Обновляем информацию
    user.googleInfo = {
      googleId: payload.sub,
      name: payload.name,
      email: payload.email,
      picture: payload.picture
    };
    
    user.isLoggedIn = true;
    user.lastActivity = new Date();
    
    // Генерируем сессию
    const sessionToken = generateSessionToken();
    user.sessionToken = sessionToken;
    sessions.set(sessionToken, user);
    users.set(telegramId, user);
    
    console.log(`✅ User authenticated: ${user.googleInfo.name}`);
    
    // Отправляем приветственное сообщение в Telegram
    if (botInitialized && user.telegramId) {
      try {
        const frontendUrl = process.env.FRONTEND_URL || 'https://flowers-telegram-kyrgyzstan.up.railway.app';
        const webAppUrl = `${frontendUrl}?session=${sessionToken}`;
        
        const welcomeMessage = `🎉 *Добро пожаловать, ${user.googleInfo.name}!*\n\n` +
          `✅ Вы успешно авторизовались в Flower Market.\n\n` +
          `Теперь вы можете создавать объявления о продаже цветов!`;
        
        const keyboard = {
          reply_markup: {
            inline_keyboard: [[
              {
                text: '🌺 Создать объявление',
                web_app: { url: webAppUrl }
              }
            ]]
          }
        };
        
        await bot.sendMessage(user.telegramId, welcomeMessage, { 
          parse_mode: 'Markdown',
          ...keyboard 
        });
      } catch (botError) {
        console.error('Welcome message failed:', botError.message);
      }
    }
    
    res.json({
      success: true,
      user: {
        id: user.id,
        telegramId: user.telegramId,
        name: user.googleInfo.name,
        email: user.googleInfo.email,
        picture: user.googleInfo.picture,
        isApproved: user.isApproved
      },
      sessionToken: sessionToken
    });

  } catch (error) {
    console.error('❌ Google auth error:', error.message);
    res.status(401).json({ 
      success: false, 
      error: 'Authentication failed',
      details: error.message 
    });
  }
});

// Проверка сессии
app.get('/api/session/:sessionToken', (req, res) => {
  try {
    const sessionToken = req.params.sessionToken;
    const user = sessions.get(sessionToken);
    
    if (user && user.isLoggedIn) {
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
          isApproved: user.isApproved
        },
        sessionToken: sessionToken
      });
    } else {
      res.json({ 
        success: false, 
        error: 'Session not found or expired' 
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Сохранение черновика
app.post('/api/draft/save', async (req, res) => {
  try {
    const { sessionToken, draftData } = req.body;
    
    if (!sessionToken) {
      return res.status(400).json({ success: false, error: 'Session token required' });
    }
    
    const user = sessions.get(sessionToken);
    if (!user || !user.isLoggedIn) {
      return res.status(401).json({ success: false, error: 'User not authenticated' });
    }
    
    user.draft = {
      ...draftData,
      savedAt: new Date(),
      updatedAt: new Date()
    };
    
    user.lastActivity = new Date();
    users.set(user.telegramId, user);
    sessions.set(sessionToken, user);
    
    res.json({
      success: true,
      message: 'Draft saved successfully',
      savedAt: user.draft.savedAt
    });
    
  } catch (error) {
    console.error('Error saving draft:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Получение черновика
app.get('/api/draft/:sessionToken', async (req, res) => {
  try {
    const sessionToken = req.params.sessionToken;
    const user = sessions.get(sessionToken);
    
    if (!user || !user.isLoggedIn) {
      return res.status(401).json({ success: false, error: 'User not authenticated' });
    }
    
    if (user.draft) {
      res.json({
        success: true,
        draft: user.draft,
        exists: true
      });
    } else {
      res.json({
        success: true,
        draft: null,
        exists: false
      });
    }
    
  } catch (error) {
    console.error('Error getting draft:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Публикация объявления
app.post('/api/publish-ad', async (req, res) => {
  try {
    const { sessionToken, title, description, price, contactInfo, photos } = req.body;
    
    if (!sessionToken) {
      return res.status(400).json({ success: false, error: 'Session token required' });
    }
    
    const user = sessions.get(sessionToken);
    if (!user || !user.isLoggedIn) {
      return res.status(401).json({ success: false, error: 'User not authenticated' });
    }
    
    console.log(`📝 New ad from ${user.telegramId}:`, { title, price });
    
    // Формируем сообщение
    let telegramMessage = `🌸 *${title}* 🌸\n\n` +
                   `📝 *Описание:*\n${description}\n\n` +
                   `💰 *Цена:* ${price}\n` +
                   `📞 *Контакты:* ${contactInfo}\n\n` +
                   `👤 *Продавец:* ${user.googleInfo?.name || user.telegramInfo.firstName}\n`;
    
    if (user.telegramInfo.username) {
      telegramMessage += `💬 *Telegram:* @${user.telegramInfo.username}\n`;
    }
    
    telegramMessage += `\n🕒 *Дата:* ${new Date().toLocaleString('ru-RU')}\n` +
                      `#цветы`;
    
    let telegramMessageId = null;
    let error = null;
    
    // Отправляем в канал
    if (botInitialized && process.env.CHANNEL_ID) {
      try {
        const sentMessage = await bot.sendMessage(process.env.CHANNEL_ID, telegramMessage, {
          parse_mode: 'Markdown'
        });
        
        if (sentMessage) {
          telegramMessageId = sentMessage.message_id;
          console.log(`✅ Ad published to channel, message ID: ${telegramMessageId}`);
        }
      } catch (sendError) {
        error = sendError.message;
        console.error('Telegram send error:', sendError.message);
      }
    } else {
      error = 'Bot or channel not configured';
    }
    
    // Создаем объявление
    const ad = {
      id: Date.now(),
      title,
      description,
      price,
      contactInfo,
      photos: photos || [],
      telegramMessageId,
      publishedAt: new Date(),
      status: telegramMessageId ? 'published' : 'failed',
      error: error
    };
    
    // Добавляем в историю
    user.ads = user.ads || [];
    user.ads.push(ad);
    
    delete user.draft;
    
    user.lastActivity = new Date();
    users.set(user.telegramId, user);
    sessions.set(sessionToken, user);
    
    // Уведомляем пользователя
    if (botInitialized && user.telegramId) {
      try {
        let userMessage;
        
        if (telegramMessageId) {
          const chatId = process.env.CHANNEL_ID ? process.env.CHANNEL_ID.toString().replace('-100', '') : '';
          const messageLink = `https://t.me/c/${chatId}/${telegramMessageId}`;
          userMessage = `✅ *Ваше объявление опубликовано!*\n\n` +
            `*Заголовок:* ${title}\n` +
            `*Цена:* ${price}\n\n` +
            `📢 *Ссылка на объявление:*\n` +
            `${messageLink}`;
        } else {
          userMessage = `⚠️ *Объявление не опубликовано*\n\n` +
            `*Заголовок:* ${title}\n` +
            `*Цена:* ${price}\n\n` +
            `*Причина:* ${error || 'Ошибка при отправке'}`;
        }
        
        const frontendUrl = process.env.FRONTEND_URL || 'https://flowers-telegram-kyrgyzstan.up.railway.app';
        const webAppUrl = `${frontendUrl}?session=${sessionToken}`;
        
        await bot.sendMessage(user.telegramId, userMessage, { 
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              {
                text: '🌺 Создать еще',
                web_app: { url: webAppUrl }
              }
            ]]
          }
        });
      } catch (notifyError) {
        console.error('Could not notify user:', notifyError.message);
      }
    }
    
    res.json({
      success: true,
      message: telegramMessageId ? 'Объявление успешно опубликовано!' : 'Объявление сохранено',
      adId: ad.id,
      telegramMessageId,
      error: error
    });
    
  } catch (error) {
    console.error('Error publishing ad:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to publish ad',
      details: error.message 
    });
  }
});

// Выход
app.post('/api/logout', async (req, res) => {
  try {
    const { sessionToken } = req.body;
    
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
    res.status(500).json({ success: false, error: error.message });
  }
});

// 404 handler
app.use((req, res) => {
  console.log(`404 Not Found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({
    error: 'Route not found',
    requestedUrl: req.originalUrl,
    method: req.method,
    availableEndpoints: [
      'GET /',
      'GET /health',
      'GET /api/telegram-data/:tempId',
      'GET /api/user/check/:telegramId',
      'POST /api/auth/google',
      'GET /api/session/:sessionToken',
      'POST /api/draft/save',
      'GET /api/draft/:sessionToken',
      'POST /api/publish-ad',
      'POST /api/logout'
    ]
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌍 CORS enabled for: https://flowers-telegram-kyrgyzstan.up.railway.app`);
  console.log(`🤖 Bot: ${botInitialized ? '✅ Active' : '❌ Inactive'}`);
  console.log(`🔑 Google OAuth: ${googleClient ? '✅ Initialized' : '❌ Not configured'}`);
  console.log(`\n=== IMPORTANT ===`);
  console.log(`1. Add environment variables in Railway dashboard:`);
  console.log(`   - BOT_TOKEN (from @BotFather)`);
  console.log(`   - GOOGLE_CLIENT_ID (from Google Cloud Console)`);
  console.log(`   - GOOGLE_CLIENT_SECRET (from Google Cloud Console)`);
  console.log(`2. Check logs for errors`);
});