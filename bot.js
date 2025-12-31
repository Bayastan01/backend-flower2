const { Telegraf, Markup } = require('telegraf');
const { googleUsers } = require('./google-auth');

require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);

// Команда /start - ТОЛЬКО КНОПКА В МАГАЗИН
bot.start(async (ctx) => {
  const userId = ctx.from.id.toString();
  
  // Создаем URL для веб-приложения с параметрами пользователя
  const webappUrl = `${process.env.WEBAPP_URL}?tg_user_id=${userId}&tg_username=${ctx.from.username || ''}&tg_first_name=${ctx.from.first_name || ''}`;
  
  // Только одна кнопка - в магазин
  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.webApp(
        '🌸 Открыть магазин цветов',
        webappUrl
      )
    ]
  ]);

  const welcomeMessage = `🌸 <b>Добро пожаловать в магазин цветов!</b>\n\n` +
    `Нажмите кнопку ниже, чтобы открыть магазин и создать объявление.`;
  
  await ctx.replyWithHTML(welcomeMessage, keyboard);
});

// Команда /help
bot.help((ctx) => {
  ctx.replyWithHTML(
    `<b>ℹ️ Помощь</b>\n\n` +
    `Просто нажмите кнопку "🌸 Открыть магазин цветов", чтобы:\n` +
    `• Создать объявление о продаже цветов\n` +
    `• Посмотреть каталог\n` +
    `• Связаться с администратором\n\n` +
    `<b>Наш канал:</b> @${process.env.CHANNEL_USERNAME.replace('@', '')}`
  );
});

// Команда /channel - ссылка на канал
bot.command('channel', (ctx) => {
  ctx.reply(
    '📢 Наш канал с цветами',
    Markup.inlineKeyboard([
      [Markup.button.url('🌸 Перейти в канал', `https://t.me/${process.env.CHANNEL_USERNAME.replace('@', '')}`)]
    ])
  );
});

// Обработка ошибок
bot.catch((err, ctx) => {
  console.error(`Error for ${ctx.updateType}:`, err);
});

// Экспорт бота
module.exports = bot;