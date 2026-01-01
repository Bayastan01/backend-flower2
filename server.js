const express = require('express');
const cors = require('cors');
const { OAuth2Client } = require('google-auth-library');
const TelegramBot = require('node-telegram-bot-api');
const crypto = require('crypto');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors({
  origin: ['https://flowers-telegram-kyrgyzstan.up.railway.app'],
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
let googleClient;
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  googleClient = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.BACKEND_URL || 'https://backend-flower2-production.up.railway.app'}/api/auth/google/callback`
  );
  console.log('✅ Google OAuth initialized');
} else {
  console.error('❌ GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not found');
  googleClient = null;
}

const channelId = process.env.CHANNEL_ID;
const adminChatId = process.env.ADMIN_CHAT_ID;

// Хранение данных
const users = new Map();
const sessions = new Map();
const telegramData = new Map();
const pendingAuth = new Map();

// Генерация сессионного токена
function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function generateTempId() {
  return 'temp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function generateStateToken() {
  return 'state_' + Date.now() + '_' + crypto.randomBytes(16).toString('hex');
}

// Инициализация Telegram бота
let bot;
let botInitialized = false;

function initializeTelegramBot() {
  if (!process.env.BOT_TOKEN) {
    console.warn('⚠️ BOT_TOKEN not found, Telegram bot disabled');
    return;
  }

  try {
    console.log('🤖 Initializing Telegram bot...');
    
    bot = new TelegramBot(process.env.BOT_TOKEN, {
      polling: {
        interval: 3000,
        timeout: 30,
        autoStart: true,
        params: { timeout: 30 }
      }
    });

    // Команда /start
    bot.onText(/\/start/, async (msg) => {
      const chatId = msg.chat.id;
      const telegramId = msg.from.id.toString();
      const firstName = msg.from.first_name || 'Пользователь';
      
      console.log(`👤 User /start: ${firstName} (ID: ${telegramId})`);
      
      // Создаем или получаем пользователя
      let user = users.get(telegramId);
      
      if (!user) {
        user = {
          id: telegramId,
          telegramId: telegramId,
          telegramInfo: {
            firstName: msg.from.first_name,
            lastName: msg.from.last_name,
            username: msg.from.username,
            languageCode: msg.from.language_code || 'ru',
            isBot: msg.from.is_bot || false
          },
          googleInfo: null,
          isLoggedIn: false,
          createdAt: new Date(),
          isApproved: true,
          ads: [],
          sessionToken: null,
          lastActivity: new Date()
        };
        users.set(telegramId, user);
        console.log(`✅ New Telegram user created: ${firstName} (${telegramId})`);
      }
      
      // Генерируем временный ID
      const tempId = generateTempId();
      telegramData.set(tempId, {
        telegramId: telegramId,
        firstName: firstName,
        username: msg.from.username,
        timestamp: Date.now()
      });
      
      // Чистим через 5 минут
      setTimeout(() => {
        telegramData.delete(tempId);
      }, 5 * 60 * 1000);
      
      // Отправляем сообщение с кнопкой
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
      
      try {
        await bot.sendMessage(chatId, message, { 
          parse_mode: 'Markdown', 
          ...keyboard 
        });
      } catch (error) {
        console.error('Error sending start message:', error.message);
      }
    });

    // Успешная инициализация
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
}

initializeTelegramBot();

// ==================== ROUTES ====================

// Корневой маршрут - ДОБАВЛЕН
app.get('/', (req, res) => {
  res.json({
    message: '🌺 Flower Market Backend API',
    version: '1.0.0',
    status: 'online',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/health',
      telegramData: '/api/telegram-data/:tempId',
      userCheck: '/api/user/check/:telegramId',
      googleAuthUrl: 'POST /api/auth/google/url',
      googleCallback: '/api/auth/google/callback',
      sessionCheck: '/api/session/:sessionToken',
      draftSave: 'POST /api/draft/save',
      draftGet: '/api/draft/:sessionToken',
      publishAd: 'POST /api/publish-ad',
      logout: 'POST /api/logout'
    },
    stats: {
      users: users.size,
      sessions: sessions.size,
      botInitialized: botInitialized,
      googleOAuth: !!googleClient
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
    googleClientId: process.env.GOOGLE_CLIENT_ID ? 'Set' : 'Missing',
    frontendUrl: process.env.FRONTEND_URL || 'Not set',
    backendUrl: process.env.BACKEND_URL || 'Not set',
    environment: process.env.NODE_ENV || 'development'
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

// Генерация URL для авторизации Google
app.post('/api/auth/google/url', (req, res) => {
  try {
    const { telegramId } = req.body;
    
    if (!telegramId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Telegram ID is required' 
      });
    }

    if (!googleClient) {
      return res.status(500).json({ 
        success: false, 
        error: 'Google OAuth not configured' 
      });
    }

    // Генерируем state токен
    const stateToken = generateStateToken();
    pendingAuth.set(stateToken, {
      telegramId: telegramId,
      timestamp: Date.now()
    });

    // Очищаем через 10 минут
    setTimeout(() => {
      pendingAuth.delete(stateToken);
    }, 10 * 60 * 1000);

    // Генерируем URL для авторизации
    const authUrl = googleClient.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/userinfo.email'
      ],
      state: stateToken,
      prompt: 'consent',
      include_granted_scopes: true
    });

    console.log(`🔗 Generated Google auth URL for telegramId: ${telegramId}`);
    
    res.json({
      success: true,
      authUrl: authUrl,
      stateToken: stateToken
    });

  } catch (error) {
    console.error('❌ Error generating auth URL:', error.message);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to generate auth URL',
      details: error.message 
    });
  }
});

// Callback для Google OAuth
app.get('/api/auth/google/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;
    
    console.log('🔐 Google OAuth callback received');
    console.log('Code:', code ? 'Received' : 'Missing');
    console.log('State:', state || 'Missing');
    console.log('Error:', error || 'None');
    
    if (error) {
      return res.redirect(`${process.env.FRONTEND_URL || 'https://flowers-telegram-kyrgyzstan.up.railway.app'}/?error=${encodeURIComponent(error)}`);
    }

    if (!code || !state) {
      return res.redirect(`${process.env.FRONTEND_URL || 'https://flowers-telegram-kyrgyzstan.up.railway.app'}/?error=missing_code_or_state`);
    }

    // Проверяем state токен
    const pendingAuthData = pendingAuth.get(state);
    if (!pendingAuthData) {
      return res.redirect(`${process.env.FRONTEND_URL || 'https://flowers-telegram-kyrgyzstan.up.railway.app'}/?error=invalid_state_token`);
    }

    const { telegramId } = pendingAuthData;
    pendingAuth.delete(state);

    // Обмениваем код на токен
    const { tokens } = await googleClient.getToken(code);
    googleClient.setCredentials(tokens);

    // Получаем информацию о пользователе
    const ticket = await googleClient.verifyIdToken({
      idToken: tokens.id_token,
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
        sessionToken: null,
        lastActivity: new Date()
      };
      console.log(`👤 Created new user for Telegram ID: ${telegramId}`);
    }
    
    // Обновляем Google информацию
    user.googleInfo = {
      googleId: payload.sub,
      name: payload.name,
      email: payload.email,
      picture: payload.picture,
      emailVerified: payload.email_verified,
      locale: payload.locale,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token
    };
    
    user.isLoggedIn = true;
    user.lastActivity = new Date();
    
    // Генерируем сессию
    const sessionToken = generateSessionToken();
    user.sessionToken = sessionToken;
    sessions.set(sessionToken, user);
    
    // Сохраняем пользователя
    users.set(telegramId, user);
    
    console.log(`✅ User authenticated: ${user.googleInfo.name} (${user.googleInfo.email})`);
    
    // Отправляем уведомление администратору
    if (botInitialized && adminChatId) {
      try {
        let adminMessage = `📋 *Новый пользователь авторизовался*\n\n`;
        adminMessage += `👤 *Имя:* ${user.googleInfo.name}\n`;
        adminMessage += `📧 *Email:* ${user.googleInfo.email}\n`;
        adminMessage += `📱 *Telegram ID:* ${user.telegramId}\n`;
        
        if (user.telegramInfo.username) {
          adminMessage += `👤 *Telegram username:* @${user.telegramInfo.username}\n`;
        }
        
        adminMessage += `✅ *Статус:* Автоматически одобрен\n`;
        adminMessage += `⏰ *Время:* ${new Date().toLocaleString('ru-RU')}`;
        
        await bot.sendMessage(adminChatId, adminMessage, { parse_mode: 'Markdown' });
        console.log(`📤 Admin notification sent`);
      } catch (botError) {
        console.error('Admin notification failed:', botError.message);
      }
    }
    
    // Отправляем приветственное сообщение
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
        
        console.log(`📤 Welcome message sent to user ${user.telegramId}`);
      } catch (botError) {
        console.error('Welcome message failed:', botError.message);
      }
    }
    
    // Перенаправляем на frontend с сессией
    const redirectUrl = `${process.env.FRONTEND_URL || 'https://flowers-telegram-kyrgyzstan.up.railway.app'}?session=${sessionToken}`;
    res.redirect(redirectUrl);

  } catch (error) {
    console.error('❌ Google OAuth callback error:', error.message);
    const errorMessage = encodeURIComponent(error.message);
    res.redirect(`${process.env.FRONTEND_URL || 'https://flowers-telegram-kyrgyzstan.up.railway.app'}/?error=${errorMessage}`);
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
          isApproved: user.isApproved,
          telegramInfo: user.telegramInfo
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
    
    console.log(`💾 Draft saved for user ${user.telegramId}`);
    
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
    if (botInitialized && channelId) {
      try {
        const sentMessage = await bot.sendMessage(channelId, telegramMessage, {
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
          const chatId = channelId ? channelId.toString().replace('-100', '') : '';
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

// Очистка старых данных
setInterval(() => {
  const now = new Date();
  
  // Очистка сессий (7 дней)
  const SESSION_TIMEOUT = 7 * 24 * 60 * 60 * 1000;
  let deletedSessions = 0;
  sessions.forEach((user, sessionToken) => {
    if (now - user.lastActivity > SESSION_TIMEOUT) {
      sessions.delete(sessionToken);
      deletedSessions++;
    }
  });
  
  // Очистка pending auth (10 минут)
  const PENDING_TIMEOUT = 10 * 60 * 1000;
  let deletedPending = 0;
  pendingAuth.forEach((data, token) => {
    if (now - data.timestamp > PENDING_TIMEOUT) {
      pendingAuth.delete(token);
      deletedPending++;
    }
  });
  
  // Очистка telegram данных (5 минут)
  const TELEGRAM_TIMEOUT = 5 * 60 * 1000;
  let deletedTelegram = 0;
  telegramData.forEach((data, tempId) => {
    if (now - data.timestamp > TELEGRAM_TIMEOUT) {
      telegramData.delete(tempId);
      deletedTelegram++;
    }
  });
  
  if (deletedSessions > 0 || deletedPending > 0 || deletedTelegram > 0) {
    console.log(`🧹 Cleaned: ${deletedSessions} sessions, ${deletedPending} pending auth, ${deletedTelegram} telegram data`);
  }
}, 60 * 60 * 1000); // Каждый час

// 404 handler - должен быть ПОСЛЕ всех маршрутов
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
      'POST /api/auth/google/url',
      'GET /api/auth/google/callback',
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌍 CORS enabled for: https://flowers-telegram-kyrgyzstan.up.railway.app`);
  console.log(`🤖 Bot: ${botInitialized ? '✅ Active' : '❌ Inactive'}`);
  console.log(`🔑 Google OAuth: ${googleClient ? '✅ Initialized' : '❌ Not configured'}`);
  console.log(`\n=== SERVER STARTED SUCCESSFULLY ===`);
  console.log(`1. Main URL: https://backend-flower2-production.up.railway.app/`);
  console.log(`2. Health check: https://backend-flower2-production.up.railway.app/health`);
  console.log(`3. Google OAuth Callback: ${process.env.BACKEND_URL || 'https://backend-flower2-production.up.railway.app'}/api/auth/google/callback`);
});

process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  if (bot) bot.stopPolling();
  process.exit(0);
});