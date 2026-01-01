const express = require('express');
const cors = require('cors');
const { OAuth2Client } = require('google-auth-library');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors({
  origin: ['https://flowers-telegram-kyrgyzstan.up.railway.app'],
  credentials: true
}));
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
}

const channelId = process.env.CHANNEL_ID;
const adminChatId = process.env.ADMIN_CHAT_ID;

// Хранение пользователей
const users = new Map();

// Хранение бота (будет установлено из bot-polling.js)
let telegramBot = null;

// Функция для установки бота из polling скрипта
function setTelegramBot(bot) {
  telegramBot = bot;
  console.log('✅ Telegram Bot set in server.js');
}

// Функция для отправки сообщений через бота
async function sendTelegramMessage(chatId, message, options = {}) {
  if (!telegramBot) {
    console.warn('⚠️ Telegram bot not available');
    return null;
  }
  
  try {
    const result = await telegramBot.sendMessage(chatId, message, options);
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
    botAvailable: !!telegramBot,
    usersCount: users.size,
    endpoints: {
      root: 'GET /',
      health: 'GET /health',
      userStatus: 'GET /api/user/:userId/status',
      googleAuth: 'POST /api/auth/google',
      publishAd: 'POST /api/publish-ad',
      getUser: 'GET /api/user/:userId',
      approvalStatus: 'GET /api/user/:userId/approval-status',
      sendTestMessage: 'POST /api/send-message/:chatId',
      setupStartMessage: 'GET /api/setup-start/:chatId'
    }
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    usersCount: users.size,
    botAvailable: !!telegramBot,
    googleOAuthInitialized: !!googleClient,
    channelId: channelId || 'Not set',
    adminChatId: adminChatId || 'Not set'
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

// Настройка стартового сообщения для пользователя
app.get('/api/setup-start/:chatId', async (req, res) => {
  try {
    const chatId = req.params.chatId;
    
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
    
    const result = await sendTelegramMessage(chatId, 
      `Добро пожаловать в Flower Market! 🌸\n\n` +
      `Нажмите кнопку ниже, чтобы создать объявление о продаже цветов.`, 
      options
    );
    
    if (result) {
      res.json({ 
        success: true, 
        message: 'Start message sent successfully',
        messageId: result.message_id 
      });
    } else {
      res.status(500).json({ 
        success: false, 
        error: 'Failed to send start message' 
      });
    }
    
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
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
      isApproved: true, // Автоматически одобряем
      ads: []
    };

    // Сохраняем пользователя
    users.set(user.id, user);
    
    console.log(`✅ New user registered: ${user.name} (${user.id})`);

    // Отправляем приветственное сообщение в Telegram
    if (telegramBot && user.telegramId) {
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
    if (telegramBot && adminChatId) {
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
    if (telegramBot && channelId) {
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
    if (telegramBot && user.telegramId) {
      try {
        let userMessage;
        
        if (telegramMessageId) {
          userMessage = `✅ *Ваше объявление опубликовано!*\n\n` +
            `*Заголовок:* ${title}\n` +
            `*Цена:* ${price}\n\n` +
            `📢 *Ссылка на объявление:*\n` +
            `https://t.me/c/${channelId.toString().slice(4)}/${telegramMessageId}`;
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
    if (telegramBot && user.telegramId) {
      try {
        await sendTelegramMessage(user.telegramId, 
          `🎉 *Ваша заявка одобрена!*\n\n` +
          `Теперь вы можете создавать объявления в Flower Market.\n` +
          `Вернитесь в веб-приложение чтобы продолжить.`,
          { parse_mode: 'Markdown' }
        );
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
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌺 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🤖 Bot will be connected from bot-polling.js`);
  console.log(`📺 Channel ID: ${channelId || 'Not set'}`);
  console.log(`👑 Admin Chat ID: ${adminChatId || 'Not set'}`);
  console.log(`🌍 CORS enabled for: https://flowers-telegram-kyrgyzstan.up.railway.app`);
  console.log(`\n=== IMPORTANT ===`);
  console.log(`Make sure bot-polling.js is running for Telegram bot functionality`);
  console.log(`API URL: http://localhost:${PORT}`);
  console.log(`Frontend URL: ${process.env.FRONTEND_URL}`);
});

// Экспортируем функции для использования в bot-polling.js
module.exports = {
  app,
  server,
  setTelegramBot,
  sendTelegramMessage,
  users,
  channelId,
  adminChatId
};

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});