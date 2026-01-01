const express = require('express');
const cors = require('cors');
const { OAuth2Client } = require('google-auth-library');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const app = express();

// Middleware - РАСШИРЕННЫЙ CORS
app.use(cors({
  origin: ['https://flowers-telegram-kyrgyzstan.up.railway.app', 'https://flowers-telegram-kyrgyzstan.up.railway.app/'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));

// Обработка preflight запросов
app.options('*', cors());

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Проверяем переменные окружения
console.log('=== ENVIRONMENT CHECK ===');
console.log('- BOT_TOKEN:', process.env.BOT_TOKEN ? '✓ Set' : '✗ Missing');
console.log('- GOOGLE_CLIENT_ID:', process.env.GOOGLE_CLIENT_ID ? `✓ Set (${process.env.GOOGLE_CLIENT_ID.substring(0, 10)}...)` : '✗ Missing');
console.log('- CHANNEL_ID:', process.env.CHANNEL_ID ? '✓ Set' : '✗ Missing');
console.log('- ADMIN_CHAT_ID:', process.env.ADMIN_CHAT_ID ? '✓ Set' : '✗ Missing');
console.log('- FRONTEND_URL:', process.env.FRONTEND_URL || 'Not set');
console.log('- NODE_ENV:', process.env.NODE_ENV || 'development');

// Инициализация Google OAuth
let googleClient;
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_ID.trim() !== '') {
  try {
    googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    console.log('✅ Google OAuth initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize Google OAuth:', error.message);
    googleClient = null;
  }
} else {
  console.warn('⚠️ GOOGLE_CLIENT_ID is empty or not set');
  googleClient = null;
}

const channelId = process.env.CHANNEL_ID;
const adminChatId = process.env.ADMIN_CHAT_ID;

// Хранение пользователей
const users = new Map();

// Инициализация Telegram бота с polling
let bot;
let botInitialized = false;

function initializeTelegramBot() {
  if (!process.env.BOT_TOKEN || process.env.BOT_TOKEN.trim() === '') {
    console.warn('⚠️ BOT_TOKEN not found or empty, Telegram bot disabled');
    return;
  }

  try {
    console.log('🤖 Initializing Telegram bot with polling...');
    
    // Создаем бота с polling
    bot = new TelegramBot(process.env.BOT_TOKEN, {
      polling: {
        interval: 3000,
        timeout: 30,
        autoStart: true,
        params: {
          timeout: 30
        }
      }
    });

    // Обработчик команды /start
    bot.onText(/\/start/, (msg) => {
      const chatId = msg.chat.id;
      const userId = msg.from.id.toString();
      const firstName = msg.from.first_name || 'Пользователь';
      const username = msg.from.username ? `@${msg.from.username}` : 'без username';
      
      console.log(`👤 User /start: ${firstName} (${username}, ID: ${userId})`);
      
      // Сохраняем пользователя если его еще нет
      if (!users.has(userId)) {
        const user = {
          id: userId,
          telegramId: userId,
          name: firstName,
          username: username,
          isLoggedIn: false,
          createdAt: new Date(),
          isApproved: true,
          ads: []
        };
        
        users.set(userId, user);
        console.log(`✅ Telegram user saved: ${firstName} (${userId})`);
      }
      
      const options = {
        reply_markup: {
          inline_keyboard: [[
            {
              text: '🌺 Создать объявление',
              web_app: { url: process.env.FRONTEND_URL || 'https://flowers-telegram-kyrgyzstan.up.railway.app' }
            }
          ]]
        }
      };
      
      bot.sendMessage(chatId, 
        `Добро пожаловать в Flower Market, ${firstName}! 🌸\n\n` +
        `Нажмите кнопку ниже, чтобы создать объявление о продаже цветов.\n\n` +
        `*Ваш ID:* \`${userId}\`\n` +
        `*Username:* ${username}\n\n` +
        `Сохраните ваш ID, он понадобится для авторизации.`, 
        { parse_mode: 'Markdown', ...options }
      ).catch(err => console.error('Error sending start message:', err.message));
    });

    // Обработчик команды /id
    bot.onText(/\/id/, (msg) => {
      const chatId = msg.chat.id;
      const userId = msg.from.id;
      const username = msg.from.username ? `@${msg.from.username}` : 'не указан';
      
      bot.sendMessage(chatId,
        `*Ваш Telegram ID:* \`${userId}\`\n` +
        `*Username:* ${username}\n\n` +
        `Сохраните этот ID. Он понадобится для авторизации в веб-приложении.\n\n` +
        `*Как использовать:*\n` +
        `1. Откройте веб-приложение по кнопке ниже\n` +
        `2. Войдите через Google\n` +
        `3. Введите этот ID когда спросят`,
        { 
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              {
                text: '🌺 Открыть веб-приложение',
                web_app: { url: process.env.FRONTEND_URL || 'https://flowers-telegram-kyrgyzstan.up.railway.app' }
              }
            ]]
          }
        }
      );
    });

    // Обработчик команды /help
    bot.onText(/\/help/, (msg) => {
      const chatId = msg.chat.id;
      
      bot.sendMessage(chatId,
        `*Flower Market Bot Help* 🌸\n\n` +
        `*/start* - Запустить бота и получить кнопку для создания объявления\n` +
        `*/id* - Показать ваш Telegram ID (нужен для авторизации)\n` +
        `*/help* - Показать это сообщение\n\n` +
        `*Как создать объявление:*\n` +
        `1. Нажмите /start и кнопку "Создать объявление"\n` +
        `2. Войдите через Google в веб-приложении\n` +
        `3. Введите ваш Telegram ID (команда /id)\n` +
        `4. Заполните форму объявления\n` +
        `5. Ваше объявление будет опубликовано в канале\n\n` +
        `*Канал с объявлениями:* @flowers_market_kg\n` +
        `*Проблемы?* Напишите админу.`,
        { 
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              {
                text: '🌺 Создать объявление',
                web_app: { url: process.env.FRONTEND_URL || 'https://flowers-telegram-kyrgyzstan.up.railway.app' }
              },
              {
                text: '📢 Наш канал',
                url: 'https://t.me/flowers_market_kg'
              }
            ]]
          }
        }
      );
    });

    // Обработчик ошибок polling
    bot.on('polling_error', (error) => {
      console.error('❌ Polling error:', error.code, error.message);
      
      if (error.code === 'EFATAL' || error.code === 'ETELEGRAM') {
        console.log('🔄 Restarting bot polling due to error...');
        setTimeout(() => {
          bot.stopPolling();
          bot.startPolling();
        }, 5000);
      }
    });

    // Успешная инициализация
    bot.getMe().then(botInfo => {
      console.log(`✅ Telegram Bot started: @${botInfo.username}`);
      console.log(`🤖 Bot ID: ${botInfo.id}`);
      console.log(`👋 Bot name: ${botInfo.first_name}`);
      botInitialized = true;
      
      bot.setMyCommands([
        { command: 'start', description: 'Запустить бота' },
        { command: 'id', description: 'Показать мой ID' },
        { command: 'help', description: 'Помощь' }
      ]).then(() => {
        console.log('✅ Bot commands configured');
      }).catch(err => {
        console.error('Error setting bot commands:', err.message);
      });
      
    }).catch(error => {
      console.error('❌ Failed to get bot info:', error.message);
      botInitialized = false;
    });

    console.log('🤖 Telegram bot polling initialized');
    
  } catch (error) {
    console.error('❌ Failed to initialize Telegram bot:', error.message);
    botInitialized = false;
  }
}

initializeTelegramBot();

async function sendTelegramMessage(chatId, message, options = {}) {
  if (!bot || !botInitialized) {
    console.warn('⚠️ Telegram bot not available');
    return null;
  }
  
  try {
    const result = await bot.sendMessage(chatId, message, options);
    console.log(`✅ Message sent to ${chatId}`);
    return result;
  } catch (error) {
    console.error('❌ Error sending Telegram message:', error.message);
    return null;
  }
}

// ==================== ROUTES ====================

app.get('/', (req, res) => {
  res.json({
    status: 'Flower Market Backend API',
    message: 'API is running',
    timestamp: new Date().toISOString(),
    botStatus: botInitialized ? 'active' : 'inactive',
    googleOAuthStatus: googleClient ? 'active' : 'inactive',
    usersCount: users.size,
    endpoints: {
      root: 'GET /',
      health: 'GET /health',
      userStatus: 'GET /api/user/:userId/status',
      googleAuth: 'POST /api/auth/google',
      publishAd: 'POST /api/publish-ad',
      getUser: 'GET /api/user/:userId',
      approvalStatus: 'GET /api/user/:userId/approval-status',
      sendTestMessage: 'POST /api/send-message/:chatId'
    }
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    usersCount: users.size,
    botInitialized: botInitialized,
    googleOAuthInitialized: !!googleClient,
    channelId: channelId || 'Not set',
    adminChatId: adminChatId || 'Not set',
    environment: process.env.NODE_ENV || 'development'
  });
});

app.post('/api/send-message/:chatId', async (req, res) => {
  try {
    const chatId = req.params.chatId;
    const { message } = req.body;
    
    const result = await sendTelegramMessage(chatId, message || 'Test message from Flower Market API');
    
    if (result) {
      res.json({ 
        success: true, 
        message: 'Message sent successfully',
        messageId: result.message_id 
      });
    } else {
      res.status(500).json({ 
        success: false, 
        error: 'Failed to send message. Bot might not be available.' 
      });
    }
    
  } catch (error) {
    console.error('Error sending test message:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

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
          googleId: user.googleId,
          isApproved: user.isApproved || false,
          telegramId: user.telegramId || null,
          adsCount: (user.ads || []).length
        }
      });
    }
    
    if (user && !user.isLoggedIn) {
      return res.json({
        isLoggedIn: false,
        telegramUser: {
          id: user.id,
          name: user.name,
          telegramId: user.telegramId,
          isApproved: user.isApproved || false
        }
      });
    }
    
    res.json({ isLoggedIn: false });
  } catch (error) {
    console.error('Error checking user status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/google', async (req, res) => {
  try {
    console.log('🔐 Google auth request received');
    const { token, telegramUserId } = req.body;
    
    if (!token) {
      console.log('❌ No token provided');
      return res.status(400).json({ 
        success: false, 
        error: 'No token provided' 
      });
    }

    if (!googleClient) {
      console.log('❌ Google OAuth not configured');
      return res.status(500).json({ 
        success: false, 
        error: 'Google OAuth not configured on server' 
      });
    }

    console.log('🔑 Verifying Google token...');
    
    try {
      // Верификация токена Google
      const ticket = await googleClient.verifyIdToken({
        idToken: token,
        audience: process.env.GOOGLE_CLIENT_ID
      });

      const payload = ticket.getPayload();
      console.log('✅ Google token verified for user:', payload.email);
      
      // Создаем или обновляем пользователя
      const userId = telegramUserId || `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const user = {
        id: userId,
        telegramId: telegramUserId,
        googleId: payload.sub,
        name: payload.name,
        email: payload.email,
        picture: payload.picture,
        isLoggedIn: true,
        createdAt: new Date(),
        isApproved: true,
        ads: []
      };

      // Объединяем с существующими данными
      const existingUser = users.get(telegramUserId);
      if (existingUser) {
        user.ads = existingUser.ads || [];
        user.isApproved = existingUser.isApproved !== undefined ? existingUser.isApproved : true;
      }

      // Сохраняем пользователя
      users.set(userId, user);
      users.set(telegramUserId, user); // Сохраняем также по telegram ID для быстрого доступа
      
      console.log(`✅ User registered: ${user.name} (ID: ${userId})`);

      // Отправляем приветственное сообщение в Telegram
      if (botInitialized && user.telegramId) {
        try {
          const welcomeMessage = `👋 *Добро пожаловать в Flower Market, ${user.name}!*\n\n` +
            `✅ Ваш аккаунт успешно зарегистрирован.\n` +
            `📧 Email: ${user.email}\n` +
            `✅ Статус: Автоматически одобрен\n\n` +
            `Теперь вы можете создавать объявления о продаже цветов!`;

          await sendTelegramMessage(user.telegramId, welcomeMessage, { parse_mode: 'Markdown' });
          console.log(`📤 Welcome message sent to user ${user.telegramId}`);
        } catch (botError) {
          console.error('Welcome message failed:', botError.message);
        }
      }

      // Отправляем уведомление админу
      if (botInitialized && adminChatId) {
        try {
          const adminMessage = `📋 *Новый пользователь зарегистрировался*\n\n` +
            `👤 Имя: ${user.name}\n` +
            `📧 Email: ${user.email}\n` +
            `🆔 User ID: ${user.id}\n` +
            (user.telegramId ? `📱 Telegram ID: ${user.telegramId}\n` : '') +
            `✅ Статус: Автоматически одобрен\n` +
            `⏰ Время: ${new Date().toLocaleString('ru-RU')}`;

          await sendTelegramMessage(adminChatId, adminMessage, { parse_mode: 'Markdown' });
        } catch (botError) {
          console.error('Admin notification failed:', botError.message);
        }
      }

      res.json({
        success: true,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          picture: user.picture,
          isApproved: user.isApproved,
          telegramId: user.telegramId
        }
      });

    } catch (googleError) {
      console.error('❌ Google token verification failed:', googleError.message);
      res.status(401).json({ 
        success: false, 
        error: 'Invalid Google token',
        details: googleError.message 
      });
    }

  } catch (error) {
    console.error('❌ Google auth error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Authentication failed',
      details: error.message 
    });
  }
});

app.post('/api/publish-ad', async (req, res) => {
  try {
    const { userId, title, description, price, contactInfo } = req.body;
    
    console.log(`📝 New ad submission from ${userId}:`, { title, price });
    
    const user = users.get(userId);
    if (!user || !user.isLoggedIn) {
      return res.status(401).json({ 
        success: false, 
        error: 'User not authenticated' 
      });
    }

    const telegramMessage = `🌸 *${title}* 🌸\n\n` +
                   `📝 *Описание:*\n${description}\n\n` +
                   `💰 *Цена:* ${price}\n` +
                   `📞 *Контакты:* ${contactInfo}\n\n` +
                   `👤 *Продавец:* ${user.name}\n` +
                   `🕒 *Дата:* ${new Date().toLocaleString('ru-RU')}\n\n` +
                   `#цветы #${user.name.replace(/\s+/g, '_')}`;

    let telegramMessageId = null;
    let telegramError = null;
    
    if (botInitialized && channelId) {
      try {
        console.log(`📤 Sending ad to channel ${channelId}`);
        const sentMessage = await sendTelegramMessage(channelId, telegramMessage, {
          parse_mode: 'Markdown'
        });
        
        if (sentMessage) {
          telegramMessageId = sentMessage.message_id;
          console.log(`✅ Ad published, message ID: ${telegramMessageId}`);
        } else {
          telegramError = 'Failed to send message to channel';
        }
      } catch (error) {
        telegramError = error.message;
        console.error('Telegram send error:', error.message);
      }
    } else {
      telegramError = 'Bot or channel not configured';
      console.warn('Bot or channel not configured');
    }

    const ad = {
      id: Date.now(),
      userId,
      title,
      description,
      price,
      contactInfo,
      telegramMessageId,
      publishedAt: new Date(),
      status: telegramMessageId ? 'published' : 'failed',
      error: telegramError
    };

    user.ads = user.ads || [];
    user.ads.push(ad);
    users.set(userId, user);

    if (botInitialized && user.telegramId) {
      try {
        let userMessage;
        
        if (telegramMessageId) {
          userMessage = `✅ *Ваше объявление опубликовано!*\n\n` +
            `*Заголовок:* ${title}\n` +
            `*Цена:* ${price}\n\n` +
            `📢 *Ссылка на объявление:*\n` +
            `https://t.me/c/${channelId.toString().replace('-100', '')}/${telegramMessageId}`;
        } else {
          userMessage = `⚠️ *Объявление не опубликовано*\n\n` +
            `*Заголовок:* ${title}\n` +
            `*Цена:* ${price}\n\n` +
            `*Причина:* ${telegramError || 'Ошибка при отправке'}\n` +
            `*Не волнуйтесь, данные сохранены и будут опубликованы позже!*`;
        }

        await sendTelegramMessage(user.telegramId, userMessage, { parse_mode: 'Markdown' });
      } catch (error) {
        console.error('Could not notify user:', error.message);
      }
    }

    res.json({
      success: true,
      message: telegramMessageId ? 'Объявление успешно опубликовано в Telegram!' : 'Объявление сохранено, но не отправлено в Telegram',
      adId: ad.id,
      telegramMessageId,
      error: telegramError,
      preview: {
        title: title,
        price: price,
        seller: user.name
      }
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
        isApproved: user.isApproved || false,
        telegramId: user.telegramId,
        adsCount: (user.ads || []).length,
        registeredAt: user.createdAt,
        lastAd: user.ads && user.ads.length > 0 ? user.ads[user.ads.length - 1] : null
      }
    });
  } else {
    res.status(404).json({ success: false, error: 'User not found' });
  }
});

app.get('/api/user/:userId/approval-status', (req, res) => {
  const userId = req.params.userId;
  const user = users.get(userId);
  
  res.json({
    isApproved: user ? (user.isApproved || false) : false
  });
});

app.use((req, res) => {
  res.status(404).json({
    error: 'Route not found',
    requestedUrl: req.originalUrl
  });
});

app.use((err, req, res, next) => {
  console.error('Server error:', err.stack);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌺 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📺 Channel ID: ${channelId || 'Not set'}`);
  console.log(`👑 Admin Chat ID: ${adminChatId || 'Not set'}`);
  console.log(`🌍 CORS enabled for: https://flowers-telegram-kyrgyzstan.up.railway.app`);
  console.log(`\n=== IMPORTANT ===`);
  console.log(`1. Telegram bot polling is enabled`);
  console.log(`2. Write /start to your bot in Telegram`);
  console.log(`3. API URL: http://localhost:${PORT}`);
  console.log(`4. Frontend URL: ${process.env.FRONTEND_URL}`);
  console.log(`\n=== BOT STATUS ===`);
  console.log(`Bot initialized: ${botInitialized ? '✅ Yes' : '❌ No'}`);
  console.log(`Google OAuth: ${googleClient ? '✅ Initialized' : '❌ Not initialized'}`);
});

process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down gracefully...');
  
  if (bot) {
    bot.stopPolling();
    console.log('✅ Bot polling stopped');
  }
  
  process.exit(0);
});