const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

// Импортируем server.js для интеграции
const serverModule = require('./server.js');

// Получаем бота из server.js
const { setTelegramBot, users, channelId, adminChatId } = serverModule;

// Создаем бота с polling
const bot = new TelegramBot(process.env.BOT_TOKEN, { 
  polling: {
    interval: 3000,
    timeout: 10,
    autoStart: true,
    params: {
      timeout: 10
    }
  }
});

// Устанавливаем бота в server.js
setTelegramBot(bot);

// Обработчик команды /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const firstName = msg.from.first_name || 'Пользователь';
  const username = msg.from.username ? `@${msg.from.username}` : 'без username';
  
  console.log(`👤 User /start: ${firstName} (${username}, ID: ${userId})`);
  
  // Сохраняем пользователя если его еще нет
  if (!users.has(userId)) {
    const user = {
      id: userId,
      telegramId: userId,
      name: firstName,
      username: username,
      isLoggedIn: false,
      createdAt: new Date(),
      isApproved: true,
      ads: []
    };
    
    users.set(userId, user);
    console.log(`✅ Telegram user saved: ${firstName} (${userId})`);
  }
  
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
  
  bot.sendMessage(chatId, 
    `Добро пожаловать в Flower Market, ${firstName}! 🌸\n\n` +
    `Нажмите кнопку ниже, чтобы создать объявление о продаже цветов.\n\n` +
    `*Ваш ID:* ${userId}\n` +
    `*Username:* ${username}\n\n` +
    `Сохраните ваш ID, он понадобится для авторизации.`, 
    { parse_mode: 'Markdown', ...options }
  ).catch(err => console.error('Error sending start message:', err.message));
});

// Обработчик команды /id
bot.onText(/\/id/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username ? `@${msg.from.username}` : 'не указан';
  
  bot.sendMessage(chatId,
    `*Ваш Telegram ID:* \`${userId}\`\n` +
    `*Username:* ${username}\n\n` +
    `Сохраните этот ID. Он понадобится для авторизации в веб-приложении.\n\n` +
    `*Как использовать:*\n` +
    `1. Откройте веб-приложение по кнопке ниже\n` +
    `2. Войдите через Google\n` +
    `3. Введите этот ID когда спросят`,
    { 
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          {
            text: '🌺 Открыть веб-приложение',
            web_app: { url: process.env.FRONTEND_URL || 'https://flowers-telegram-kyrgyzstan.up.railway.app' }
          }
        ]]
      }
    }
  );
});

// Обработчик команды /help
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  
  bot.sendMessage(chatId,
    `*Flower Market Bot Help* 🌸\n\n` +
    `*/start* - Запустить бота и получить кнопку для создания объявления\n` +
    `*/id* - Показать ваш Telegram ID (нужен для авторизации)\n` +
    `*/help* - Показать это сообщение\n\n` +
    `*Как создать объявление:*\n` +
    `1. Нажмите /start и кнопку "Создать объявление"\n` +
    `2. Войдите через Google в веб-приложении\n` +
    `3. Введите ваш Telegram ID (команда /id)\n` +
    `4. Заполните форму объявления\n` +
    `5. Ваше объявление будет опубликовано в канале\n\n` +
    `*Канал с объявлениями:* @flowers_market_kg\n` +
    `*Проблемы?* Напишите админу.`,
    { 
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          {
            text: '🌺 Создать объявление',
            web_app: { url: process.env.FRONTEND_URL || 'https://flowers-telegram-kyrgyzstan.up.railway.app' }
          },
          {
            text: '📢 Наш канал',
            url: 'https://t.me/flowers_market_kg'
          }
        ]]
      }
    }
  );
});

// Обработчик текстовых сообщений
bot.on('message', (msg) => {
  if (msg.text && !msg.text.startsWith('/')) {
    console.log(`📨 Message from ${msg.from.id}: ${msg.text.substring(0, 50)}...`);
  }
});

// Обработчик ошибок polling
bot.on('polling_error', (error) => {
  console.error('❌ Polling error:', error.code, error.message);
});

// Уведомление о запуске
bot.getMe().then(botInfo => {
  console.log(`✅ Telegram Bot started: @${botInfo.username}`);
  console.log(`🤖 Bot ID: ${botInfo.id}`);
  console.log(`👋 Bot name: ${botInfo.first_name}`);
  
  // Настраиваем команды бота
  bot.setMyCommands([
    { command: 'start', description: 'Запустить бота' },
    { command: 'id', description: 'Показать мой ID' },
    { command: 'help', description: 'Помощь' }
  ]).then(() => {
    console.log('✅ Bot commands configured');
  }).catch(err => {
    console.error('Error setting bot commands:', err.message);
  });
  
}).catch(error => {
  console.error('❌ Failed to get bot info:', error.message);
});

console.log('🤖 Bot polling started...');
console.log('📱 Bot will handle /start commands');
console.log('🔗 Web app URL:', process.env.FRONTEND_URL || 'https://flowers-telegram-kyrgyzstan.up.railway.app');

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Stopping bot polling...');
  bot.stopPolling();
  console.log('✅ Bot stopped');
  process.exit(0);
});