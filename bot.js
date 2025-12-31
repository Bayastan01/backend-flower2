const { Telegraf, Markup } = require('telegraf');
const config = require('./config');

// Создаем бота с токеном из конфига
const bot = new Telegraf(config.botToken);

// Обработка ошибок бота
bot.catch((err, ctx) => {
  console.error(`Bot error for ${ctx.updateType}:`, err.message);
});

// Команда /start - ТОЛЬКО КНОПКА В МАГАЗИН
bot.start(async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    const username = ctx.from.username || '';
    const firstName = ctx.from.first_name || '';
    
    // Создаем URL для веб-приложения с параметрами пользователя
    const webappUrl = `${config.webappUrl}?tg_user_id=${userId}&tg_username=${encodeURIComponent(username)}&tg_first_name=${encodeURIComponent(firstName)}`;
    
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
      `Нажмите кнопку ниже, чтобы открыть магазин и создать объявление.\n\n` +
      `📢 Наш канал: ${config.channelUsername}`;
    
    await ctx.replyWithHTML(welcomeMessage, keyboard);
  } catch (error) {
    console.error('Error in start command:', error.message);
    await ctx.reply('Произошла ошибка. Пожалуйста, попробуйте позже.');
  }
});

// Команда /help
bot.help(async (ctx) => {
  try {
    await ctx.replyWithHTML(
      `<b>ℹ️ Помощь</b>\n\n` +
      `Просто нажмите кнопку "🌸 Открыть магазин цветов", чтобы:\n` +
      `• Создать объявление о продаже цветов\n` +
      `• Посмотреть каталог\n` +
      `• Связаться с администратором\n\n` +
      `<b>Наш канал:</b> ${config.channelUsername}`
    );
  } catch (error) {
    console.error('Error in help command:', error.message);
  }
});

// Команда /channel - ссылка на канал
bot.command('channel', async (ctx) => {
  try {
    const cleanUsername = config.channelUsername.replace('@', '');
    
    await ctx.reply(
      '📢 Наш канал с цветами',
      Markup.inlineKeyboard([
        [Markup.button.url('🌸 Перейти в канал', `https://t.me/${cleanUsername}`)]
      ])
    );
  } catch (error) {
    console.error('Error in channel command:', error.message);
  }
});

// Экспорт бота
module.exports = bot;