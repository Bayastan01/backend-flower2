const express = require('express');
const cors = require('cors');
const { OAuth2Client } = require('google-auth-library');
const TelegramBot = require('node-telegram-bot-api');
const crypto = require('crypto');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors({
  origin: ['https://flowers-telegram-kyrgyzstan.up.railway.app'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));

app.options('*', cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Проверка переменных окружения
console.log('=== ENVIRONMENT CHECK ===');
console.log('- BOT_TOKEN:', process.env.BOT_TOKEN ? '✓ Set' : '✗ Missing');
console.log('- GOOGLE_CLIENT_ID:', process.env.GOOGLE_CLIENT_ID ? `✓ Set` : '✗ Missing');
console.log('- CHANNEL_ID:', process.env.CHANNEL_ID ? '✓ Set' : '✗ Missing');
console.log('- ADMIN_CHAT_ID:', process.env.ADMIN_CHAT_ID ? '✓ Set' : '✗ Missing');
console.log('- NODE_ENV:', process.env.NODE_ENV || 'development');

// Инициализация Google OAuth
let googleClient;
try {
  googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  console.log('✅ Google OAuth initialized');
} catch (error) {
  console.error('❌ Google OAuth init error:', error.message);
  googleClient = null;
}

const channelId = process.env.CHANNEL_ID;
const adminChatId = process.env.ADMIN_CHAT_ID;

// Хранение данных (в продакшене нужно использовать Redis или БД)
const users = new Map(); // telegramId -> user
const sessions = new Map(); // sessionToken -> user
const telegramData = new Map(); // tempId -> telegram data

// Генерация сессионного токена
function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Генерация временного ID
function generateTempId() {
  return 'temp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Инициализация Telegram бота
let bot;
let botInitialized = false;

function initializeTelegramBot() {
  if (!process.env.BOT_TOKEN) {
    console.warn('⚠️ BOT_TOKEN not found, Telegram bot disabled');
    return;
  }

  try {
    console.log('🤖 Initializing Telegram bot...');
    
    bot = new TelegramBot(process.env.BOT_TOKEN, {
      polling: {
        interval: 3000,
        timeout: 30,
        autoStart: true,
        params: { timeout: 30 }
      }
    });

    // Команда /start
    bot.onText(/\/start/, async (msg) => {
      const chatId = msg.chat.id;
      const telegramId = msg.from.id.toString();
      const firstName = msg.from.first_name || 'Пользователь';
      const username = msg.from.username ? `@${msg.from.username}` : 'без username';
      
      console.log(`👤 User /start: ${firstName} (ID: ${telegramId})`);
      
      // Создаем или получаем пользователя
      let user = users.get(telegramId);
      
      if (!user) {
        user = {
          id: telegramId,
          telegramId: telegramId,
          telegramInfo: {
            firstName: msg.from.first_name,
            lastName: msg.from.last_name,
            username: msg.from.username,
            languageCode: msg.from.language_code || 'ru',
            isBot: msg.from.is_bot || false
          },
          googleInfo: null,
          isLoggedIn: false,
          createdAt: new Date(),
          isApproved: true,
          ads: [],
          sessionToken: null,
          lastActivity: new Date()
        };
        users.set(telegramId, user);
        console.log(`✅ New Telegram user created: ${firstName} (${telegramId})`);
      }
      
      // Генерируем временный ID для передачи во фронтенд
      const tempId = generateTempId();
      telegramData.set(tempId, {
        telegramId: telegramId,
        firstName: firstName,
        username: username,
        timestamp: Date.now()
      });
      
      // Чистим старые временные данные через 5 минут
      setTimeout(() => {
        telegramData.delete(tempId);
      }, 5 * 60 * 1000);
      
      // Отправляем сообщение с кнопкой
      const frontendUrl = process.env.FRONTEND_URL || 'https://flowers-telegram-kyrgyzstan.up.railway.app';
      const webAppUrl = `${frontendUrl}?telegram_id=${telegramId}&temp_id=${tempId}`;
      
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
      
      let message = `Добро пожаловать в Flower Market, ${firstName}! 🌸\n\n`;
      
      if (user.googleInfo) {
        message += `✅ Вы уже авторизованы как ${user.googleInfo.name}\n`;
        message += `📧 Email: ${user.googleInfo.email}\n\n`;
        message += `Нажмите кнопку ниже, чтобы создать новое объявление.`;
      } else {
        message += `Для создания объявлений нужно:\n`;
        message += `1. Нажать кнопку ниже\n`;
        message += `2. Войти через Google\n`;
        message += `3. Заполнить форму объявления\n\n`;
        message += `*Ваш Telegram ID:* \`${telegramId}\``;
      }
      
      await bot.sendMessage(chatId, message, { 
        parse_mode: 'Markdown', 
        ...keyboard 
      });
      
    });

    // Команда /me - профиль
    bot.onText(/\/me/, async (msg) => {
      const chatId = msg.chat.id;
      const telegramId = msg.from.id.toString();
      const user = users.get(telegramId);
      
      if (user && user.googleInfo) {
        let message = `*📋 Ваш профиль*\n\n`;
        message += `👤 *Имя:* ${user.googleInfo.name}\n`;
        message += `📧 *Email:* ${user.googleInfo.email}\n`;
        message += `📱 *Telegram ID:* \`${user.telegramId}\`\n`;
        
        if (user.telegramInfo.username) {
          message += `👤 *Telegram:* @${user.telegramInfo.username}\n`;
        }
        
        message += `✅ *Статус:* ${user.isApproved ? 'Одобрен ✅' : 'Ожидает ⏳'}\n`;
        message += `📊 *Объявлений:* ${user.ads.length}\n`;
        message += `📅 *Регистрация:* ${user.createdAt.toLocaleDateString('ru-RU')}\n\n`;
        
        if (user.ads.length > 0) {
          message += `*Последние объявления:*\n`;
          const recentAds = user.ads.slice(-3).reverse();
          recentAds.forEach((ad, index) => {
            const status = ad.telegramMessageId ? '✅ Опубликовано' : '⚠️ Черновик';
            message += `${index + 1}. "${ad.title}" - ${ad.price} (${status})\n`;
          });
        }
        
        const keyboard = {
          reply_markup: {
            inline_keyboard: [[
              {
                text: '🌺 Создать объявление',
                web_app: { 
                  url: `${process.env.FRONTEND_URL || 'https://flowers-telegram-kyrgyzstan.up.railway.app'}?telegram_id=${telegramId}` 
                }
              },
              {
                text: '📋 Мои объявления',
                callback_data: 'my_ads'
              }
            ]]
          }
        };
        
        await bot.sendMessage(chatId, message, { 
          parse_mode: 'Markdown',
          ...keyboard 
        });
        
      } else {
        await bot.sendMessage(chatId, 
          `Вы еще не авторизовались через Google.\n\n` +
          `Используйте команду /start и войдите через Google в веб-приложении.`,
          { parse_mode: 'Markdown' }
        );
      }
    });

    // Обработчик callback кнопок
    bot.on('callback_query', async (callbackQuery) => {
      const chatId = callbackQuery.message.chat.id;
      const telegramId = callbackQuery.from.id.toString();
      const data = callbackQuery.data;
      
      if (data === 'my_ads') {
        const user = users.get(telegramId);
        if (user && user.ads.length > 0) {
          let message = `*📋 Ваши объявления (${user.ads.length})*\n\n`;
          
          user.ads.forEach((ad, index) => {
            const date = new Date(ad.publishedAt).toLocaleDateString('ru-RU');
            const status = ad.telegramMessageId ? '✅' : '⚠️';
            message += `${index + 1}. ${status} *${ad.title}*\n`;
            message += `   💰 ${ad.price}\n`;
            message += `   📅 ${date}\n`;
            
            if (ad.telegramMessageId) {
              message += `   🔗 [Посмотреть](${getChannelMessageLink(ad.telegramMessageId)})\n`;
            }
            message += `\n`;
          });
          
          await bot.sendMessage(chatId, message, { 
            parse_mode: 'Markdown',
            disable_web_page_preview: true 
          });
        } else {
          await bot.sendMessage(chatId, 
            `У вас пока нет объявлений.\n\n` +
            `Создайте первое объявление через веб-приложение!`,
            { parse_mode: 'Markdown' }
          );
        }
      }
      
      await bot.answerCallbackQuery(callbackQuery.id);
    });

    // Успешная инициализация
    bot.getMe().then(botInfo => {
      console.log(`✅ Telegram Bot started: @${botInfo.username}`);
      botInitialized = true;
      
      bot.setMyCommands([
        { command: 'start', description: 'Запустить бота' },
        { command: 'me', description: 'Мой профиль' },
        { command: 'help', description: 'Помощь' }
      ]);
      
    }).catch(error => {
      console.error('❌ Failed to get bot info:', error.message);
    });

  } catch (error) {
    console.error('❌ Failed to initialize Telegram bot:', error.message);
  }
}

initializeTelegramBot();

// Функция для получения ссылки на сообщение в канале
function getChannelMessageLink(messageId) {
  if (!channelId) return '#';
  const chatId = channelId.toString().replace('-100', '');
  return `https://t.me/c/${chatId}/${messageId}`;
}

// ==================== ROUTES ====================

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    usersCount: users.size,
    sessionsCount: sessions.size,
    botInitialized: botInitialized,
    googleOAuthInitialized: !!googleClient,
    environment: process.env.NODE_ENV || 'development'
  });
});

// Получение информации о Telegram пользователе
app.get('/api/telegram-data/:tempId', (req, res) => {
  try {
    const tempId = req.params.tempId;
    const data = telegramData.get(tempId);
    
    if (data) {
      // Удаляем временные данные после использования
      telegramData.delete(tempId);
      
      res.json({
        success: true,
        telegramId: data.telegramId,
        firstName: data.firstName,
        username: data.username
      });
    } else {
      res.json({ 
        success: false, 
        error: 'Telegram data not found or expired' 
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Проверка существования пользователя
app.get('/api/user/check/:telegramId', (req, res) => {
  try {
    const telegramId = req.params.telegramId;
    const user = users.get(telegramId);
    
    if (user) {
      res.json({
        success: true,
        exists: true,
        isLoggedIn: user.isLoggedIn,
        user: {
          id: user.id,
          name: user.googleInfo?.name || user.telegramInfo.firstName,
          email: user.googleInfo?.email,
          picture: user.googleInfo?.picture,
          isApproved: user.isApproved
        }
      });
    } else {
      res.json({ 
        success: true,
        exists: false 
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Авторизация через Google
app.post('/api/auth/google', async (req, res) => {
  console.log('🔐 Google auth request');
  
  try {
    const { token, telegramId } = req.body;
    
    if (!token) {
      return res.status(400).json({ 
        success: false, 
        error: 'No Google token provided' 
      });
    }

    if (!telegramId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Telegram ID is required' 
      });
    }

    if (!googleClient) {
      return res.status(500).json({ 
        success: false, 
        error: 'Google OAuth not configured' 
      });
    }

    // Верификация Google токена
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    console.log(`✅ Google auth successful for: ${payload.email}`);
    
    // Ищем существующего пользователя
    let user = users.get(telegramId);
    
    if (!user) {
      // Создаем нового пользователя
      user = {
        id: telegramId,
        telegramId: telegramId,
        telegramInfo: {
          firstName: 'Пользователь',
          lastName: '',
          username: '',
          languageCode: 'ru',
          isBot: false
        },
        googleInfo: null,
        isLoggedIn: false,
        createdAt: new Date(),
        isApproved: true,
        ads: [],
        sessionToken: null,
        lastActivity: new Date()
      };
      console.log(`👤 Created new user for Telegram ID: ${telegramId}`);
    }
    
    // Обновляем Google информацию
    user.googleInfo = {
      googleId: payload.sub,
      name: payload.name,
      email: payload.email,
      picture: payload.picture,
      emailVerified: payload.email_verified,
      locale: payload.locale
    };
    
    user.isLoggedIn = true;
    user.lastActivity = new Date();
    
    // Генерируем новую сессию
    const sessionToken = generateSessionToken();
    user.sessionToken = sessionToken;
    sessions.set(sessionToken, user);
    
    // Сохраняем пользователя
    users.set(telegramId, user);
    
    console.log(`✅ User authenticated: ${user.googleInfo.name} (${user.googleInfo.email})`);
    
    // Отправляем уведомление администратору
    if (botInitialized && adminChatId) {
      try {
        let adminMessage = `📋 *Новый пользователь авторизовался*\n\n`;
        adminMessage += `👤 *Имя:* ${user.googleInfo.name}\n`;
        adminMessage += `📧 *Email:* ${user.googleInfo.email}\n`;
        adminMessage += `📱 *Telegram ID:* ${user.telegramId}\n`;
        
        if (user.telegramInfo.username) {
          adminMessage += `👤 *Telegram username:* @${user.telegramInfo.username}\n`;
        }
        
        adminMessage += `✅ *Статус:* Автоматически одобрен\n`;
        adminMessage += `⏰ *Время:* ${new Date().toLocaleString('ru-RU')}`;
        
        await bot.sendMessage(adminChatId, adminMessage, { parse_mode: 'Markdown' });
        console.log(`📤 Admin notification sent`);
      } catch (botError) {
        console.error('Admin notification failed:', botError.message);
      }
    }
    
    // Отправляем приветственное сообщение пользователю
    if (botInitialized && user.telegramId) {
      try {
        const frontendUrl = process.env.FRONTEND_URL || 'https://flowers-telegram-kyrgyzstan.up.railway.app';
        const webAppUrl = `${frontendUrl}?session=${sessionToken}`;
        
        const welcomeMessage = `🎉 *Добро пожаловать, ${user.googleInfo.name}!*\n\n` +
          `✅ Вы успешно авторизовались в Flower Market.\n\n` +
          `*Ваши данные:*\n` +
          `👤 Имя: ${user.googleInfo.name}\n` +
          `📧 Email: ${user.googleInfo.email}\n` +
          `📱 Telegram ID: ${user.telegramId}\n\n` +
          `Теперь вы можете создавать объявления о продаже цветов!`;
        
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
        
        await bot.sendMessage(user.telegramId, welcomeMessage, { 
          parse_mode: 'Markdown',
          ...keyboard 
        });
        
        console.log(`📤 Welcome message sent to user ${user.telegramId}`);
      } catch (botError) {
        console.error('Welcome message failed:', botError.message);
      }
    }
    
    res.json({
      success: true,
      user: {
        id: user.id,
        telegramId: user.telegramId,
        name: user.googleInfo.name,
        email: user.googleInfo.email,
        picture: user.googleInfo.picture,
        isApproved: user.isApproved
      },
      sessionToken: sessionToken
    });

  } catch (error) {
    console.error('❌ Google auth error:', error.message);
    res.status(401).json({ 
      success: false, 
      error: 'Authentication failed',
      details: error.message 
    });
  }
});

// Проверка сессии
app.get('/api/session/:sessionToken', (req, res) => {
  try {
    const sessionToken = req.params.sessionToken;
    const user = sessions.get(sessionToken);
    
    if (user && user.isLoggedIn) {
      // Обновляем время последней активности
      user.lastActivity = new Date();
      sessions.set(sessionToken, user);
      users.set(user.telegramId, user);
      
      res.json({
        success: true,
        user: {
          id: user.id,
          telegramId: user.telegramId,
          name: user.googleInfo?.name || user.telegramInfo.firstName,
          email: user.googleInfo?.email,
          picture: user.googleInfo?.picture,
          isApproved: user.isApproved,
          telegramInfo: user.telegramInfo
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
    res.status(500).json({ success: false, error: error.message });
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
    if (!user || !user.isLoggedIn) {
      return res.status(401).json({ success: false, error: 'User not authenticated' });
    }
    
    // Сохраняем черновик
    user.draft = {
      ...draftData,
      savedAt: new Date(),
      updatedAt: new Date()
    };
    
    user.lastActivity = new Date();
    users.set(user.telegramId, user);
    sessions.set(sessionToken, user);
    
    console.log(`💾 Draft saved for user ${user.telegramId}`);
    
    res.json({
      success: true,
      message: 'Draft saved successfully',
      savedAt: user.draft.savedAt
    });
    
  } catch (error) {
    console.error('Error saving draft:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Получение черновика
app.get('/api/draft/:sessionToken', async (req, res) => {
  try {
    const sessionToken = req.params.sessionToken;
    const user = sessions.get(sessionToken);
    
    if (!user || !user.isLoggedIn) {
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
    res.status(500).json({ success: false, error: error.message });
  }
});

// Публикация объявления
app.post('/api/publish-ad', async (req, res) => {
  try {
    const { sessionToken, title, description, price, contactInfo, photos } = req.body;
    
    if (!sessionToken) {
      return res.status(400).json({ success: false, error: 'Session token required' });
    }
    
    const user = sessions.get(sessionToken);
    if (!user || !user.isLoggedIn) {
      return res.status(401).json({ success: false, error: 'User not authenticated' });
    }
    
    console.log(`📝 New ad from ${user.telegramId}:`, { title, price });
    
    // Формируем сообщение для канала
    const telegramMessage = `🌸 *${title}* 🌸\n\n` +
                   `📝 *Описание:*\n${description}\n\n` +
                   `💰 *Цена:* ${price}\n` +
                   `📞 *Контакты:* ${contactInfo}\n\n` +
                   `👤 *Продавец:* ${user.googleInfo?.name || user.telegramInfo.firstName}\n`;
    
    // Добавляем контакты пользователя если есть
    if (user.telegramInfo.username) {
      telegramMessage += `💬 *Telegram:* @${user.telegramInfo.username}\n`;
    }
    
    telegramMessage += `\n🕒 *Дата:* ${new Date().toLocaleString('ru-RU')}\n` +
                      `#цветы`;
    
    let telegramMessageId = null;
    let error = null;
    
    // Отправляем в канал
    if (botInitialized && channelId) {
      try {
        const sentMessage = await bot.sendMessage(channelId, telegramMessage, {
          parse_mode: 'Markdown'
        });
        
        if (sentMessage) {
          telegramMessageId = sentMessage.message_id;
          console.log(`✅ Ad published to channel, message ID: ${telegramMessageId}`);
        }
      } catch (sendError) {
        error = sendError.message;
        console.error('Telegram send error:', sendError.message);
      }
    } else {
      error = 'Bot or channel not configured';
    }
    
    // Создаем объявление
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
    
    // Удаляем черновик после публикации
    delete user.draft;
    
    user.lastActivity = new Date();
    users.set(user.telegramId, user);
    sessions.set(sessionToken, user);
    
    // Отправляем уведомление пользователю
    if (botInitialized && user.telegramId) {
      try {
        let userMessage;
        
        if (telegramMessageId) {
          const messageLink = getChannelMessageLink(telegramMessageId);
          userMessage = `✅ *Ваше объявление опубликовано!*\n\n` +
            `*Заголовок:* ${title}\n` +
            `*Цена:* ${price}\n\n` +
            `📢 *Ссылка на объявление:*\n` +
            `${messageLink}`;
        } else {
          userMessage = `⚠️ *Объявление не опубликовано*\n\n` +
            `*Заголовок:* ${title}\n` +
            `*Цена:* ${price}\n\n` +
            `*Причина:* ${error || 'Ошибка при отправке'}\n` +
            `*Не волнуйтесь, данные сохранены и будут опубликованы позже!*`;
        }
        
        const frontendUrl = process.env.FRONTEND_URL || 'https://flowers-telegram-kyrgyzstan.up.railway.app';
        const webAppUrl = `${frontendUrl}?session=${sessionToken}`;
        
        await bot.sendMessage(user.telegramId, userMessage, { 
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              {
                text: '🌺 Создать еще',
                web_app: { url: webAppUrl }
              },
              {
                text: '📢 Посмотреть канал',
                url: 'https://t.me/flowers_market_kg'
              }
            ]]
          }
        });
      } catch (notifyError) {
        console.error('Could not notify user:', notifyError.message);
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
      error: 'Failed to publish ad',
      details: error.message 
    });
  }
});

// Выход из системы
app.post('/api/logout', async (req, res) => {
  try {
    const { sessionToken } = req.body;
    
    if (sessionToken && sessions.has(sessionToken)) {
      const user = sessions.get(sessionToken);
      if (user) {
        user.isLoggedIn = false;
        user.sessionToken = null;
        users.set(user.telegramId, user);
      }
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

// Очистка старых сессий (каждые 24 часа)
setInterval(() => {
  const now = new Date();
  const SESSION_TIMEOUT = 7 * 24 * 60 * 60 * 1000; // 7 дней
  let deleted = 0;
  
  sessions.forEach((user, sessionToken) => {
    if (now - user.lastActivity > SESSION_TIMEOUT) {
      sessions.delete(sessionToken);
      deleted++;
    }
  });
  
  if (deleted > 0) {
    console.log(`🧹 Cleaned ${deleted} old sessions`);
  }
}, 24 * 60 * 60 * 1000);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Route not found',
    requestedUrl: req.originalUrl
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌍 CORS enabled for: https://flowers-telegram-kyrgyzstan.up.railway.app`);
  console.log(`🤖 Bot: ${botInitialized ? '✅ Active' : '❌ Inactive'}`);
  console.log(`🔑 Google OAuth: ${googleClient ? '✅ Initialized' : '❌ Not configured'}`);
  console.log(`\n=== INSTRUCTIONS ===`);
  console.log(`1. User sends /start to @Flowers_free_bot`);
  console.log(`2. Bot sends WebApp link with Telegram ID`);
  console.log(`3. User clicks "Войти через Google" button`);
  console.log(`4. User authorizes and gets session`);
  console.log(`5. User creates ads without re-auth`);
});

process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  if (bot) bot.stopPolling();
  process.exit(0);
});