const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { OAuth2Client } = require('google-auth-library');
const TelegramBot = require('node-telegram-bot-api');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
require('dotenv').config();

const app = express();

// Middleware
app.use(cors({
  origin: [process.env.FRONTEND_URL, process.env.WEBAPP_URL],
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Инициализация Telegram бота
let bot;
try {
  if (process.env.BOT_TOKEN) {
    bot = new TelegramBot(process.env.BOT_TOKEN, { 
      polling: true,
      request: {
        agentOptions: {
          keepAlive: true,
          family: 4
        }
      }
    });
    console.log('✅ Telegram Bot initialized');
  } else {
    console.warn('⚠️ BOT_TOKEN not found in environment variables');
  }
} catch (error) {
  console.error('❌ Failed to initialize Telegram bot:', error.message);
}

const channelId = process.env.CHANNEL_ID;
const adminChatId = process.env.ADMIN_CHAT_ID || '-1003293921379';

// Инициализация Google OAuth
let googleClient;
try {
  if (process.env.GOOGLE_CLIENT_ID) {
    googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    console.log('✅ Google OAuth initialized');
  } else {
    console.warn('⚠️ GOOGLE_CLIENT_ID not found');
  }
} catch (error) {
  console.error('❌ Failed to initialize Google OAuth:', error.message);
}

// Хранение пользователей
const users = new Map();

// Настройка бота (если он инициализирован)
if (bot) {
  // Обработчик команды /start
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
    
    bot.sendMessage(chatId, 'Добро пожаловать в Flower Market! 🌸\n\nНажмите кнопку ниже, чтобы создать объявление о продаже цветов.', options)
      .catch(err => console.error('Error sending start message:', err.message));
  });

  // Обработка callback кнопок от админа
  bot.on('callback_query', async (callbackQuery) => {
    const message = callbackQuery.message;
    const data = callbackQuery.data;
    const userId = data.split('_').pop();
    
    try {
      if (data.startsWith('approve_user_')) {
        const user = users.get(userId);
        if (user) {
          if (channelId) {
            const inviteLink = await bot.createChatInviteLink(channelId, {
              member_limit: 1,
              expire_date: Math.floor(Date.now() / 1000) + 86400
            });

            await bot.sendMessage(userId, 
              `🎉 Ваша заявка одобрена!\n\n` +
              `Вы добавлены в канал Flower Market.\n` +
              `Ссылка для входа: ${inviteLink.invite_link}\n\n` +
              `Теперь вы можете создавать объявления.`
            ).catch(err => console.log('Could not send invite to user:', err.message));

            user.isApproved = true;
            users.set(userId, user);
          }

          await bot.answerCallbackQuery(callbackQuery.id, {
            text: 'Пользователь добавлен в канал'
          });

          await bot.editMessageText(
            `✅ Пользователь ${user.name} добавлен в канал\n` +
            `📧 ${user.email}\n` +
            `⏰ ${new Date().toLocaleString()}`,
            {
              chat_id: message.chat.id,
              message_id: message.message_id
            }
          );
        }
      } else if (data.startsWith('reject_user_')) {
        const user = users.get(userId);
        
        await bot.sendMessage(userId, 
          '❌ Ваша заявка на добавление в канал была отклонена.'
        ).catch(err => console.log('Could not send rejection to user:', err.message));

        await bot.answerCallbackQuery(callbackQuery.id, {
          text: 'Заявка отклонена'
        });

        await bot.editMessageText(
          `❌ Заявка от ${user?.name || 'пользователя'} отклонена`,
          {
            chat_id: message.chat.id,
            message_id: message.message_id
          }
        );
      }
    } catch (error) {
      console.error('Error processing callback:', error);
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: 'Произошла ошибка'
      }).catch(() => {});
    }
  });
}

// Функция отправки пользователя админу
async function sendUserToAdmin(user) {
  try {
    if (!bot || !adminChatId) return;

    const message = `📋 Новая заявка на добавление в канал:\n\n` +
                   `👤 Имя: ${user.name}\n` +
                   `📧 Email: ${user.email}\n` +
                   `🆔 ID: ${user.id}\n` +
                   `⏰ Время: ${new Date().toLocaleString()}`;

    const options = {
      reply_markup: {
        inline_keyboard: [[
          {
            text: '✅ Добавить в канал',
            callback_data: `approve_user_${user.id}`
          },
          {
            text: '❌ Отклонить',
            callback_data: `reject_user_${user.id}`
          }
        ]]
      }
    };

    await bot.sendMessage(adminChatId, message, options);
  } catch (error) {
    console.error('Error sending user to admin:', error);
  }
}

// ==================== ROUTES ====================

// Корневой маршрут (ВАЖНО - должен быть первым!)
app.get('/', (req, res) => {
  res.json({
    status: 'Flower Market Backend API',
    message: 'API is running',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/health',
      userStatus: '/api/user/:userId/status',
      googleAuth: '/api/auth/google (POST)',
      publishAd: '/api/publish-ad (POST)',
      getUser: '/api/user/:userId',
      approvalStatus: '/api/user/:userId/approval-status'
    }
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date(),
    usersCount: users.size,
    botInitialized: !!bot,
    googleOAuthInitialized: !!googleClient,
    environment: process.env.NODE_ENV || 'development'
  });
});

// Endpoint: Проверка статуса пользователя
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

// Endpoint: Авторизация через Google
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
      contacts: []
    };

    // Сохраняем пользователя
    users.set(user.id, user);

    // Отправляем контакты админу в Telegram
    await sendUserToAdmin(user);

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
      error: 'Invalid token or authentication failed',
      details: error.message 
    });
  }
});

// Endpoint: Публикация объявления
app.post('/api/publish-ad', async (req, res) => {
  try {
    const { userId, title, description, price, contactInfo, images } = req.body;
    
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
                   `📝 *Описание:*\n${description}\n\n` +
                   `💰 *Цена:* ${price}\n` +
                   `📞 *Контакты:* ${contactInfo}\n\n` +
                   `👤 *Продавец:* ${user.name}\n` +
                   `🕒 *Дата:* ${new Date().toLocaleString()}\n\n` +
                   `#цветы #${user.name.replace(/\s+/g, '_')}`;

    let telegramMessageId = null;
    
    // Отправляем в канал
    if (bot && channelId) {
      try {
        const sentMessage = await bot.sendMessage(channelId, message, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              {
                text: '💬 Написать продавцу',
                url: `https://t.me/${userId}`
              }
            ]]
          }
        });
        telegramMessageId = sentMessage.message_id;
      } catch (telegramError) {
        console.error('Telegram send error:', telegramError.message);
        // Не прерываем процесс, даже если Telegram ошибся
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

    // Отправляем уведомление пользователю
    if (bot) {
      try {
        await bot.sendMessage(userId, 
          `✅ Ваше объявление опубликовано!\n\n` +
          `Заголовок: ${title}\n` +
          `Цена: ${price}\n\n` +
          (telegramMessageId ? 
            `Посмотреть объявление: https://t.me/c/${channelId.toString().slice(4)}/${telegramMessageId}` : 
            '')
        );
      } catch (userNotifyError) {
        console.log('Could not notify user:', userNotifyError.message);
      }
    }

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
      error: 'Failed to publish ad',
      details: error.message 
    });
  }
});

// Endpoint: Получение информации о пользователе
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

// Endpoint: Проверка статуса одобрения
app.get('/api/user/:userId/approval-status', (req, res) => {
  const userId = req.params.userId;
  const user = users.get(userId);
  
  res.json({
    isApproved: user ? (user.isApproved || false) : false
  });
});

// 404 handler - должен быть последним
app.use((req, res) => {
  res.status(404).json({
    error: 'Route not found',
    requestedUrl: req.originalUrl,
    availableEndpoints: [
      'GET /',
      'GET /health',
      'GET /api/user/:userId/status',
      'POST /api/auth/google',
      'POST /api/publish-ad',
      'GET /api/user/:userId',
      'GET /api/user/:userId/approval-status'
    ]
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌺 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🌍 Frontend URL: ${process.env.FRONTEND_URL}`);
  console.log(`🤖 Bot initialized: ${!!bot}`);
  console.log(`🔐 Google OAuth: ${!!googleClient}`);
  console.log(`📺 Channel ID: ${channelId || 'Not set'}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  if (bot) {
    bot.stopPolling();
  }
  process.exit(0);
});ы