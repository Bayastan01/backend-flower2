const express = require('express');
const cors = require('cors');
const { Telegraf } = require('telegraf');
const { OAuth2Client } = require('google-auth-library');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// Google OAuth клиент
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID || '316866498988-v1pqivbgh0eupcb9rs53m26nrqukn9hb.apps.googleusercontent.com');

// Хранилище пользователей (в памяти, для продакшена используйте БД)
const users = new Map();

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'https://flowers-telegram-kyrgyzstan.up.railway.app',
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 100 // ограничение каждого IP до 100 запросов за 15 минут
});
app.use('/api/', limiter);

// Верификация Google токена
async function verifyGoogleToken(token) {
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID || '316866498988-v1pqivbgh0eupcb9rs53m26nrqukn9hb.apps.googleusercontent.com'
    });
    return ticket.getPayload();
  } catch (error) {
    console.error('Ошибка верификации Google токена:', error);
    return null;
  }
}

// Телеграм бот
let bot = null;
if (process.env.BOT_TOKEN) {
  try {
    bot = new Telegraf(process.env.BOT_TOKEN);
    
    bot.start((ctx) => {
      const userId = ctx.from.id.toString();
      const webappUrl = `${process.env.WEBAPP_URL || 'https://flowers-telegram-kyrgyzstan.up.railway.app'}?tg_user_id=${userId}`;
      
      ctx.replyWithHTML(
        `🌸 <b>Добро пожаловать в магазин цветов!</b>\n\n` +
        `Нажмите кнопку ниже, чтобы открыть магазин и создать объявление.`,
        {
          reply_markup: {
            inline_keyboard: [[
              {
                text: '🌸 Открыть магазин цветов',
                web_app: { url: webappUrl }
              }
            ]]
          }
        }
      );
    });
    
    bot.launch().then(() => {
      console.log('🤖 Telegram bot запущен');
    }).catch(err => {
      console.error('Ошибка запуска бота:', err);
    });
  } catch (error) {
    console.error('Ошибка создания бота:', error);
  }
}

// Маршруты API

// Проверка статуса пользователя
app.get('/api/user/:userId/status', async (req, res) => {
  try {
    const { userId } = req.params;
    console.log('Проверка статуса пользователя:', userId);
    
    const user = users.get(userId);
    
    if (user) {
      res.json({
        success: true,
        isLoggedIn: true,
        needsGoogleAuth: false,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          picture: user.picture
        }
      });
    } else {
      res.json({
        success: true,
        isLoggedIn: false,
        needsGoogleAuth: true
      });
    }
  } catch (error) {
    console.error('Ошибка проверки статуса:', error);
    res.status(500).json({
      success: false,
      error: 'Ошибка сервера'
    });
  }
});

// Авторизация через Google
app.post('/api/auth/google', async (req, res) => {
  try {
    const { token, telegramUserId } = req.body;
    
    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Токен обязателен'
      });
    }
    
    // Верифицируем Google токен
    const payload = await verifyGoogleToken(token);
    
    if (!payload) {
      return res.status(401).json({
        success: false,
        error: 'Неверный Google токен'
      });
    }
    
    // Создаем или обновляем пользователя
    const userId = telegramUserId || `google_${payload.sub}`;
    const userData = {
      id: userId,
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
      telegramUserId: telegramUserId,
      googleId: payload.sub,
      authDate: new Date()
    };
    
    users.set(userId, userData);
    
    console.log('Пользователь авторизован:', payload.email);
    
    res.json({
      success: true,
      user: userData
    });
    
  } catch (error) {
    console.error('Ошибка Google авторизации:', error);
    res.status(500).json({
      success: false,
      error: 'Ошибка сервера'
    });
  }
});

// Публикация объявления
app.post('/api/publish-ad', async (req, res) => {
  try {
    const { 
      userId, 
      title, 
      description, 
      price, 
      contactInfo,
      images = []
    } = req.body;
    
    console.log('Публикация объявления от пользователя:', userId);
    
    // Проверяем авторизацию
    const user = users.get(userId);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Пользователь не авторизован'
      });
    }
    
    // Формируем текст сообщения для Telegram
    const message = `🌸 <b>НОВОЕ ОБЪЯВЛЕНИЕ</b> 🌸\n\n` +
      `<b>${title}</b>\n\n` +
      `📝 <b>Описание:</b>\n${description}\n\n` +
      `💰 <b>Цена:</b> ${price}\n\n` +
      `📞 <b>Контакты:</b> ${contactInfo}\n\n` +
      `👤 <b>Продавец:</b> ${user.name || 'Пользователь'}\n` +
      `🕐 ${new Date().toLocaleString('ru-RU')}\n\n` +
      `#цветы #продажа_цветов`;
    
    // Отправляем в канал, если есть бот
    let messageSent = false;
    if (bot && process.env.CHANNEL_ID) {
      try {
        await bot.telegram.sendMessage(process.env.CHANNEL_ID, message, {
          parse_mode: 'HTML'
        });
        messageSent = true;
        console.log('Сообщение отправлено в канал');
      } catch (error) {
        console.error('Ошибка отправки в канал:', error);
      }
    }
    
    res.json({
      success: true,
      message: messageSent ? 
        'Объявление успешно опубликовано в Telegram канале!' : 
        'Объявление создано (бот не настроен для отправки в канал)',
      postPreview: message,
      imagesCount: images.length
    });
    
  } catch (error) {
    console.error('Ошибка публикации:', error);
    res.status(500).json({
      success: false,
      error: 'Ошибка публикации объявления'
    });
  }
});

// Проверка работоспособности
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'flower-market-backend',
    timestamp: new Date().toISOString(),
    usersCount: users.size
  });
});

app.get('/', (req, res) => {
  res.json({
    message: 'Flower Market Backend API',
    endpoints: {
      health: '/health',
      userStatus: 'GET /api/user/:userId/status',
      googleAuth: 'POST /api/auth/google',
      publishAd: 'POST /api/publish-ad'
    },
    telegramBot: bot ? 'active' : 'inactive'
  });
});

// Обработка 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Маршрут не найден'
  });
});

// Обработка ошибок
app.use((err, req, res, next) => {
  console.error('Ошибка сервера:', err);
  res.status(500).json({
    success: false,
    error: 'Внутренняя ошибка сервера'
  });
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log(`🌐 Frontend URL: ${process.env.FRONTEND_URL || 'https://flowers-telegram-kyrgyzstan.up.railway.app'}`);
  console.log(`🤖 Telegram Bot: ${process.env.BOT_USERNAME || 'не настроен'}`);
  console.log(`📢 Telegram Channel: ${process.env.CHANNEL_USERNAME || 'не настроен'}`);
});