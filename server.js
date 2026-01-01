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
console.log('- GOOGLE_CLIENT_ID:', process.env.GOOGLE_CLIENT_ID ? `✓ Set (${process.env.GOOGLE_CLIENT_ID.substring(0, 10)}...)` : '✗ Missing');
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

// Хранение пользователей (в реальном приложении нужно использовать БД)
const users = new Map();
const userSessions = new Map(); // Хранилище сессий по telegramId

// Генерация сессионного токена
function generateSessionToken(telegramId) {
  return crypto.randomBytes(32).toString('hex') + '_' + telegramId;
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
    bot.onText(/\/start/, (msg) => {
      const chatId = msg.chat.id;
      const telegramId = msg.from.id.toString();
      const firstName = msg.from.first_name || 'Пользователь';
      const username = msg.from.username ? `@${msg.from.username}` : 'без username';
      const languageCode = msg.from.language_code || 'ru';
      
      console.log(`👤 User /start: ${firstName} (ID: ${telegramId})`);
      
      // Создаем или обновляем пользователя
      let user = users.get(telegramId);
      if (!user) {
        user = {
          id: telegramId,
          telegramId: telegramId,
          telegramInfo: {
            firstName: msg.from.first_name,
            lastName: msg.from.last_name,
            username: msg.from.username,
            languageCode: languageCode,
            isBot: msg.from.is_bot || false
          },
          googleInfo: null,
          isLoggedIn: false,
          createdAt: new Date(),
          isApproved: true, // Автоматически одобряем
          ads: [],
          sessionToken: generateSessionToken(telegramId),
          lastActivity: new Date()
        };
        users.set(telegramId, user);
        console.log(`✅ New Telegram user created: ${firstName} (${telegramId})`);
      }
      
      // Обновляем сессионный токен
      user.sessionToken = generateSessionToken(telegramId);
      user.lastActivity = new Date();
      
      // Сохраняем сессию
      userSessions.set(user.sessionToken, user);
      
      // Отправляем сообщение с кнопкой
      const webAppUrl = process.env.FRONTEND_URL || 'https://flowers-telegram-kyrgyzstan.up.railway.app';
      const webAppWithToken = `${webAppUrl}?session=${user.sessionToken}&tg_id=${telegramId}`;
      
      const options = {
        reply_markup: {
          inline_keyboard: [[
            {
              text: '🌺 Создать объявление',
              web_app: { url: webAppWithToken }
            }
          ]]
        }
      };
      
      bot.sendMessage(chatId, 
        `Добро пожаловать в Flower Market, ${firstName}! 🌸\n\n` +
        `*Ваш Telegram ID:* \`${telegramId}\`\n` +
        `*Username:* ${username}\n\n` +
        `Нажмите кнопку ниже, чтобы создать объявление.`, 
        { parse_mode: 'Markdown', ...options }
      ).catch(err => console.error('Error sending start message:', err.message));
    });

    // Команда /id
    bot.onText(/\/id/, (msg) => {
      const chatId = msg.chat.id;
      const telegramId = msg.from.id;
      
      bot.sendMessage(chatId,
        `*Ваш Telegram ID:* \`${telegramId}\`\n\n` +
        `Сохраните этот ID. Он понадобится для авторизации в веб-приложении.`,
        { parse_mode: 'Markdown' }
      );
    });

    // Команда /me - информация о профиле
    bot.onText(/\/me/, (msg) => {
      const chatId = msg.chat.id;
      const telegramId = msg.from.id.toString();
      const user = users.get(telegramId);
      
      if (user && user.googleInfo) {
        let message = `*Ваш профиль:*\n\n`;
        message += `👤 *Имя:* ${user.googleInfo.name}\n`;
        message += `📧 *Email:* ${user.googleInfo.email}\n`;
        message += `📱 *Telegram ID:* ${user.telegramId}\n`;
        message += `✅ *Статус:* ${user.isApproved ? 'Одобрен ✅' : 'Ожидает ⏳'}\n`;
        message += `📊 *Объявлений:* ${user.ads.length}\n`;
        message += `🔑 *Сессия:* ${user.isLoggedIn ? 'Активна' : 'Не активна'}\n\n`;
        
        if (user.contacts && user.contacts.length > 0) {
          message += `*Контакты:*\n`;
          user.contacts.forEach((contact, index) => {
            message += `${index + 1}. ${contact.type}: ${contact.value}\n`;
          });
        }
        
        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      } else {
        bot.sendMessage(chatId, 
          `Вы еще не авторизовались через Google. Используйте /start для начала.`,
          { parse_mode: 'Markdown' }
        );
      }
    });

    // Обработчик ошибок polling
    bot.on('polling_error', (error) => {
      console.error('❌ Polling error:', error.message);
    });

    // Успешная инициализация
    bot.getMe().then(botInfo => {
      console.log(`✅ Telegram Bot started: @${botInfo.username}`);
      botInitialized = true;
      
      bot.setMyCommands([
        { command: 'start', description: 'Запустить бота' },
        { command: 'id', description: 'Показать мой ID' },
        { command: 'me', description: 'Мой профиль' }
      ]);
      
    }).catch(error => {
      console.error('❌ Failed to get bot info:', error.message);
    });

  } catch (error) {
    console.error('❌ Failed to initialize Telegram bot:', error.message);
  }
}

initializeTelegramBot();

// ==================== ROUTES ====================

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    usersCount: users.size,
    sessionsCount: userSessions.size,
    botInitialized: botInitialized,
    googleOAuthInitialized: !!googleClient,
    environment: process.env.NODE_ENV || 'development'
  });
});

// Проверка сессии
app.get('/api/session/:sessionToken', (req, res) => {
  try {
    const sessionToken = req.params.sessionToken;
    const user = userSessions.get(sessionToken);
    
    if (user && user.isLoggedIn) {
      // Обновляем время последней активности
      user.lastActivity = new Date();
      userSessions.set(sessionToken, user);
      
      res.json({
        success: true,
        user: {
          id: user.id,
          telegramId: user.telegramId,
          name: user.googleInfo?.name || user.telegramInfo.firstName,
          email: user.googleInfo?.email,
          picture: user.googleInfo?.picture,
          isApproved: user.isApproved,
          contacts: user.contacts || [],
          telegramInfo: user.telegramInfo
        },
        sessionToken: sessionToken
      });
    } else {
      res.json({ success: false, error: 'Session not found or expired' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Получение информации о пользователе по telegramId
app.get('/api/user/telegram/:telegramId', (req, res) => {
  try {
    const telegramId = req.params.telegramId;
    const user = users.get(telegramId);
    
    if (user) {
      res.json({
        success: true,
        user: {
          id: user.id,
          telegramId: user.telegramId,
          name: user.googleInfo?.name || user.telegramInfo.firstName,
          email: user.googleInfo?.email,
          isApproved: user.isApproved,
          isLoggedIn: user.isLoggedIn,
          contacts: user.contacts || [],
          telegramInfo: user.telegramInfo,
          adsCount: user.ads.length
        }
      });
    } else {
      res.json({ success: false, error: 'User not found' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Авторизация через Google с получением контактов
app.post('/api/auth/google', async (req, res) => {
  console.log('🔐 Google auth with contacts');
  
  try {
    const { token, telegramUserId, sessionToken, userContacts } = req.body;
    
    if (!token) {
      return res.status(400).json({ 
        success: false, 
        error: 'No Google token provided' 
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
    });

    const payload = ticket.getPayload();
    console.log('✅ Google token verified for:', payload.email);
    
    // Поиск пользователя по telegramId или sessionToken
    let user;
    
    if (telegramUserId) {
      user = users.get(telegramUserId);
    } else if (sessionToken) {
      user = userSessions.get(sessionToken);
    }
    
    // Если пользователь не найден, создаем нового
    if (!user) {
      const newTelegramId = telegramUserId || `tg_${Date.now()}`;
      user = {
        id: newTelegramId,
        telegramId: newTelegramId,
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
        sessionToken: generateSessionToken(newTelegramId),
        lastActivity: new Date()
      };
      users.set(newTelegramId, user);
    }
    
    // Сохраняем Google информацию
    user.googleInfo = {
      googleId: payload.sub,
      name: payload.name,
      email: payload.email,
      picture: payload.picture,
      emailVerified: payload.email_verified,
      locale: payload.locale
    };
    
    // Сохраняем контакты пользователя если есть
    if (userContacts && Array.isArray(userContacts)) {
      user.contacts = userContacts.filter(contact => 
        contact.value && contact.value.trim() !== ''
      );
      console.log(`📱 Saved ${user.contacts.length} contacts for user`);
    }
    
    user.isLoggedIn = true;
    user.lastActivity = new Date();
    
    // Обновляем сессионный токен
    const newSessionToken = generateSessionToken(user.telegramId);
    user.sessionToken = newSessionToken;
    userSessions.set(newSessionToken, user);
    
    // Сохраняем пользователя
    users.set(user.telegramId, user);
    
    console.log(`✅ User authenticated: ${user.googleInfo.name} (${user.googleInfo.email})`);
    
    // Отправляем уведомление админу с полной информацией
    if (botInitialized && adminChatId) {
      try {
        let adminMessage = `📋 *Новый пользователь авторизовался*\n\n`;
        adminMessage += `👤 *Имя:* ${user.googleInfo.name}\n`;
        adminMessage += `📧 *Email:* ${user.googleInfo.email}\n`;
        adminMessage += `📱 *Telegram ID:* ${user.telegramId}\n`;
        
        if (user.telegramInfo.username) {
          adminMessage += `👤 *Telegram username:* @${user.telegramInfo.username}\n`;
        }
        
        if (user.contacts && user.contacts.length > 0) {
          adminMessage += `\n*Контакты пользователя:*\n`;
          user.contacts.forEach((contact, index) => {
            adminMessage += `${index + 1}. ${contact.type}: ${contact.value}\n`;
          });
        }
        
        adminMessage += `\n✅ *Статус:* Автоматически одобрен\n`;
        adminMessage += `⏰ *Время:* ${new Date().toLocaleString('ru-RU')}\n`;
        adminMessage += `🔗 *Сессия:* ${newSessionToken.substring(0, 10)}...`;
        
        await bot.sendMessage(adminChatId, adminMessage, { parse_mode: 'Markdown' });
        console.log(`📤 Admin notification sent`);
      } catch (botError) {
        console.error('Admin notification failed:', botError.message);
      }
    }
    
    // Отправляем приветственное сообщение пользователю
    if (botInitialized && user.telegramId) {
      try {
        const welcomeMessage = `👋 *Добро пожаловать, ${user.googleInfo.name}!*\n\n` +
          `✅ Вы успешно авторизовались через Google.\n` +
          `📧 Email: ${user.googleInfo.email}\n` +
          `✅ Статус: Автоматически одобрен\n\n` +
          `Теперь вы можете создавать объявления о продаже цветов!\n\n` +
          `*Ваши контакты сохранены:*\n`;
        
        let contactsMessage = '';
        if (user.contacts && user.contacts.length > 0) {
          user.contacts.forEach((contact, index) => {
            contactsMessage += `${index + 1}. ${contact.type}: ${contact.value}\n`;
          });
        } else {
          contactsMessage += 'Вы не добавили контакты\n';
        }
        
        await bot.sendMessage(user.telegramId, welcomeMessage + contactsMessage, { 
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              {
                text: '🌺 Создать объявление',
                web_app: { url: `${process.env.FRONTEND_URL}?session=${newSessionToken}` }
              }
            ]]
          }
        });
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
        isApproved: user.isApproved,
        contacts: user.contacts || [],
        telegramInfo: user.telegramInfo
      },
      sessionToken: newSessionToken
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

// Сохранение черновика объявления
app.post('/api/draft/save', async (req, res) => {
  try {
    const { sessionToken, draftData } = req.body;
    
    if (!sessionToken) {
      return res.status(400).json({ success: false, error: 'Session token required' });
    }
    
    const user = userSessions.get(sessionToken);
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
    userSessions.set(sessionToken, user);
    
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
    const user = userSessions.get(sessionToken);
    
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
    
    const user = userSessions.get(sessionToken);
    if (!user || !user.isLoggedIn) {
      return res.status(401).json({ success: false, error: 'User not authenticated' });
    }
    
    console.log(`📝 New ad from ${user.telegramId}:`, { title, price });
    
    // Формируем сообщение для Telegram
    const telegramMessage = `🌸 *${title}* 🌸\n\n` +
                   `📝 *Описание:*\n${description}\n\n` +
                   `💰 *Цена:* ${price}\n` +
                   `📞 *Контакты:* ${contactInfo}\n\n` +
                   `👤 *Продавец:* ${user.googleInfo?.name || user.telegramInfo.firstName}\n`;
    
    // Добавляем контакты пользователя если есть
    if (user.contacts && user.contacts.length > 0) {
      telegramMessage += `\n*Другие контакты продавца:*\n`;
      user.contacts.forEach((contact, index) => {
        telegramMessage += `${contact.type}: ${contact.value}\n`;
      });
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
          console.log(`✅ Ad published, message ID: ${telegramMessageId}`);
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
    userSessions.set(sessionToken, user);
    
    // Отправляем уведомление пользователю
    if (botInitialized && user.telegramId) {
      try {
        let userMessage;
        
        if (telegramMessageId) {
          userMessage = `✅ *Ваше объявление опубликовано!*\n\n` +
            `*Заголовок:* ${title}\n` +
            `*Цена:* ${price}\n\n` +
            `📢 *Ссылка на объявление:*\n` +
            `https://t.me/c/${channelId.toString().replace('-100', '')}/${telegramMessageId}`;
        } else {
          userMessage = `⚠️ *Объявление не опубликовано*\n\n` +
            `*Заголовок:* ${title}\n` +
            `*Цена:* ${price}\n\n` +
            `*Причина:* ${error || 'Ошибка при отправке'}\n` +
            `*Не волнуйтесь, данные сохранены и будут опубликованы позже!*`;
        }
        
        await bot.sendMessage(user.telegramId, userMessage, { 
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              {
                text: '🌺 Создать еще',
                web_app: { url: `${process.env.FRONTEND_URL}?session=${sessionToken}` }
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
    
    // Отправляем уведомление админу о новом объявлении
    if (botInitialized && adminChatId) {
      try {
        const adminMessage = `📢 *Новое объявление опубликовано*\n\n` +
          `*Заголовок:* ${title}\n` +
          `*Цена:* ${price}\n` +
          `*Продавец:* ${user.googleInfo?.name || user.telegramInfo.firstName}\n` +
          `*Telegram ID:* ${user.telegramId}\n` +
          `*Статус:* ${telegramMessageId ? 'Опубликовано ✅' : 'Ошибка ❌'}\n` +
          `*Время:* ${new Date().toLocaleString('ru-RU')}`;
        
        await bot.sendMessage(adminChatId, adminMessage, { parse_mode: 'Markdown' });
      } catch (adminError) {
        console.error('Admin ad notification failed:', adminError.message);
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

// Получение истории объявлений пользователя
app.get('/api/ads/:sessionToken', async (req, res) => {
  try {
    const sessionToken = req.params.sessionToken;
    const user = userSessions.get(sessionToken);
    
    if (!user || !user.isLoggedIn) {
      return res.status(401).json({ success: false, error: 'User not authenticated' });
    }
    
    res.json({
      success: true,
      ads: user.ads || [],
      count: user.ads ? user.ads.length : 0
    });
    
  } catch (error) {
    console.error('Error getting ads:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Удаление сессии (выход)
app.post('/api/session/logout', async (req, res) => {
  try {
    const { sessionToken } = req.body;
    
    if (sessionToken && userSessions.has(sessionToken)) {
      const user = userSessions.get(sessionToken);
      if (user) {
        user.isLoggedIn = false;
        users.set(user.telegramId, user);
      }
      userSessions.delete(sessionToken);
      console.log(`👋 Session terminated: ${sessionToken.substring(0, 10)}...`);
    }
    
    res.json({ success: true, message: 'Logged out successfully' });
    
  } catch (error) {
    console.error('Error logging out:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Очистка устаревших сессий (вызывается периодически)
function cleanupOldSessions() {
  const now = new Date();
  const SESSION_TIMEOUT = 7 * 24 * 60 * 60 * 1000; // 7 дней
  
  let deletedCount = 0;
  
  userSessions.forEach((user, sessionToken) => {
    if (now - user.lastActivity > SESSION_TIMEOUT) {
      userSessions.delete(sessionToken);
      deletedCount++;
    }
  });
  
  if (deletedCount > 0) {
    console.log(`🧹 Cleaned up ${deletedCount} old sessions`);
  }
}

// Запускаем очистку каждые 24 часа
setInterval(cleanupOldSessions, 24 * 60 * 60 * 1000);

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
  console.log(`🌍 CORS enabled for: https://flowers-telegram-kyrgyzstan.up.railway.app`);
  console.log(`🤖 Bot initialized: ${botInitialized ? '✅ Yes' : '❌ No'}`);
  console.log(`🔑 Google OAuth: ${googleClient ? '✅ Initialized' : '❌ Not initialized'}`);
  console.log(`📊 Users in memory: ${users.size}`);
  console.log(`\n=== HOW TO USE ===`);
  console.log(`1. User sends /start to bot`);
  console.log(`2. Bot sends WebApp URL with session token`);
  console.log(`3. User authorizes via Google in WebApp`);
  console.log(`4. Contacts are sent to admin`);
  console.log(`5. User creates ads without re-auth`);
});

process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down gracefully...');
  if (bot) bot.stopPolling();
  process.exit(0);
});