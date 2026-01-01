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
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const channelId = process.env.CHANNEL_ID;
const adminChatId = process.env.ADMIN_CHAT_ID || '-1003293921379'; // Ваш ID чата админа

// Инициализация Google OAuth
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Хранение пользователей (в реальном проекте используйте базу данных)
const users = new Map();

// Обработчик команды /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const options = {
    reply_markup: {
      inline_keyboard: [[
        {
          text: '🌺 Создать объявление',
          web_app: { url: process.env.FRONTEND_URL }
        }
      ]]
    }
  };
  
  bot.sendMessage(chatId, 'Добро пожаловать в Flower Market! 🌸\n\nНажмите кнопку ниже, чтобы создать объявление о продаже цветов.', options);
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
      contacts: [] // Здесь будут контакты из Google
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
      error: 'Invalid token or authentication failed' 
    });
  }
});

// Функция отправки пользователя админу
async function sendUserToAdmin(user) {
  try {
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

// Обработка callback кнопок от админа
bot.on('callback_query', async (callbackQuery) => {
  const message = callbackQuery.message;
  const data = callbackQuery.data;
  const userId = data.split('_').pop();
  
  try {
    if (data.startsWith('approve_user_')) {
      // Добавляем пользователя в канал (отправляем приглашение)
      const user = users.get(userId);
      if (user) {
        // Отправляем пригласительную ссылку
        const inviteLink = await bot.createChatInviteLink(channelId, {
          member_limit: 1,
          expire_date: Math.floor(Date.now() / 1000) + 86400 // 24 часа
        });

        // Отправляем пользователю приглашение
        await bot.sendMessage(userId, 
          `🎉 Ваша заявка одобрена!\n\n` +
          `Вы добавлены в канал Flower Market.\n` +
          `Ссылка для входа: ${inviteLink.invite_link}\n\n` +
          `Теперь вы можете создавать объявления.`
        );

        // Обновляем статус пользователя
        user.isApproved = true;
        users.set(userId, user);

        // Уведомляем админа
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
      
      // Уведомляем пользователя
      await bot.sendMessage(userId, 
        '❌ Ваша заявка на добавление в канал была отклонена.'
      );

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
        error: 'User not approved for posting'
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

    // Отправляем в канал
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

    // Если есть изображения (в будущем можно реализовать загрузку)
    if (images && images.length > 0) {
      // Здесь можно реализовать отправку изображений
      // Для простоты пока отправляем только текст
    }

    // Сохраняем информацию об объявлении
    const ad = {
      id: Date.now(),
      userId,
      title,
      description,
      price,
      contactInfo,
      telegramMessageId: sentMessage.message_id,
      publishedAt: new Date(),
      status: 'published'
    };

    user.ads = user.ads || [];
    user.ads.push(ad);
    users.set(userId, user);

    // Отправляем уведомление пользователю
    await bot.sendMessage(userId, 
      `✅ Ваше объявление опубликовано!\n\n` +
      `Заголовок: ${title}\n` +
      `Цена: ${price}\n\n` +
      `Посмотреть объявление: https://t.me/c/${channelId.toString().slice(4)}/${sentMessage.message_id}`
    );

    res.json({
      success: true,
      message: 'Объявление успешно опубликовано',
      adId: ad.id,
      telegramMessageId: sentMessage.message_id
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

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date(),
    usersCount: users.size,
    botUsername: process.env.BOT_USERNAME 
  });
});

// Обработка ошибок
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something broke!' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌺 Bot: ${process.env.BOT_USERNAME}`);
  console.log(`📺 Channel: ${process.env.CHANNEL_ID}`);
  console.log(`🌍 Frontend: ${process.env.FRONTEND_URL}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down...');
  bot.stopPolling();
  process.exit(0);
});