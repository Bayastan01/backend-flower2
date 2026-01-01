const express = require('express');
const cors = require('cors');
const { OAuth2Client } = require('google-auth-library');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors({
  origin: ['https://flowers-telegram-kyrgyzstan.up.railway.app', 'https://backend-flower-kyrgyz.up.railway.app'],
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Проверяем переменные окружения
console.log('ENV Check:');
console.log('- BOT_TOKEN:', process.env.BOT_TOKEN ? '✓ Set' : '✗ Missing');
console.log('- GOOGLE_CLIENT_ID:', process.env.GOOGLE_CLIENT_ID ? '✓ Set' : '✗ Missing');
console.log('- CHANNEL_ID:', process.env.CHANNEL_ID ? '✓ Set' : '✗ Missing');
console.log('- ADMIN_CHAT_ID:', process.env.ADMIN_CHAT_ID ? '✓ Set' : '✗ Missing');

// Инициализация Telegram бота с polling
let bot;
if (process.env.BOT_TOKEN) {
  try {
    // Используем polling с настройками для Railway
    bot = new TelegramBot(process.env.BOT_TOKEN, {
      polling: {
        interval: 3000, // Интервал опроса
        timeout: 10,    // Таймаут
        autoStart: true, // Автозапуск
        params: {
          timeout: 10   // Таймаут запроса
        }
      }
    });
    
    console.log('✅ Telegram Bot initialized with polling');
  } catch (error) {
    console.error('❌ Failed to initialize Telegram bot:', error.message);
  }
} else {
  console.warn('⚠️ BOT_TOKEN not found in environment variables');
}

const channelId = process.env.CHANNEL_ID;
const adminChatId = process.env.ADMIN_CHAT_ID;

// Инициализация Google OAuth
let googleClient;
if (process.env.GOOGLE_CLIENT_ID) {
  googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  console.log('✅ Google OAuth initialized');
}

// Хранение пользователей
const users = new Map();

// Настройка бота (если он инициализирован)
if (bot) {
  // Обработчик команды /start
  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const firstName = msg.from.first_name || 'Пользователь';
    
    console.log(`👤 User /start: ${firstName} (${chatId})`);
    
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
      `Нажмите кнопку ниже, чтобы создать объявление о продаже цветов.`, 
      options
    ).catch(err => console.error('Error sending start message:', err.message));
  });

  // Обработчик текстовых сообщений
  bot.on('message', (msg) => {
    if (msg.text && !msg.text.startsWith('/')) {
      console.log(`📨 Message from ${msg.from.id}: ${msg.text}`);
    }
  });

  // Обработчик ошибок polling
  bot.on('polling_error', (error) => {
    console.error('Polling error:', error.code, error.message);
  });

  console.log('🤖 Bot commands configured');
}

// ==================== ROUTES ====================

// Корневой маршрут
app.get('/', (req, res) => {
  res.json({
    status: 'Flower Market Backend API',
    message: 'API is running',
    timestamp: new Date().toISOString(),
    botStatus: bot ? 'active' : 'inactive',
    endpoints: {
      root: 'GET /',
      health: 'GET /health',
      userStatus: 'GET /api/user/:userId/status',
      googleAuth: 'POST /api/auth/google',
      publishAd: 'POST /api/publish-ad',
      getUser: 'GET /api/user/:userId',
      approvalStatus: 'GET /api/user/:userId/approval-status'
    }
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    usersCount: users.size,
    botInitialized: !!bot,
    googleOAuthInitialized: !!googleClient,
    botUsername: process.env.BOT_USERNAME || 'Not set',
    channelId: channelId || 'Not set'
  });
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
          googleId: user.googleId,
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

// Авторизация через Google
app.post('/api/auth/google', async (req, res) => {
  try {
    const { token, telegramUserId } = req.body;
    
    if (!token) {
      return res.status(400).json({ error: 'No token provided' });
    }

    if (!googleClient) {
      return res.status(500).json({ 
        success: false, 
        error: 'Google OAuth not configured' 
      });
    }

    // Верификация токена Google
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    
    // Создаем пользователя
    const user = {
      id: telegramUserId || `user_${Date.now()}`,
      telegramId: telegramUserId,
      googleId: payload.sub,
      name: payload.name,
      email: payload.email,
      picture: payload.picture,
      isLoggedIn: true,
      createdAt: new Date(),
      contacts: [],
      isApproved: false // По умолчанию не одобрен
    };

    // Сохраняем пользователя
    users.set(user.id, user);
    
    console.log(`✅ New user registered: ${user.name} (${user.id})`);

    // Отправляем уведомление админу (если бот работает и админ указан)
    if (bot && adminChatId) {
      try {
        const message = `📋 *Новый пользователь зарегистрировался*\n\n` +
                       `👤 Имя: ${user.name}\n` +
                       `📧 Email: ${user.email}\n` +
                       `🆔 Telegram ID: ${user.telegramId || 'Не указан'}\n` +
                       `🆔 Google ID: ${user.googleId}\n` +
                       `⏰ Время: ${new Date().toLocaleString('ru-RU')}`;

        await bot.sendMessage(adminChatId, message, { parse_mode: 'Markdown' });
        console.log(`📤 Admin notification sent to ${adminChatId}`);
      } catch (botError) {
        console.error('Bot notification failed:', botError.message);
      }
    }

    // Если это Telegram ID, автоматически одобряем (для теста)
    if (telegramUserId && telegramUserId.toString().length > 5) {
      user.isApproved = true;
      users.set(user.id, user);
      console.log(`✅ User ${user.name} auto-approved (has Telegram ID)`);
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        picture: user.picture,
        isApproved: user.isApproved
      }
    });

  } catch (error) {
    console.error('Google auth error:', error);
    res.status(401).json({ 
      success: false, 
      error: 'Authentication failed',
      details: error.message 
    });
  }
});

// Публикация объявления
app.post('/api/publish-ad', async (req, res) => {
  try {
    const { userId, title, description, price, contactInfo } = req.body;
    
    console.log(`📝 New ad submission from ${userId}:`, { title, price });
    
    // Проверяем существование пользователя
    const user = users.get(userId);
    if (!user || !user.isLoggedIn) {
      return res.status(401).json({ 
        success: false, 
        error: 'User not authenticated' 
      });
    }

    // Проверяем, одобрен ли пользователь для публикации
    if (!user.isApproved) {
      return res.status(403).json({
        success: false,
        error: 'User not approved for posting. Please wait for admin approval.'
      });
    }

    // Формируем сообщение для Telegram
    const message = `🌸 *${title}* 🌸\n\n` +
                   `📝 *Описание:* ${description}\n\n` +
                   `💰 *Цена:* ${price}\n` +
                   `📞 *Контакты:* ${contactInfo}\n\n` +
                   `👤 *Продавец:* ${user.name}\n` +
                   `🕒 *Дата:* ${new Date().toLocaleString('ru-RU')}\n\n` +
                   `#цветы #${user.name.replace(/\s+/g, '_')}`;

    let telegramMessageId = null;
    let telegramError = null;
    
    // Отправляем в канал (если бот работает и канал указан)
    if (bot && channelId) {
      try {
        console.log(`📤 Sending ad to channel ${channelId}`);
        const sentMessage = await bot.sendMessage(channelId, message, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              {
                text: '💬 Написать продавцу',
                url: `https://t.me/${user.telegramId || userId}`
              }
            ]]
          }
        });
        telegramMessageId = sentMessage.message_id;
        console.log(`✅ Ad published, message ID: ${telegramMessageId}`);
      } catch (error) {
        telegramError = error.message;
        console.error('Telegram send error:', error.message);
      }
    } else {
      telegramError = 'Bot or channel not configured';
      console.warn('Bot or channel not configured');
    }

    // Сохраняем информацию об объявлении
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

    // Отправляем уведомление пользователю
    if (bot && user.telegramId) {
      try {
        await bot.sendMessage(user.telegramId, 
          `✅ *Ваше объявление опубликовано!*\n\n` +
          `*Заголовок:* ${title}\n` +
          `*Цена:* ${price}\n\n` +
          (telegramMessageId ? 
            `Посмотреть объявление: https://t.me/c/${channelId.toString().slice(4)}/${telegramMessageId}` : 
            '')
        , { parse_mode: 'Markdown' });
      } catch (error) {
        console.error('Could not notify user:', error.message);
      }
    }

    res.json({
      success: true,
      message: telegramMessageId ? 'Объявление успешно опубликовано' : 'Объявление сохранено, но не отправлено в Telegram',
      adId: ad.id,
      telegramMessageId,
      error: telegramError
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

// Одобрить пользователя (админский endpoint)
app.post('/api/admin/approve-user/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const user = users.get(userId);
    
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    user.isApproved = true;
    users.set(userId, user);

    console.log(`✅ User approved: ${user.name} (${userId})`);

    // Отправляем уведомление пользователю
    if (bot && user.telegramId) {
      try {
        await bot.sendMessage(user.telegramId, 
          `🎉 *Ваша заявка одобрена!*\n\n` +
          `Теперь вы можете создавать объявления в Flower Market.\n` +
          `Перейдите в бота и нажмите /start чтобы начать.`
        , { parse_mode: 'Markdown' });
      } catch (error) {
        console.error('Could not notify user:', error.message);
      }
    }

    res.json({
      success: true,
      message: `Пользователь ${user.name} одобрен для публикации`
    });

  } catch (error) {
    console.error('Error approving user:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Получение информации о пользователе
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
        ads: user.ads || []
      }
    });
  } else {
    res.status(404).json({ success: false, error: 'User not found' });
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

// Тестовый endpoint для отправки сообщения
app.post('/api/test-message/:chatId', async (req, res) => {
  if (!bot) {
    return res.status(500).json({ error: 'Bot not initialized' });
  }
  
  try {
    const chatId = req.params.chatId;
    await bot.sendMessage(chatId, 'Test message from Flower Market Bot');
    res.json({ success: true, message: 'Test message sent' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Route not found',
    requestedUrl: req.originalUrl
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err.stack);
  res.status(500).json({ 
    error: 'Internal server error'
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌺 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🤖 Bot initialized: ${!!bot}`);
  console.log(`📺 Channel ID: ${channelId || 'Not set'}`);
  console.log(`👑 Admin Chat ID: ${adminChatId || 'Not set'}`);
  console.log(`🌍 CORS enabled for: https://flowers-telegram-kyrgyzstan.up.railway.app`);
});