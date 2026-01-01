const express = require('express');
const cors = require('cors');
const { OAuth2Client } = require('google-auth-library');
const TelegramBot = require('node-telegram-bot-api');
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
console.log('- GOOGLE_CLIENT_ID:', process.env.GOOGLE_CLIENT_ID ? `✓ Set (${process.env.GOOGLE_CLIENT_ID})` : '✗ Missing');
console.log('- CHANNEL_ID:', process.env.CHANNEL_ID ? '✓ Set' : '✗ Missing');
console.log('- ADMIN_CHAT_ID:', process.env.ADMIN_CHAT_ID ? '✓ Set' : '✗ Missing');
console.log('- FRONTEND_URL:', process.env.FRONTEND_URL || 'Not set');
console.log('- NODE_ENV:', process.env.NODE_ENV || 'development');

// Инициализация Google OAuth с проверкой
let googleClient = null;
const googleClientId = process.env.GOOGLE_CLIENT_ID;

if (googleClientId && googleClientId.trim() && !googleClientId.includes('your_client_id')) {
  try {
    console.log('🔑 Initializing Google OAuth with Client ID:', googleClientId.substring(0, 20) + '...');
    
    // Важно: для Google OAuth используем тот же Client ID что и на фронтенде
    googleClient = new OAuth2Client(
      googleClientId,
      '', // client secret - не требуется для веб-приложений
      ''  // redirect URI - не требуется для ID токена
    );
    
    console.log('✅ Google OAuth client initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize Google OAuth:', error.message);
    googleClient = null;
  }
} else {
  console.warn('⚠️ GOOGLE_CLIENT_ID is missing or invalid:', googleClientId);
}

const channelId = process.env.CHANNEL_ID;
const adminChatId = process.env.ADMIN_CHAT_ID;

// Хранение пользователей
const users = new Map();

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
    bot.onText(/\/start/, (msg) => {
      const chatId = msg.chat.id;
      const userId = msg.from.id.toString();
      const firstName = msg.from.first_name || 'Пользователь';
      
      if (!users.has(userId)) {
        users.set(userId, {
          id: userId,
          telegramId: userId,
          name: firstName,
          isLoggedIn: false,
          createdAt: new Date(),
          isApproved: true,
          ads: []
        });
      }
      
      bot.sendMessage(chatId, 
        `Добро пожаловать в Flower Market, ${firstName}! 🌸\n\n` +
        `*Ваш ID:* \`${userId}\`\n\n` +
        `Сохраните ваш ID, он понадобится для авторизации.`, 
        { 
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              {
                text: '🌺 Создать объявление',
                web_app: { url: process.env.FRONTEND_URL || 'https://flowers-telegram-kyrgyzstan.up.railway.app' }
              }
            ]]
          }
        }
      );
    });

    // Команда /id
    bot.onText(/\/id/, (msg) => {
      const chatId = msg.chat.id;
      const userId = msg.from.id;
      
      bot.sendMessage(chatId,
        `*Ваш Telegram ID:* \`${userId}\`\n\n` +
        `Сохраните этот ID. Он понадобится для авторизации.`,
        { parse_mode: 'Markdown' }
      );
    });

    bot.on('polling_error', (error) => {
      console.error('❌ Polling error:', error.message);
    });

    bot.getMe().then(botInfo => {
      console.log(`✅ Telegram Bot started: @${botInfo.username}`);
      botInitialized = true;
      
      bot.setMyCommands([
        { command: 'start', description: 'Запустить бота' },
        { command: 'id', description: 'Показать мой ID' }
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

app.get('/', (req, res) => {
  res.json({
    status: 'Flower Market API',
    message: 'Server is running',
    googleOAuth: googleClient ? 'active' : 'inactive',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    usersCount: users.size,
    botInitialized: botInitialized,
    googleOAuthInitialized: !!googleClient,
    googleClientIdExists: !!process.env.GOOGLE_CLIENT_ID,
    environment: process.env.NODE_ENV || 'development'
  });
});

// Важная функция для проверки Google токена
async function verifyGoogleToken(token) {
  if (!googleClient) {
    throw new Error('Google OAuth not configured');
  }

  try {
    console.log('🔐 Verifying Google token...');
    
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    console.log('✅ Google token verified for:', payload.email);
    
    return {
      googleId: payload.sub,
      name: payload.name,
      email: payload.email,
      picture: payload.picture,
      emailVerified: payload.email_verified
    };
  } catch (error) {
    console.error('❌ Google token verification failed:', error.message);
    throw new Error('Invalid Google token: ' + error.message);
  }
}

// Авторизация через Google
app.post('/api/auth/google', async (req, res) => {
  console.log('🔐 Google auth endpoint called');
  
  try {
    const { token, telegramUserId } = req.body;
    
    if (!token) {
      return res.status(400).json({ 
        success: false, 
        error: 'No Google token provided' 
      });
    }

    if (!telegramUserId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Telegram User ID is required' 
      });
    }

    // Проверяем Google OAuth
    if (!googleClient) {
      console.error('❌ Google OAuth not initialized');
      return res.status(500).json({ 
        success: false, 
        error: 'Google OAuth is not configured on the server',
        details: 'Check GOOGLE_CLIENT_ID environment variable'
      });
    }

    // Верифицируем токен
    let googleUser;
    try {
      googleUser = await verifyGoogleToken(token);
    } catch (verifyError) {
      return res.status(401).json({ 
        success: false, 
        error: 'Google authentication failed',
        details: verifyError.message
      });
    }

    // Создаем или обновляем пользователя
    const user = {
      id: telegramUserId,
      telegramId: telegramUserId,
      googleId: googleUser.googleId,
      name: googleUser.name,
      email: googleUser.email,
      picture: googleUser.picture,
      isLoggedIn: true,
      createdAt: new Date(),
      isApproved: true,
      ads: [],
      lastLogin: new Date()
    };

    // Сохраняем пользователя
    const existingUser = users.get(telegramUserId);
    if (existingUser) {
      // Сохраняем существующие объявления
      user.ads = existingUser.ads || [];
      user.createdAt = existingUser.createdAt || user.createdAt;
    }

    users.set(telegramUserId, user);
    
    console.log(`✅ User authenticated: ${user.name} (${user.email})`);

    // Отправляем приветственное сообщение
    if (botInitialized && bot) {
      try {
        const welcomeMsg = `👋 *Добро пожаловать, ${user.name}!*\n\n` +
          `✅ Вы успешно авторизовались.\n` +
          `📧 Email: ${user.email}\n\n` +
          `Теперь вы можете создавать объявления о продаже цветов!`;
        
        await bot.sendMessage(user.telegramId, welcomeMsg, { parse_mode: 'Markdown' });
      } catch (botError) {
        console.log('⚠️ Could not send welcome message:', botError.message);
      }
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        telegramId: user.telegramId,
        name: user.name,
        email: user.email,
        picture: user.picture,
        isApproved: user.isApproved,
        adsCount: user.ads.length
      }
    });

  } catch (error) {
    console.error('❌ Google auth error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Authentication failed',
      details: error.message 
    });
  }
});

// Проверка статуса пользователя
app.get('/api/user/:userId/status', async (req, res) => {
  try {
    const userId = req.params.userId;
    const user = users.get(userId);
    
    if (user && user.isLoggedIn) {
      return res.json({
        isLoggedIn: true,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          picture: user.picture,
          isApproved: user.isApproved || false,
          telegramId: user.telegramId,
          adsCount: (user.ads || []).length
        }
      });
    }
    
    res.json({ isLoggedIn: false });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Публикация объявления
app.post('/api/publish-ad', async (req, res) => {
  try {
    const { userId, title, description, price, contactInfo } = req.body;
    
    console.log(`📝 New ad from ${userId}: ${title}`);
    
    const user = users.get(userId);
    if (!user || !user.isLoggedIn) {
      return res.status(401).json({ 
        success: false, 
        error: 'User not authenticated' 
      });
    }

    // Формируем сообщение
    const telegramMessage = `🌸 *${title}* 🌸\n\n` +
                   `📝 *Описание:*\n${description}\n\n` +
                   `💰 *Цена:* ${price}\n` +
                   `📞 *Контакты:* ${contactInfo}\n\n` +
                   `👤 *Продавец:* ${user.name}\n` +
                   `🕒 *Дата:* ${new Date().toLocaleString('ru-RU')}\n\n` +
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
        console.error('Telegram send error:', error);
      }
    } else {
      error = 'Bot or channel not configured';
    }

    // Сохраняем объявление
    const ad = {
      id: Date.now(),
      title,
      description,
      price,
      contactInfo,
      telegramMessageId,
      publishedAt: new Date(),
      status: telegramMessageId ? 'published' : 'failed'
    };

    user.ads = user.ads || [];
    user.ads.push(ad);
    users.set(userId, user);

    // Уведомляем пользователя
    if (botInitialized && user.telegramId) {
      try {
        if (telegramMessageId) {
          await bot.sendMessage(user.telegramId, 
            `✅ *Ваше объявление опубликовано!*\n\n` +
            `*Заголовок:* ${title}\n` +
            `*Цена:* ${price}\n\n` +
            `📢 Объявление в канале: @flowers_market_kg`,
            { parse_mode: 'Markdown' }
          );
        }
      } catch (notifyError) {
        console.log('Could not notify user:', notifyError.message);
      }
    }

    res.json({
      success: true,
      message: telegramMessageId ? 'Объявление опубликовано!' : 'Объявление сохранено',
      adId: ad.id,
      telegramMessageId,
      error: error
    });

  } catch (error) {
    console.error('Error publishing ad:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to publish ad'
    });
  }
});

// Проверка статуса одобрения
app.get('/api/user/:userId/approval-status', (req, res) => {
  const userId = req.params.userId;
  const user = users.get(userId);
  
  res.json({
    isApproved: user ? (user.isApproved || false) : false
  });
});

// Информация о пользователе
app.get('/api/user/:userId', (req, res) => {
  const userId = req.params.userId;
  const user = users.get(userId);
  
  if (user) {
    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        picture: user.picture,
        isApproved: user.isApproved,
        telegramId: user.telegramId,
        adsCount: user.ads.length
      }
    });
  } else {
    res.status(404).json({ success: false, error: 'User not found' });
  }
});

// Тестовый эндпоинт
app.get('/api/test', (req, res) => {
  res.json({
    status: 'ok',
    googleOAuth: !!googleClient,
    botInitialized: botInitialized,
    timestamp: new Date().toISOString()
  });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌍 CORS enabled for: https://flowers-telegram-kyrgyzstan.up.railway.app`);
  console.log(`🔑 Google OAuth: ${googleClient ? '✅ Initialized' : '❌ Not initialized'}`);
  console.log(`🤖 Telegram Bot: ${botInitialized ? '✅ Active' : '❌ Inactive'}`);
});

process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  if (bot) bot.stopPolling();
  process.exit(0);
});