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

// ФИКСИРОВАННАЯ ССЫЛКА - ВАШ САЙТ
const CORRECT_FRONTEND_URL = 'https://flowers-telegram-kyrgyzstan.up.railway.app';
const WRONG_FRONTEND_URL = 'https://flowers-telegram-kyrgyzstan.onrender.com'; // старый сайт

console.log('🔗 === FRONTEND URLS ===');
console.log('✅ Правильный URL:', CORRECT_FRONTEND_URL);
console.log('❌ Старый URL (возможно кеширован):', WRONG_FRONTEND_URL);

const channelId = process.env.CHANNEL_ID;
const adminChatId = process.env.ADMIN_CHAT_ID;

// Инициализация Google OAuth
let googleClient;
if (process.env.GOOGLE_CLIENT_ID) {
  googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
}

// Хранение пользователей
const users = new Map();

// Инициализация Telegram бота
let bot;
let botInitialized = false;

function initializeTelegramBot() {
  if (!process.env.BOT_TOKEN) {
    console.warn('⚠️ BOT_TOKEN not found');
    return;
  }

  try {
    console.log('🤖 Запускаю Telegram бота...');
    
    bot = new TelegramBot(process.env.BOT_TOKEN, {
      polling: {
        interval: 3000,
        timeout: 30,
        autoStart: true
      }
    });

    // ========== КОМАНДА /start ==========
    bot.onText(/\/start/, (msg) => {
      const chatId = msg.chat.id;
      const userId = msg.from.id.toString();
      const firstName = msg.from.first_name || 'Пользователь';
      
      console.log(`👤 Команда /start от ${firstName} (ID: ${userId})`);
      
      // Сохраняем пользователя
      if (!users.has(userId)) {
        users.set(userId, {
          id: userId,
          telegramId: userId,
          name: firstName,
          isLoggedIn: false,
          createdAt: new Date(),
          isApproved: true
        });
      }
      
      // Создаем клавиатуру с КОРРЕКТНОЙ ссылкой
      const keyboard = {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '🌺 Создать объявление (Web App)',
                web_app: { url: CORRECT_FRONTEND_URL }
              }
            ],
            [
              {
                text: '🌐 Открыть в браузере',
                url: CORRECT_FRONTEND_URL
              }
            ],
            [
              {
                text: '🔄 Проверить ссылку',
                callback_data: 'check_url'
              }
            ]
          ]
        }
      };
      
      const message = `👋 Добро пожаловать в Flower Market, ${firstName}! 🌸\n\n` +
        `Я помогу вам создать объявление о продаже цветов.\n\n` +
        `*📱 Используйте Web App кнопку:*\n` +
        `Откроет приложение прямо в Telegram\n\n` +
        `*🌐 Или откройте в браузере:*\n` +
        `${CORRECT_FRONTEND_URL}\n\n` +
        `*🆔 Ваш Telegram ID:* \`${userId}\`\n` +
        `Сохраните этот ID для авторизации.\n\n` +
        `*Проблемы с ссылкой?* Нажмите "Проверить ссылку"`;
      
      bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        ...keyboard,
        disable_web_page_preview: true
      }).catch(err => console.error('Ошибка отправки:', err.message));
    });

    // ========== КОМАНДА /url ==========
    bot.onText(/\/url/, (msg) => {
      const chatId = msg.chat.id;
      
      const message = `🔗 *Доступные ссылки на Flower Market*\n\n` +
        `*🌐 Основной сайт:*\n` +
        `${CORRECT_FRONTEND_URL}\n\n` +
        `*📱 Web App ссылка:*\n` +
        `tg://webapp?url=${encodeURIComponent(CORRECT_FRONTEND_URL)}\n\n` +
        `*Как открыть:*\n` +
        `1. Нажмите кнопку ниже\n` +
        `2. Или скопируйте ссылку\n` +
        `3. Вставьте в браузер`;
      
      const keyboard = {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '🌐 Открыть сайт',
                url: CORRECT_FRONTEND_URL
              }
            ],
            [
              {
                text: '📱 Открыть Web App',
                web_app: { url: CORRECT_FRONTEND_URL }
              }
            ],
            [
              {
                text: '🔗 Скопировать ссылку',
                callback_data: 'copy_url'
              }
            ]
          ]
        }
      };
      
      bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        ...keyboard,
        disable_web_page_preview: true
      });
    });

    // ========== КОМАНДА /fix ==========
    bot.onText(/\/fix/, (msg) => {
      const chatId = msg.chat.id;
      
      const message = `🔧 *Исправление проблем со ссылкой*\n\n` +
        `Если Web App открывает старый сайт:\n\n` +
        `1. *Полностью закройте Telegram*\n` +
        `2. *Перезапустите Telegram*\n` +
        `3. *Напишите /start снова*\n\n` +
        `Или используйте прямую ссылку:\n` +
        `${CORRECT_FRONTEND_URL}\n\n` +
        `*Проверьте текущую ссылку:*`;
      
      const keyboard = {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '🔗 Тест Web App',
                web_app: { url: CORRECT_FRONTEND_URL + '?test=' + Date.now() }
              }
            ],
            [
              {
                text: '🌐 Прямая ссылка',
                url: CORRECT_FRONTEND_URL
              }
            ]
          ]
        }
      };
      
      bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        ...keyboard
      });
    });

    // ========== ОБРАБОТКА CALLBACK КНОПОК ==========
    bot.on('callback_query', (callbackQuery) => {
      const chatId = callbackQuery.message.chat.id;
      const data = callbackQuery.data;
      const messageId = callbackQuery.message.message_id;
      
      if (data === 'check_url') {
        const testUrl = CORRECT_FRONTEND_URL + '?test=' + Date.now();
        
        bot.answerCallbackQuery(callbackQuery.id, {
          text: 'Проверяю ссылку...'
        });
        
        // Редактируем сообщение с новой кнопкой
        const keyboard = {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: '🔄 Тестовая ссылка (без кеша)',
                  web_app: { url: testUrl }
                }
              ],
              [
                {
                  text: '🌐 Основная ссылка',
                  url: CORRECT_FRONTEND_URL
                }
              ]
            ]
          }
        };
        
        bot.editMessageReplyMarkup(keyboard.reply_markup, {
          chat_id: chatId,
          message_id: messageId
        });
        
      } else if (data === 'copy_url') {
        bot.answerCallbackQuery(callbackQuery.id, {
          text: 'Ссылка скопирована! Откройте в браузере: ' + CORRECT_FRONTEND_URL,
          show_alert: true
        });
      }
    });

    // ========== ПРОВЕРКА БОТА ==========
    bot.getMe().then(botInfo => {
      console.log(`✅ Бот запущен: @${botInfo.username}`);
      botInitialized = true;
      
      // Устанавливаем команды бота
      bot.setMyCommands([
        { command: 'start', description: 'Запустить бота' },
        { command: 'url', description: 'Показать ссылки' },
        { command: 'fix', description: 'Исправить проблемы' },
        { command: 'id', description: 'Мой Telegram ID' }
      ]).then(() => {
        console.log('✅ Команды бота настроены');
      }).catch(err => {
        console.error('Ошибка настройки команд:', err.message);
      });
      
      console.log('\n📌 Доступные команды:');
      console.log('/start - Основная команда');
      console.log('/url - Показать все ссылки');
      console.log('/fix - Исправить проблемы со ссылкой');
      console.log('/id - Показать ваш ID');
      
    }).catch(err => {
      console.error('❌ Ошибка бота:', err.message);
      botInitialized = false;
    });

  } catch (error) {
    console.error('❌ Ошибка инициализации бота:', error.message);
  }
}

initializeTelegramBot();

// ==================== API РОУТЫ ====================

app.get('/', (req, res) => {
  res.json({
    service: 'Flower Market API',
    correct_frontend_url: CORRECT_FRONTEND_URL,
    telegram_bot: botInitialized ? 'active' : 'inactive',
    instructions: 'Используйте команды: /start, /url, /fix в боте'
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    correct_url: CORRECT_FRONTEND_URL,
    bot_ready: botInitialized,
    time: new Date().toISOString()
  });
});

// Тестовый endpoint для проверки Web App
app.get('/api/test-webapp', (req, res) => {
  const testData = {
    success: true,
    message: 'Web App работает!',
    url: CORRECT_FRONTEND_URL,
    timestamp: new Date().toISOString(),
    query: req.query
  };
  
  res.json(testData);
});

// Авторизация через Google
app.post('/api/auth/google', async (req, res) => {
  try {
    const { token, telegramUserId } = req.body;
    
    if (!token) {
      return res.status(400).json({ error: 'No token provided' });
    }

    if (!googleClient) {
      return res.status(500).json({ error: 'Google OAuth not configured' });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    
    const user = {
      id: telegramUserId || `user_${Date.now()}`,
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

    users.set(user.id, user);
    
    console.log(`✅ Пользователь зарегистрирован: ${user.name}`);

    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        picture: user.picture,
        isApproved: true,
        telegramId: user.telegramId
      }
    });

  } catch (error) {
    console.error('Ошибка Google авторизации:', error);
    res.status(401).json({ error: 'Authentication failed' });
  }
});

// Публикация объявления
app.post('/api/publish-ad', async (req, res) => {
  try {
    const { userId, title, description, price, contactInfo } = req.body;
    
    console.log(`📝 Новое объявление: ${title}`);
    
    const user = users.get(userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    const message = `🌸 *${title}* 🌸\n\n` +
                   `📝 ${description}\n\n` +
                   `💰 Цена: ${price}\n` +
                   `📞 Контакты: ${contactInfo}\n\n` +
                   `👤 Продавец: ${user.name}\n` +
                   `🕒 ${new Date().toLocaleString('ru-RU')}\n\n` +
                   `#цветы #${user.name.replace(/\s+/g, '_')}`;

    let messageId = null;
    
    if (botInitialized && channelId) {
      try {
        const result = await bot.sendMessage(channelId, message, {
          parse_mode: 'Markdown'
        });
        messageId = result.message_id;
        console.log(`✅ Объявление отправлено в канал, ID: ${messageId}`);
      } catch (error) {
        console.error('Ошибка отправки в канал:', error.message);
      }
    }

    res.json({
      success: true,
      message: 'Объявление опубликовано',
      messageId: messageId
    });

  } catch (error) {
    console.error('Ошибка публикации:', error);
    res.status(500).json({ error: 'Failed to publish' });
  }
});

app.get('/api/user/:userId/status', (req, res) => {
  const user = users.get(req.params.userId);
  
  if (user && user.isLoggedIn) {
    res.json({
      isLoggedIn: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        picture: user.picture,
        isApproved: user.isApproved,
        telegramId: user.telegramId
      }
    });
  } else {
    res.json({ isLoggedIn: false });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log(`🌐 Корректный фронтенд: ${CORRECT_FRONTEND_URL}`);
  console.log(`🤖 Статус бота: ${botInitialized ? '✅ Готов' : '❌ Не готов'}`);
  console.log(`\n📌 ДЕЙСТВИЯ ДЛЯ РЕШЕНИЯ ПРОБЛЕМЫ:`);
  console.log(`1. Напишите боту /fix для инструкций`);
  console.log(`2. Используйте /url для прямых ссылок`);
  console.log(`3. Закройте и перезапустите Telegram`);
  console.log(`\n🔗 Для теста: ${CORRECT_FRONTEND_URL}/api/test-webapp`);
});