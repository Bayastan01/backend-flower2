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
console.log('- FRONTEND_URL:', process.env.FRONTEND_URL || 'Not set');

// Инициализация Telegram бота
let bot;
if (process.env.BOT_TOKEN) {
  try {
    // Используем только webhook или без polling на Railway
    bot = new TelegramBot(process.env.BOT_TOKEN);
    
    // Отключаем polling на Railway
    // bot.startPolling() - НЕ ВЫЗЫВАЕМ!
    
    console.log('✅ Telegram Bot initialized (without polling)');
  } catch (error) {
    console.error('❌ Failed to initialize Telegram bot:', error.message);
  }
} else {
  console.warn('⚠️ BOT_TOKEN not found in environment variables');
}

const channelId = process.env.CHANNEL_ID;
const adminChatId = process.env.ADMIN_CHAT_ID || 'YOUR_ADMIN_ID'; // Замените на ваш ID

// Инициализация Google OAuth
let googleClient;
if (process.env.GOOGLE_CLIENT_ID) {
  googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  console.log('✅ Google OAuth initialized');
}

// Хранение пользователей
const users = new Map();

// ==================== ROUTES ====================

// Корневой маршрут
app.get('/', (req, res) => {
  res.json({
    status: 'Flower Market Backend API',
    message: 'API is running',
    timestamp: new Date().toISOString(),
    endpoints: {
      root: 'GET /',
      health: 'GET /health',
      userStatus: 'GET /api/user/:userId/status',
      googleAuth: 'POST /api/auth/google',
      publishAd: 'POST /api/publish-ad',
      getUser: 'GET /api/user/:userId',
      approvalStatus: 'GET /api/user/:userId/approval-status',
      webhook: 'POST /api/telegram-webhook'
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
    port: process.env.PORT || 3000,
    nodeVersion: process.version
  });
});

// Webhook для Telegram (опционально)
app.post('/api/telegram-webhook', (req, res) => {
  console.log('Telegram webhook received:', req.body);
  res.sendStatus(200);
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
          googleId: user.googleId
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

    // Отправляем уведомление админу (если бот работает)
    if (bot && adminChatId) {
      try {
        const message = `📋 Новый пользователь зарегистрировался:\n\n` +
                       `👤 Имя: ${user.name}\n` +
                       `📧 Email: ${user.email}\n` +
                       `🆔 ID: ${user.id}\n` +
                       `⏰ Время: ${new Date().toLocaleString()}`;

        await bot.sendMessage(adminChatId, message);
      } catch (botError) {
        console.error('Bot notification failed:', botError.message);
      }
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
      error: 'Authentication failed'
    });
  }
});

// Публикация объявления
app.post('/api/publish-ad', async (req, res) => {
  try {
    const { userId, title, description, price, contactInfo } = req.body;
    
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
                   `📝 Описание: ${description}\n\n` +
                   `💰 Цена: ${price}\n` +
                   `📞 Контакты: ${contactInfo}\n\n` +
                   `👤 Продавец: ${user.name}\n` +
                   `🕒 Дата: ${new Date().toLocaleString('ru-RU')}\n\n` +
                   `#цветы #${user.name.replace(/\s+/g, '_')}`;

    let telegramMessageId = null;
    
    // Отправляем в канал (если бот работает)
    if (bot && channelId) {
      try {
        const sentMessage = await bot.sendMessage(channelId, message, {
          parse_mode: 'Markdown'
        });
        telegramMessageId = sentMessage.message_id;
      } catch (telegramError) {
        console.error('Telegram send error:', telegramError.message);
        // Продолжаем даже если Telegram ошибся
      }
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
      status: 'published'
    };

    user.ads = user.ads || [];
    user.ads.push(ad);
    users.set(userId, user);

    res.json({
      success: true,
      message: 'Объявление успешно опубликовано',
      adId: ad.id,
      telegramMessageId
    });

  } catch (error) {
    console.error('Error publishing ad:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to publish ad'
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

    // Отправляем уведомление пользователю
    if (bot) {
      try {
        await bot.sendMessage(userId, 
          `🎉 Ваша заявка одобрена!\n\n` +
          `Теперь вы можете создавать объявления в Flower Market.`
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
  console.log(`🔗 CORS allowed origins: https://flowers-telegram-kyrgyzstan.up.railway.app`);
});