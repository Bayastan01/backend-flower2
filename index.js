const express = require('express');
const cors = require('cors');
const { Telegraf } = require('telegraf');

const app = express();
const PORT = process.env.PORT || 3000;

// Простая конфигурация
const config = {
  botToken: process.env.BOT_TOKEN || '8316210179:AAG7Tfvf1ou8_8g1rQjD8UQt6sKXKXG0hPQ',
  channelId: process.env.CHANNEL_ID || '-1003293921379',
  botUsername: process.env.BOT_USERNAME || '@Flowers_free_bot',
  channelUsername: process.env.CHANNEL_USERNAME || '@flowers_market_kg',
  webappUrl: process.env.WEBAPP_URL || 'https://flowers-telegram-kyrgyzstan.up.railway.app/',
  googleClientId: process.env.GOOGLE_CLIENT_ID || '316866498988-v1pqivbgh0eupcb9rs53m26nrqukn9hb.apps.googleusercontent.com'
};

// Middleware
app.use(cors());
app.use(express.json());

// Простое логирование
console.log('🔧 Конфигурация:');
console.log(`   Bot: ${config.botUsername}`);
console.log(`   Channel: ${config.channelUsername}`);

// Маршруты
app.get('/', (req, res) => {
  res.json({ 
    message: 'Flower Bot API is running',
    status: 'active',
    bot: config.botUsername,
    channel: config.channelUsername,
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK',
    service: 'flower-bot-api',
    timestamp: new Date().toISOString() 
  });
});

// Маршрут для проверки статуса пользователя
app.get('/api/user/:userId/status', (req, res) => {
  const { userId } = req.params;
  console.log('Check user status:', userId);
  
  // Временное хранилище (в проде используйте базу данных)
  const users = {};
  
  if (users[userId]) {
    res.json({
      success: true,
      isLoggedIn: true,
      needsGoogleAuth: false,
      user: users[userId]
    });
  } else {
    res.json({
      success: true,
      isLoggedIn: false,
      needsGoogleAuth: true
    });
  }
});

// Маршрут для Google авторизации
app.post('/api/auth/google', (req, res) => {
  try {
    const { token, telegramUserId } = req.body;
    
    console.log('Google auth for user:', telegramUserId);
    
    // В реальном приложении здесь должна быть верификация Google токена
    // Для демо просто создаем пользователя
    
    const userData = {
      id: telegramUserId || `user_${Date.now()}`,
      email: 'user@example.com',
      name: 'Тестовый пользователь',
      picture: null,
      telegramUserId: telegramUserId,
      authDate: new Date()
    };
    
    res.json({
      success: true,
      user: userData
    });
    
  } catch (error) {
    console.error('Google auth error:', error);
    res.status(500).json({
      success: false,
      error: 'Ошибка сервера'
    });
  }
});

// Маршрут для публикации объявления
app.post('/api/publish-ad', (req, res) => {
  try {
    const { 
      userId, 
      title, 
      description, 
      price, 
      contactInfo,
      images
    } = req.body;
    
    console.log('Publish ad for user:', userId);
    console.log('Title:', title);
    console.log('Description length:', description?.length);
    console.log('Images count:', images?.length || 0);
    
    // Формируем текст поста
    const postText = `🌸 <b>НОВОЕ ОБЪЯВЛЕНИЕ</b> 🌸\n\n` +
      `<b>${title || 'Продажа цветов'}</b>\n\n` +
      `📝 <b>Описание:</b>\n${description || 'Нет описания'}\n\n` +
      `💰 <b>Цена:</b> ${price || 'Договорная'}\n\n` +
      `📞 <b>Контакты:</b> ${contactInfo || 'В комментариях'}\n\n` +
      `🕐 ${new Date().toLocaleString('ru-RU')}\n` +
      `#цветы #продажа`;
    
    console.log('📢 Пост для канала:', postText);
    
    res.json({
      success: true,
      message: 'Объявление опубликовано',
      postPreview: postText,
      imagesCount: images?.length || 0
    });
    
  } catch (error) {
    console.error('Publish ad error:', error);
    res.status(500).json({
      success: false,
      error: 'Ошибка публикации объявления'
    });
  }
});

// Обработка 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
    path: req.path
  });
});

// Обработка ошибок
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// Создаем и запускаем Telegram бота
let bot = null;
if (config.botToken) {
  try {
    bot = new Telegraf(config.botToken);
    
    // Простой команда /start
    bot.start(async (ctx) => {
      const userId = ctx.from.id.toString();
      const username = ctx.from.username || '';
      const firstName = ctx.from.first_name || '';
      
      const webappUrl = `${config.webappUrl}?tg_user_id=${userId}&tg_username=${encodeURIComponent(username)}&tg_first_name=${encodeURIComponent(firstName)}`;
      
      await ctx.replyWithHTML(
        `🌸 <b>Добро пожаловать в магазин цветов!</b>\n\n` +
        `Нажмите кнопку ниже, чтобы открыть магазин и создать объявление.\n\n` +
        `📢 Наш канал: ${config.channelUsername}`,
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
    
    // Запускаем бота
    bot.launch().then(() => {
      console.log(`🤖 Bot ${config.botUsername} started successfully`);
    }).catch(err => {
      console.error('Failed to start bot:', err);
    });
    
  } catch (error) {
    console.error('Error creating bot:', error);
  }
} else {
  console.warn('⚠️ BOT_TOKEN не найден. Telegram бот не запущен.');
}

// Запуск сервера
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 WebApp URL: ${config.webappUrl}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  
  if (config.botUsername) {
    console.log(`📱 Telegram Bot: https://t.me/${config.botUsername.replace('@', '')}`);
  }
});

// Обработка ошибок сервера
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use`);
  } else {
    console.error('Server error:', error);
  }
  process.exit(1);
});

// Обработка завершения
process.once('SIGINT', () => {
  if (bot) {
    bot.stop('SIGINT');
  }
  server.close();
});

process.once('SIGTERM', () => {
  if (bot) {
    bot.stop('SIGTERM');
  }
  server.close();
});