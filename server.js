const express = require('express');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');
const crypto = require('crypto');

const app = express();

// Middleware
app.use(cors({
  origin: '*',
  credentials: true
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Конфигурация (можно через переменные окружения или прямо в коде)
const config = {
  BOT_TOKEN: process.env.BOT_TOKEN || '8316210179:AAG7Tfvf1ou8_8g1rQjD8UQt6sKXKXG0hPQ',
  CHANNEL_ID: process.env.CHANNEL_ID || '@flowers_market_kg',
  FRONTEND_URL: process.env.FRONTEND_URL || 'https://flowers-telegram-kyrgyzstan.up.railway.app',
  BACKEND_URL: process.env.BACKEND_URL || 'https://backend-flower2-production.up.railway.app'
};

console.log('=== FLOWER MARKET BACKEND ===');
console.log('Config:', config);

// Хранение данных в памяти
const users = new Map();
const sessions = new Map();
const telegramData = new Map();

// Генерация токенов
function generateSessionToken() { return crypto.randomBytes(32).toString('hex'); }
function generateTempId() { return 'temp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9); }

// Инициализация Telegram бота
let bot = null;
let botInitialized = false;

function initializeTelegramBot() {
  if (!config.BOT_TOKEN || config.BOT_TOKEN === 'ВАШ_ТОКЕН_БОТА') {
    console.warn('⚠️ BOT_TOKEN not set, Telegram bot disabled');
    return;
  }

  try {
    console.log('🤖 Initializing Telegram bot...');
    bot = new TelegramBot(config.BOT_TOKEN, { polling: true });
    
    // Команда /start
    bot.onText(/\/start/, async (msg) => {
      const chatId = msg.chat.id;
      const telegramId = msg.from.id.toString();
      const firstName = msg.from.first_name || 'Пользователь';
      
      console.log(`👤 User /start: ${firstName} (ID: ${telegramId})`);
      
      // Создаем или получаем пользователя
      let user = users.get(telegramId);
      if (!user) {
        user = {
          id: telegramId,
          telegramId: telegramId,
          telegramInfo: {
            firstName: msg.from.first_name,
            username: msg.from.username
          },
          isLoggedIn: true, // Упрощенно - сразу авторизованы
          createdAt: new Date(),
          ads: []
        };
        users.set(telegramId, user);
      }
      
      // Генерируем временный ID для веб-приложения
      const tempId = generateTempId();
      telegramData.set(tempId, {
        telegramId: telegramId,
        firstName: firstName,
        username: msg.from.username,
        timestamp: Date.now()
      });
      
      // Автоматически создаем сессию
      const sessionToken = generateSessionToken();
      user.sessionToken = sessionToken;
      sessions.set(sessionToken, user);
      
      // URL для веб-приложения
      const webAppUrl = `${config.FRONTEND_URL}?session=${sessionToken}`;
      
      // Отправляем сообщение с кнопкой
      const keyboard = {
        reply_markup: {
          inline_keyboard: [[
            {
              text: '🌺 Создать объявление',
              web_app: { url: webAppUrl }
            }
          ]]
        }
      };
      
      const message = `Добро пожаловать в Flower Market, ${firstName}! 🌸\n\n` +
        `✅ Вы авторизованы через Telegram\n` +
        `Нажмите кнопку ниже, чтобы создать объявление.`;
      
      try {
        await bot.sendMessage(chatId, message, { 
          parse_mode: 'Markdown', 
          ...keyboard 
        });
        console.log(`✅ Start message sent to ${telegramId}`);
      } catch (error) {
        console.error('Error sending start message:', error.message);
      }
    });
    
    // Проверяем работу бота
    bot.getMe().then(botInfo => {
      console.log(`✅ Telegram Bot started: @${botInfo.username}`);
      botInitialized = true;
      
      // Устанавливаем команды
      bot.setMyCommands([
        { command: 'start', description: 'Запустить бота и создать объявление' },
        { command: 'help', description: 'Помощь по использованию бота' }
      ]);
      
    }).catch(error => {
      console.error('❌ Failed to get bot info:', error.message);
    });
    
  } catch (error) {
    console.error('❌ Failed to initialize Telegram bot:', error.message);
  }
}

// Инициализируем бота
initializeTelegramBot();

// ==================== API ROUTES ====================

// КОРНЕВОЙ МАРШРУТ - ОБЯЗАТЕЛЬНО ПЕРВЫЙ!
app.get('/', (req, res) => {
  res.json({
    message: '🌺 Flower Market Backend API',
    version: '2.0.0',
    status: 'online',
    timestamp: new Date().toISOString(),
    endpoints: {
      root: 'GET /',
      health: 'GET /health',
      telegramData: 'GET /api/telegram-data/:tempId',
      userCheck: 'GET /api/user/check/:telegramId',
      sessionCheck: 'GET /api/session/:sessionToken',
      draftSave: 'POST /api/draft/save',
      draftGet: 'GET /api/draft/:sessionToken',
      publishAd: 'POST /api/publish-ad',
      logout: 'POST /api/logout'
    },
    stats: {
      users: users.size,
      sessions: sessions.size,
      botInitialized: botInitialized
    }
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    usersCount: users.size,
    sessionsCount: sessions.size,
    botInitialized: botInitialized,
    config: {
      botToken: config.BOT_TOKEN ? 'Set' : 'Missing',
      channelId: config.CHANNEL_ID ? 'Set' : 'Missing'
    }
  });
});

// Получение данных Telegram пользователя
app.get('/api/telegram-data/:tempId', (req, res) => {
  try {
    const tempId = req.params.tempId;
    const data = telegramData.get(tempId);
    
    if (data) {
      // Удаляем временные данные после использования
      telegramData.delete(tempId);
      
      // Создаем пользователя если его нет
      let user = users.get(data.telegramId);
      if (!user) {
        user = {
          id: data.telegramId,
          telegramId: data.telegramId,
          telegramInfo: {
            firstName: data.firstName,
            username: data.username
          },
          isLoggedIn: true,
          createdAt: new Date(),
          ads: []
        };
        users.set(data.telegramId, user);
      }
      
      // Создаем сессию
      const sessionToken = generateSessionToken();
      user.sessionToken = sessionToken;
      sessions.set(sessionToken, user);
      
      res.json({
        success: true,
        telegramId: data.telegramId,
        firstName: data.firstName,
        username: data.username,
        sessionToken: sessionToken
      });
    } else {
      res.json({ 
        success: false, 
        error: 'Telegram data not found or expired' 
      });
    }
  } catch (error) {
    console.error('Error getting telegram data:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Проверка пользователя
app.get('/api/user/check/:telegramId', (req, res) => {
  try {
    const telegramId = req.params.telegramId;
    const user = users.get(telegramId);
    
    if (user) {
      res.json({
        success: true,
        exists: true,
        isLoggedIn: true, // Всегда авторизованы через Telegram
        user: {
          id: user.id,
          telegramId: user.telegramId,
          name: user.telegramInfo.firstName,
          telegramInfo: user.telegramInfo
        }
      });
    } else {
      res.json({ 
        success: true,
        exists: false 
      });
    }
  } catch (error) {
    console.error('Error checking user:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Проверка сессии
app.get('/api/session/:sessionToken', (req, res) => {
  try {
    const sessionToken = req.params.sessionToken;
    const user = sessions.get(sessionToken);
    
    if (user) {
      // Обновляем время последней активности
      user.lastActivity = new Date();
      sessions.set(sessionToken, user);
      users.set(user.telegramId, user);
      
      res.json({
        success: true,
        user: {
          id: user.id,
          telegramId: user.telegramId,
          name: user.telegramInfo.firstName,
          telegramInfo: user.telegramInfo,
          isLoggedIn: true
        },
        sessionToken: sessionToken
      });
    } else {
      res.json({ 
        success: false, 
        error: 'Session not found or expired' 
      });
    }
  } catch (error) {
    console.error('Error checking session:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Сохранение черновика
app.post('/api/draft/save', async (req, res) => {
  try {
    const { sessionToken, draftData } = req.body;
    
    if (!sessionToken) {
      return res.status(400).json({ success: false, error: 'Session token required' });
    }
    
    const user = sessions.get(sessionToken);
    if (!user) {
      return res.status(401).json({ success: false, error: 'User not authenticated' });
    }
    
    // Сохраняем черновик
    user.draft = {
      ...draftData,
      savedAt: new Date()
    };
    
    // Обновляем активность
    user.lastActivity = new Date();
    users.set(user.telegramId, user);
    sessions.set(sessionToken, user);
    
    console.log(`💾 Draft saved for user ${user.telegramId}`);
    
    res.json({
      success: true,
      message: 'Черновик сохранен',
      savedAt: user.draft.savedAt
    });
    
  } catch (error) {
    console.error('Error saving draft:', error);
    res.status(500).json({ success: false, error: 'Ошибка сохранения' });
  }
});

// Получение черновика
app.get('/api/draft/:sessionToken', async (req, res) => {
  try {
    const sessionToken = req.params.sessionToken;
    const user = sessions.get(sessionToken);
    
    if (!user) {
      return res.status(401).json({ success: false, error: 'User not authenticated' });
    }
    
    if (user.draft) {
      res.json({
        success: true,
        draft: user.draft,
        exists: true
      });
    } else {
      res.json({
        success: true,
        draft: null,
        exists: false
      });
    }
    
  } catch (error) {
    console.error('Error getting draft:', error);
    res.status(500).json({ success: false, error: 'Ошибка загрузки' });
  }
});

// Публикация объявления - ГЛАВНАЯ ФУНКЦИЯ!
app.post('/api/publish-ad', async (req, res) => {
  try {
    const { sessionToken, title, description, price, contactInfo, photos } = req.body;
    
    if (!sessionToken) {
      return res.status(400).json({ success: false, error: 'Session token required' });
    }
    
    const user = sessions.get(sessionToken);
    if (!user) {
      return res.status(401).json({ success: false, error: 'User not authenticated' });
    }
    
    console.log(`📝 Новое объявление от ${user.telegramId}:`, { title, price });
    
    // Формируем сообщение для Telegram
    let telegramMessage = `🌸 *${title}* 🌸\n\n` +
                   `📝 *Описание:*\n${description}\n\n` +
                   `💰 *Цена:* ${price}\n` +
                   `📞 *Контакты:* ${contactInfo}\n\n` +
                   `👤 *Продавец:* ${user.telegramInfo.firstName}\n`;
    
    if (user.telegramInfo.username) {
      telegramMessage += `💬 *Telegram:* @${user.telegramInfo.username}\n`;
    }
    
    telegramMessage += `\n🕒 *Дата:* ${new Date().toLocaleString('ru-RU')}\n` +
                      `#цветы`;
    
    let telegramMessageId = null;
    let error = null;
    
    // Пытаемся отправить в канал если бот активен
    if (botInitialized && config.CHANNEL_ID) {
      try {
        const sentMessage = await bot.sendMessage(config.CHANNEL_ID, telegramMessage, {
          parse_mode: 'Markdown'
        });
        
        if (sentMessage) {
          telegramMessageId = sentMessage.message_id;
          console.log(`✅ Объявление опубликовано в канале, ID сообщения: ${telegramMessageId}`);
        }
      } catch (sendError) {
        error = sendError.message;
        console.error('Ошибка отправки в Telegram:', sendError.message);
      }
    } else {
      error = 'Бот или канал не настроены';
    }
    
    // Создаем запись об объявлении
    const ad = {
      id: Date.now(),
      title,
      description,
      price,
      contactInfo,
      photos: photos || [],
      telegramMessageId,
      publishedAt: new Date(),
      status: telegramMessageId ? 'published' : 'failed',
      error: error
    };
    
    // Добавляем в историю пользователя
    user.ads = user.ads || [];
    user.ads.push(ad);
    
    // Удаляем черновик
    delete user.draft;
    
    // Обновляем активность
    user.lastActivity = new Date();
    users.set(user.telegramId, user);
    sessions.set(sessionToken, user);
    
    // Отправляем уведомление пользователю
    if (botInitialized && user.telegramId) {
      try {
        let userMessage;
        
        if (telegramMessageId) {
          userMessage = `✅ *Ваше объявление опубликовано!*\n\n` +
            `*Заголовок:* ${title}\n` +
            `*Цена:* ${price}\n\n` +
            `📢 *Ссылка на объявление:* https://t.me/${config.CHANNEL_ID.replace('@', '')}/${telegramMessageId}`;
        } else {
          userMessage = `⚠️ *Объявление не опубликовано*\n\n` +
            `*Заголовок:* ${title}\n` +
            `*Цена:* ${price}\n\n` +
            `*Причина:* ${error || 'Ошибка при отправке'}`;
        }
        
        const webAppUrl = `${config.FRONTEND_URL}?session=${sessionToken}`;
        
        await bot.sendMessage(user.telegramId, userMessage, { 
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              {
                text: '🌺 Создать еще',
                web_app: { url: webAppUrl }
              }
            ]]
          }
        });
      } catch (notifyError) {
        console.error('Не удалось уведомить пользователя:', notifyError.message);
      }
    }
    
    res.json({
      success: true,
      message: telegramMessageId ? 'Объявление успешно опубликовано!' : 'Объявление сохранено',
      adId: ad.id,
      telegramMessageId,
      error: error
    });
    
  } catch (error) {
    console.error('Error publishing ad:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Ошибка публикации',
      details: error.message 
    });
  }
});

// Выход
app.post('/api/logout', async (req, res) => {
  try {
    const { sessionToken } = req.body;
    
    if (sessionToken && sessions.has(sessionToken)) {
      sessions.delete(sessionToken);
      console.log(`👋 User logged out, session: ${sessionToken.substring(0, 10)}...`);
    }
    
    res.json({ 
      success: true, 
      message: 'Logged out successfully' 
    });
    
  } catch (error) {
    console.error('Error logging out:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Очистка старых сессий (раз в день)
setInterval(() => {
  const now = new Date();
  const SESSION_TIMEOUT = 7 * 24 * 60 * 60 * 1000; // 7 дней
  
  let deleted = 0;
  sessions.forEach((user, sessionToken) => {
    if (user.lastActivity && (now - user.lastActivity > SESSION_TIMEOUT)) {
      sessions.delete(sessionToken);
      deleted++;
    }
  });
  
  if (deleted > 0) {
    console.log(`🧹 Очищено ${deleted} старых сессий`);
  }
}, 24 * 60 * 60 * 1000); // Каждый день

// 404 handler
app.use((req, res) => {
  console.log(`404 Not Found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({
    error: 'Route not found',
    requestedUrl: req.originalUrl,
    availableEndpoints: [
      'GET /',
      'GET /health',
      'GET /api/telegram-data/:tempId',
      'GET /api/user/check/:telegramId',
      'GET /api/session/:sessionToken',
      'POST /api/draft/save',
      'GET /api/draft/:sessionToken',
      'POST /api/publish-ad',
      'POST /api/logout'
    ]
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌍 CORS enabled for all origins`);
  console.log(`🤖 Bot: ${botInitialized ? '✅ Active' : '❌ Inactive'}`);
  console.log(`\n=== СЕРВЕР ЗАПУЩЕН ===`);
  console.log(`1. API доступен по адресу: https://backend-flower2-production.up.railway.app/`);
  console.log(`2. Health check: https://backend-flower2-production.up.railway.app/health`);
  console.log(`\n=== НАСТРОЙКА ===`);
  console.log(`Чтобы бот заработал, замените "ВАШ_ТОКЕН_БОТА" на реальный токен:`);
  console.log(`1. Откройте Telegram, найдите @BotFather`);
  console.log(`2. Создайте бота: /newbot`);
  console.log(`3. Скопируйте токен и вставьте в переменную BOT_TOKEN в Railway`);
  console.log(`4. ИЛИ прямо в коде замените "ВАШ_ТОКЕН_БОТА" на ваш токен`);
});

// Обработка завершения
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  if (bot) bot.stopPolling();
  process.exit(0);
});