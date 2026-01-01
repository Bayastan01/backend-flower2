const express = require('express');
const cors = require('cors');
const { OAuth2Client } = require('google-auth-library');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const app = express();

// Базовый middleware
app.use(cors({
  origin: '*', // временно для тестирования
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// Проверяем переменные окружения
console.log('Checking environment variables...');
console.log('BOT_TOKEN exists:', !!process.env.BOT_TOKEN);
console.log('PORT:', process.env.PORT);

// Инициализация бота (только если есть токен)
let bot;
if (process.env.BOT_TOKEN) {
  try {
    bot = new TelegramBot(process.env.BOT_TOKEN, { 
      polling: true,
      request: {
        agentOptions: {
          keepAlive: true,
          family: 4
        }
      }
    });
    
    // Простая команда /start
    bot.onText(/\/start/, (msg) => {
      const chatId = msg.chat.id;
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
      
      bot.sendMessage(chatId, 'Добро пожаловать в Flower Market! 🌸\nНажмите кнопку ниже, чтобы создать объявление.', options);
    });
    
    console.log('🤖 Telegram Bot initialized successfully');
    
  } catch (error) {
    console.error('Failed to initialize Telegram bot:', error.message);
  }
}

// Google OAuth клиент
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Простое хранилище в памяти
const users = new Map();

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'online',
    service: 'Flower Market Backend',
    timestamp: new Date().toISOString(),
    endpoints: [
      '/health',
      '/api/auth/google',
      '/api/user/:userId/status',
      '/api/publish-ad'
    ]
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    bot: !!bot,
    users: users.size,
    time: new Date().toISOString()
  });
});

// Проверка статуса пользователя
app.get('/api/user/:userId/status', async (req, res) => {
  try {
    const userId = req.params.userId;
    const user = users.get(userId);
    
    res.json({
      isLoggedIn: !!(user && user.isLoggedIn),
      user: user ? {
        id: user.id,
        name: user.name,
        email: user.email,
        picture: user.picture
      } : null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Авторизация через Google
app.post('/api/auth/google', async (req, res) => {
  try {
    const { token, telegramUserId } = req.body;
    
    if (!token) {
      return res.status(400).json({ error: 'No token provided' });
    }

    // Верификация Google токена
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
      createdAt: new Date()
    };

    // Сохраняем
    users.set(user.id, user);
    
    // Отправляем уведомление админу (если бот работает)
    if (bot && process.env.ADMIN_CHAT_ID) {
      try {
        const message = `📋 Новый пользователь:\n\n` +
                       `👤 Имя: ${user.name}\n` +
                       `📧 Email: ${user.email}\n` +
                       `🆔 ID: ${user.id}`;
        
        await bot.sendMessage(process.env.ADMIN_CHAT_ID, message);
      } catch (botError) {
        console.log('Bot notification failed:', botError.message);
      }
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        picture: user.picture
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
    
    if (!userId || !title || !description || !price || !contactInfo) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields' 
      });
    }

    const user = users.get(userId);
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        error: 'User not found' 
      });
    }

    // Формируем сообщение
    const message = `🌸 *${title}* 🌸\n\n` +
                   `📝 Описание: ${description}\n\n` +
                   `💰 Цена: ${price}\n` +
                   `📞 Контакты: ${contactInfo}\n\n` +
                   `👤 Продавец: ${user.name}\n` +
                   `🕒 Дата: ${new Date().toLocaleString('ru-RU')}`;

    let telegramMessageId = null;
    
    // Отправляем в канал (если бот работает и есть CHANNEL_ID)
    if (bot && process.env.CHANNEL_ID) {
      try {
        const sentMessage = await bot.sendMessage(process.env.CHANNEL_ID, message, {
          parse_mode: 'Markdown'
        });
        telegramMessageId = sentMessage.message_id;
      } catch (telegramError) {
        console.error('Telegram send error:', telegramError.message);
        // Продолжаем даже если Telegram ошибка
      }
    }

    // Сохраняем объявление
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
    console.error('Publish error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to publish ad',
      details: error.message 
    });
  }
});

// Обработка ошибок
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌺 Service: Flower Market Backend`);
  console.log(`🕒 Started at: ${new Date().toISOString()}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  if (bot) {
    bot.stopPolling();
  }
  process.exit(0);
});