const express = require('express');
const cors = require('cors');
const { OAuth2Client } = require('google-auth-library');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors({
  origin: [
    'https://flowers-telegram-kyrgyzstan.up.railway.app',
    'https://backend-flower2-production.up.railway.app',
    'http://localhost:3000'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.options('*', cors()); // Обработка preflight запросов
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Проверяем переменные окружения
console.log('=== ENVIRONMENT CHECK ===');
console.log('- BOT_TOKEN:', process.env.BOT_TOKEN ? '✓ Set' : '✗ Missing');
console.log('- GOOGLE_CLIENT_ID:', process.env.GOOGLE_CLIENT_ID ? '✓ Set' : '✗ Missing');
console.log('- CHANNEL_ID:', process.env.CHANNEL_ID ? '✓ Set' : '✗ Missing');
console.log('- ADMIN_CHAT_ID:', process.env.ADMIN_CHAT_ID ? '✓ Set' : '✗ Missing');
console.log('- FRONTEND_URL:', process.env.FRONTEND_URL || 'Not set');
console.log('- NODE_ENV:', process.env.NODE_ENV || 'development');

// Инициализация Google OAuth
let googleClient;
if (process.env.GOOGLE_CLIENT_ID) {
  googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  console.log('✅ Google OAuth initialized');
} else {
  console.warn('⚠️ GOOGLE_CLIENT_ID not found, Google auth disabled');
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
        `*Ваш ID:* ${userId}\n` +
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

    // Обработчик callback_query (кнопки)
    bot.on('callback_query', (callbackQuery) => {
      const msg = callbackQuery.message;
      const data = callbackQuery.data;
      
      if (data === 'check_approval') {
        const userId = callbackQuery.from.id.toString();
        const user = users.get(userId);
        
        if (user && user.isApproved) {
          bot.sendMessage(msg.chat.id, 
            `✅ Ваш аккаунт одобрен!\n\n` +
            `Теперь вы можете создавать объявления через веб-приложение.`,
            {
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
        } else {
          bot.sendMessage(msg.chat.id, 
            `⏳ Ваш аккаунт еще не одобрен.\n\n` +
            `Администратор получил уведомление и скоро одобрит ваш доступ.\n` +
            `Проверьте позже.`
          );
        }
      }
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

// Health check
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

// Тест отправки сообщения
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

// Проверка статуса пользователя
app.get('/api/user/:userId/status', async (req, res) => {
  try {
    const userId = req.params.userId;
    console.log(`🔍 Checking user status for: ${userId}`);
    
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
    
    // Если пользователь есть в системе по Telegram ID, но не залогинен через Google
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
    
    // Если пользователя нет вообще
    res.json({ 
      isLoggedIn: false,
      message: 'User not found'
    });
  } catch (error) {
    console.error('Error checking user status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Авторизация через Google
app.post('/api/auth/google', async (req, res) => {
  try {
    const { token, telegramUserId } = req.body;
    
    console.log('🔐 Google auth request:', { 
      telegramUserId, 
      hasToken: !!token,
      tokenLength: token ? token.length : 0
    });
    
    if (!token) {
      return res.status(400).json({ 
        success: false, 
        error: 'No token provided' 
      });
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
    }).catch(error => {
      console.error('❌ Google token verification failed:', error.message);
      throw new Error(`Invalid Google token: ${error.message}`);
    });

    const payload = ticket.getPayload();
    console.log('✅ Google user verified:', payload.email);
    
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
      isApproved: true, // Автоматически одобряем
      ads: []
    };

    // Объединяем с существующими данными если пользователь уже был
    const existingUser = users.get(telegramUserId);
    if (existingUser) {
      // Сохраняем Telegram данные
      user.name = user.name || existingUser.name;
      user.telegramId = user.telegramId || existingUser.telegramId;
      user.ads = existingUser.ads || [];
      user.isApproved = existingUser.isApproved || user.isApproved;
    }

    // Сохраняем пользователя
    users.set(user.id, user);
    
    console.log(`✅ New user registered: ${user.name} (ID: ${user.id}, Telegram: ${user.telegramId})`);

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
                web_app: { url: process.env.FRONTEND_URL || 'https://flowers-telegram-kyrgyzstan.up.railway.app' }
              },
              {
                text: '🔄 Проверить статус',
                callback_data: 'check_approval'
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
        console.log(`📤 Admin notification sent to ${adminChatId}`);
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
        telegramId: user.telegramId,
        isLoggedIn: true
      }
    });

  } catch (error) {
    console.error('❌ Google auth error:', error);
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

    // Проверяем одобрение пользователя
    if (!user.isApproved) {
      return res.status(403).json({
        success: false,
        error: 'User not approved yet',
        message: 'Please wait for administrator approval'
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

    // Отправляем уведомление пользователю
    if (botInitialized && user.telegramId) {
      try {
        let userMessage;
        
        if (telegramMessageId) {
          userMessage = `✅ *Ваше объявление опубликовано!*\n\n` +
            `*Заголовок:* ${title}\n` +
            `*Цена:* ${price}\n\n` +
            `📢 *Ссылка на объявление:*\n` +
            `https://t.me/c/${channelId.toString().slice(4)}/${telegramMessageId}\n\n` +
            `*Спасибо за использование Flower Market!* 🌸`;
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
    console.error('❌ Error publishing ad:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to publish ad',
      details: error.message 
    });
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
        adsCount: (user.ads || []).length,
        registeredAt: user.createdAt,
        lastAd: user.ads && user.ads.length > 0 ? user.ads[user.ads.length - 1] : null
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
  
  if (!user) {
    return res.status(404).json({ 
      isApproved: false,
      error: 'User not found' 
    });
  }
  
  res.json({
    isApproved: user.isApproved || false,
    userId: user.id,
    userName: user.name
  });
});

// Обновление статуса одобрения (для админа)
app.post('/api/user/:userId/approve', (req, res) => {
  const userId = req.params.userId;
  const { approved } = req.body;
  const user = users.get(userId);
  
  if (!user) {
    return res.status(404).json({ success: false, error: 'User not found' });
  }
  
  user.isApproved = approved === true;
  users.set(userId, user);
  
  // Отправляем уведомление пользователю
  if (botInitialized && user.telegramId) {
    const message = approved ? 
      `✅ *Ваш аккаунт одобрен!*\n\nТеперь вы можете создавать объявления о продаже цветов.` :
      `❌ *Доступ ограничен*\n\nВаш аккаунт был заблокирован администратором.`;
    
    sendTelegramMessage(user.telegramId, message, { parse_mode: 'Markdown' });
  }
  
  res.json({
    success: true,
    userId: user.id,
    isApproved: user.isApproved,
    message: `User ${approved ? 'approved' : 'disapproved'} successfully`
  });
});

// Получение списка всех пользователей (для админа)
app.get('/api/users', (req, res) => {
  const userList = Array.from(users.values()).map(user => ({
    id: user.id,
    name: user.name,
    email: user.email,
    telegramId: user.telegramId,
    isApproved: user.isApproved || false,
    isLoggedIn: user.isLoggedIn || false,
    adsCount: (user.ads || []).length,
    registeredAt: user.createdAt
  }));
  
  res.json({
    success: true,
    users: userList,
    count: userList.length
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
  console.log(`🌍 CORS enabled for: https://flowers-telegram-kyrgyzstan.up.railway.app`);
  console.log(`\n=== IMPORTANT ===`);
  console.log(`1. Telegram bot polling is enabled`);
  console.log(`2. Write /start to your bot in Telegram`);
  console.log(`3. API URL: http://localhost:${PORT}`);
  console.log(`4. Frontend URL: ${process.env.FRONTEND_URL}`);
  console.log(`\n=== BOT STATUS ===`);
  console.log(`Bot initialized: ${botInitialized ? '✅ Yes' : '❌ No'}`);
  console.log(`Users in memory: ${users.size}`);
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