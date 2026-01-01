const express = require('express');
const cors = require('cors');
const { OAuth2Client } = require('google-auth-library');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors({
  origin: ['https://flowers-telegram-kyrgyzstan.up.railway.app'],
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ФИКСИРОВАННАЯ ССЫЛКА НА ФРОНТЕНД
const FRONTEND_URL = 'https://flowers-telegram-kyrgyzstan.up.railway.app';

// Проверяем переменные окружения
console.log('=== ENVIRONMENT CHECK ===');
console.log('- BOT_TOKEN:', process.env.BOT_TOKEN ? '✓ Set' : '✗ Missing');
console.log('- GOOGLE_CLIENT_ID:', process.env.GOOGLE_CLIENT_ID ? '✓ Set' : '✗ Missing');
console.log('- CHANNEL_ID:', process.env.CHANNEL_ID ? '✓ Set' : '✗ Missing');
console.log('- ADMIN_CHAT_ID:', process.env.ADMIN_CHAT_ID ? '✓ Set' : '✗ Missing');
console.log('- FRONTEND_URL (from env):', process.env.FRONTEND_URL || 'Not set');
console.log('- FRONTEND_URL (fixed):', FRONTEND_URL);
console.log('- NODE_ENV:', process.env.NODE_ENV || 'development');

// Инициализация Google OAuth
let googleClient;
if (process.env.GOOGLE_CLIENT_ID) {
  googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  console.log('✅ Google OAuth initialized');
}

const channelId = process.env.CHANNEL_ID;
const adminChatId = process.env.ADMIN_CHAT_ID;

// Хранение пользователей
const users = new Map();

// Инициализация Telegram бота с polling
let bot;
let botInitialized = false;

function initializeTelegramBot() {
  if (!process.env.BOT_TOKEN) {
    console.warn('⚠️ BOT_TOKEN not found, Telegram bot disabled');
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
      console.log(`🔗 Using frontend URL: ${FRONTEND_URL}`);
      
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
              web_app: { url: FRONTEND_URL } // ИСПОЛЬЗУЕМ ФИКСИРОВАННУЮ ССЫЛКУ
            }
          ]]
        }
      };
      
      bot.sendMessage(chatId, 
        `Добро пожаловать в Flower Market, ${firstName}! 🌸\n\n` +
        `Нажмите кнопку ниже, чтобы создать объявление о продаже цветов.\n\n` +
        `*Ваш ID:* ${userId}\n` +
        `*Username:* ${username}\n\n` +
        `Сохраните ваш ID, он понадобится для авторизации.\n\n` +
        `🌐 *Ссылка:* ${FRONTEND_URL}`, 
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
        `3. Введите этот ID когда спросят\n\n` +
        `🌐 *Ссылка на сайт:* ${FRONTEND_URL}`,
        { 
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              {
                text: '🌺 Открыть веб-приложение',
                web_app: { url: FRONTEND_URL } // ИСПОЛЬЗУЕМ ФИКСИРОВАННУЮ ССЫЛКУ
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
        `*Веб-сайт:* ${FRONTEND_URL}\n` +
        `*Проблемы?* Напишите админу.`,
        { 
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              {
                text: '🌺 Создать объявление',
                web_app: { url: FRONTEND_URL } // ИСПОЛЬЗУЕМ ФИКСИРОВАННУЮ ССЫЛКУ
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
      
      // Пробуем перезапустить polling при ошибках
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
      
      // Настраиваем команды бота
      bot.setMyCommands([
        { command: 'start', description: 'Запустить бота' },
        { command: 'id', description: 'Показать мой ID' },
        { command: 'help', description: 'Помощь' }
      ]).then(() => {
        console.log('✅ Bot commands configured');
      }).catch(err => {
        console.error('Error setting bot commands:', err.message);
      });
      
      // Проверяем, какая ссылка используется
      console.log(`🔗 Bot will use this web app URL: ${FRONTEND_URL}`);
      
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

// Инициализируем бота
initializeTelegramBot();

// Функция для отправки сообщений через бота
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

// Корневой маршрут
app.get('/', (req, res) => {
  res.json({
    status: 'Flower Market Backend API',
    message: 'API is running',
    timestamp: new Date().toISOString(),
    botStatus: botInitialized ? 'active' : 'inactive',
    frontendUrl: FRONTEND_URL,
    usersCount: users.size,
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
    botInitialized: botInitialized,
    googleOAuthInitialized: !!googleClient,
    frontendUrl: FRONTEND_URL,
    channelId: channelId || 'Not set',
    adminChatId: adminChatId || 'Not set',
    environment: process.env.NODE_ENV || 'development'
  });
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
      isApproved: true,
      ads: []
    };

    // Объединяем с существующими данными если пользователь уже был
    const existingUser = users.get(telegramUserId);
    if (existingUser) {
      user.name = user.name || existingUser.name;
      user.telegramId = user.telegramId || existingUser.telegramId;
      user.ads = existingUser.ads || [];
      user.isApproved = existingUser.isApproved || user.isApproved;
    }

    // Сохраняем пользователя
    users.set(user.id, user);
    
    console.log(`✅ New user registered: ${user.name} (ID: ${user.id})`);

    // Отправляем приветственное сообщение в Telegram
    if (botInitialized && user.telegramId) {
      try {
        const welcomeMessage = `👋 *Добро пожаловать в Flower Market, ${user.name}!*\n\n` +
          `✅ Ваш аккаунт успешно зарегистрирован.\n` +
          `📧 Email: ${user.email}\n` +
          `✅ Статус: Автоматически одобрен\n\n` +
          `Теперь вы можете создавать объявления о продаже цветов!\n\n` +
          `*Как создать объявление:*\n` +
          `1. Нажмите кнопку ниже 👇\n` +
          `2. Заполните форму\n` +
          `3. Ваше объявление будет опубликовано в канале\n\n` +
          `🌺 *Желаем успешных продаж!*`;

        const options = {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              {
                text: '🌺 Создать объявление',
                web_app: { url: FRONTEND_URL } // ИСПОЛЬЗУЕМ ФИКСИРОВАННУЮ ССЫЛКУ
              }
            ]]
          }
        };

        await sendTelegramMessage(user.telegramId, welcomeMessage, options);
        console.log(`📤 Welcome message sent to user ${user.telegramId}`);
      } catch (botError) {
        console.error('Welcome message failed:', botError.message);
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

    // Формируем сообщение для Telegram
    const telegramMessage = `🌸 *${title}* 🌸\n\n` +
                   `📝 *Описание:*\n${description}\n\n` +
                   `💰 *Цена:* ${price}\n` +
                   `📞 *Контакты:* ${contactInfo}\n\n` +
                   `👤 *Продавец:* ${user.name}\n` +
                   `🕒 *Дата:* ${new Date().toLocaleString('ru-RU')}\n\n` +
                   `#цветы #${user.name.replace(/\s+/g, '_')}`;

    let telegramMessageId = null;
    let telegramError = null;
    
    // Отправляем в канал
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
          isApproved: user.isApproved || false,
          telegramId: user.telegramId || null,
          adsCount: (user.ads || []).length
        }
      });
    }
    
    res.json({ isLoggedIn: false });
  } catch (error) {
    console.error('Error checking user status:', error);
    res.status(500).json({ error: 'Internal server error' });
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
  console.log(`🌍 CORS enabled for: ${FRONTEND_URL}`);
  console.log(`\n=== IMPORTANT ===`);
  console.log(`1. Telegram bot polling is enabled`);
  console.log(`2. Write /start to your bot in Telegram`);
  console.log(`3. API URL: http://localhost:${PORT}`);
  console.log(`4. Frontend URL: ${FRONTEND_URL}`);
  console.log(`\n=== BOT STATUS ===`);
  console.log(`Bot initialized: ${botInitialized ? '✅ Yes' : '❌ No'}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down gracefully...');
  
  if (bot) {
    bot.stopPolling();
    console.log('✅ Bot polling stopped');
  }
  
  process.exit(0);
});