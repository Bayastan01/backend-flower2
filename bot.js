const { Telegraf, Markup } = require('telegraf');
const { googleUsers, userContacts } = require('./google-auth');

require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);

// Хранилище для временных данных пользователей
const userPosts = new Map();

// Команда /start
bot.start(async (ctx) => {
  const userId = ctx.from.id.toString();
  const username = ctx.from.username || `user_${userId}`;
  
  // Проверяем, есть ли пользователь в Google авторизации
  const googleUser = googleUsers.get(userId);
  const hasContacts = userContacts.has(userId);
  
  // Сохраняем/обновляем пользователя
  const userData = {
    id: userId,
    username: username,
    firstName: ctx.from.first_name,
    lastName: ctx.from.last_name,
    isGoogleAuth: !!googleUser,
    googleData: googleUser,
    hasContacts: hasContacts,
    contactsCount: hasContacts ? userContacts.get(userId).count : 0,
    joinedAt: new Date()
  };

  const webappUrl = process.env.WEBAPP_URL || 'https://flowers-telegram-kyrgyzstan.up.railway.app/';
  
  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.webApp(
        '🌸 Открыть магазин цветов',
        webappUrl
      )
    ],
    [
      googleUser ? 
        Markup.button.callback('✅ Google авторизован', 'check_auth_status') :
        Markup.button.callback('🔐 Авторизация Google', 'google_auth'),
      Markup.button.callback('📤 Создать пост', 'create_post')
    ],
    [
      Markup.button.url('📢 Наш канал', `https://t.me/${process.env.CHANNEL_USERNAME.replace('@', '')}`),
      Markup.button.url('🤖 Написать боту', `https://t.me/${process.env.BOT_USERNAME.replace('@', '')}`)
    ]
  ]);

  let message = `🌸 <b>Добро пожаловать в магазин цветов!</b>\n\n`;
  
  if (googleUser) {
    message += `✅ <b>Google авторизация:</b> ${googleUser.email}\n`;
  } else {
    message += `🔐 <b>Google авторизация:</b> Не выполнена\n`;
  }
  
  if (hasContacts) {
    message += `📞 <b>Контакты:</b> Загружены (${userContacts.get(userId).count} шт.)\n`;
  } else {
    message += `📞 <b>Контакты:</b> Не загружены\n`;
  }
  
  message += `\n<b>Что вы можете сделать:</b>\n`;
  message += `• 🛒 <b>Перейти в магазин цветов</b>\n`;
  message += `• 🔐 <b>Авторизоваться через Google</b>\n`;
  message += `• 📤 <b>Публиковать посты в нашем канале</b>\n\n`;
  message += `<i>Выберите действие:</i>`;

  await ctx.replyWithHTML(message, keyboard);
});

// Команда /help
bot.help((ctx) => {
  ctx.replyWithHTML(
    `<b>ℹ️ Доступные команды:</b>\n\n` +
    `/start - Начать работу с ботом\n` +
    `/help - Помощь и инструкции\n` +
    `/shop - Открыть магазин\n` +
    `/auth - Авторизация через Google\n` +
    `/post - Создать пост для канала\n` +
    `/channel - Перейти в канал\n` +
    `/myinfo - Моя информация\n` +
    `/contacts - Статус контактов\n\n` +
    `<b>Наш магазин:</b> ${process.env.WEBAPP_URL}\n` +
    `<b>Наш канал:</b> @${process.env.CHANNEL_USERNAME.replace('@', '')}`
  );
});

// Команда /contacts
bot.command('contacts', async (ctx) => {
  const userId = ctx.from.id.toString();
  const contacts = userContacts.get(userId);
  
  if (contacts) {
    await ctx.replyWithHTML(
      `<b>📞 Ваши контакты:</b>\n\n` +
      `✅ <b>Статус:</b> Загружены\n` +
      `📊 <b>Количество:</b> ${contacts.count} контактов\n` +
      `📅 <b>Дата загрузки:</b> ${new Date(contacts.importedAt).toLocaleString('ru-RU')}\n` +
      `📥 <b>Источник:</b> ${contacts.importSource || 'неизвестно'}\n\n` +
      `Контакты проверены администратором.`
    );
  } else {
    await ctx.replyWithHTML(
      `<b>📞 Ваши контакты:</b>\n\n` +
      `❌ <b>Статус:</b> Не загружены\n\n` +
      `Для публикации объявлений необходимо загрузить контакты.\n` +
      `Перейдите в магазин и следуйте инструкциям.`
    );
  }
});

// Команда /shop
bot.command('shop', (ctx) => {
  const webappUrl = process.env.WEBAPP_URL;
  
  ctx.reply(
    '🛒 Открыть магазин цветов',
    Markup.inlineKeyboard([
      [Markup.button.webApp('🌸 Перейти в магазин', webappUrl)]
    ])
  );
});

// Команда /auth
bot.command('auth', (ctx) => {
  const userId = ctx.from.id.toString();
  const googleUser = googleUsers.get(userId);
  
  if (googleUser) {
    ctx.replyWithHTML(
      `<b>✅ Вы уже авторизованы через Google!</b>\n\n` +
      `📧 <b>Email:</b> ${googleUser.email}\n` +
      `👤 <b>Имя:</b> ${googleUser.name}\n` +
      `📅 <b>Дата авторизации:</b> ${new Date(googleUser.authDate).toLocaleString('ru-RU')}\n\n` +
      `Теперь вы можете публиковать посты в канале.`
    );
  } else {
    ctx.replyWithHTML(
      `<b>🔐 Авторизация через Google</b>\n\n` +
      `Для авторизации перейдите в наш магазин и используйте кнопку Google Sign-In.\n\n` +
      `<b>После авторизации вы сможете:</b>\n` +
      `• Публиковать посты в канале\n` +
      `• Получать уведомления\n` +
      `• Сохранять историю заказов`,
      Markup.inlineKeyboard([
        [Markup.button.webApp('🚀 Перейти к авторизации', process.env.WEBAPP_URL)],
        [Markup.button.callback('🔄 Проверить статус', 'check_auth_status')]
      ])
    );
  }
});

// Команда /post
bot.command('post', async (ctx) => {
  const userId = ctx.from.id.toString();
  const googleUser = googleUsers.get(userId);
  const hasContacts = userContacts.has(userId);
  
  if (!googleUser) {
    return ctx.reply(
      '⚠️ Сначала необходимо авторизоваться через Google!\n\n' +
      'Перейдите в магазин и выполните вход через Google.',
      Markup.inlineKeyboard([
        [Markup.button.webApp('🔐 Авторизоваться', process.env.WEBAPP_URL)]
      ])
    );
  }
  
  if (!hasContacts) {
    return ctx.reply(
      '⚠️ Необходимо загрузить контакты!\n\n' +
      'Для публикации объявлений нужно загрузить контакты через магазин.',
      Markup.inlineKeyboard([
        [Markup.button.webApp('📞 Загрузить контакты', process.env.WEBAPP_URL)]
      ])
    );
  }
  
  await ctx.reply(
    '📝 Создание поста для канала\n\n' +
    'Отправьте мне:\n' +
    '1. 📸 Фото или видео\n' +
    '2. 📝 Текст описания\n' +
    '3. 💰 Цену (если нужно)\n\n' +
    'Или нажмите кнопку ниже:',
    Markup.inlineKeyboard([
      [Markup.button.callback('📤 Создать пост', 'create_post')],
      [Markup.button.callback('❌ Отмена', 'cancel')]
    ])
  );
});

// Команда /channel
bot.command('channel', (ctx) => {
  ctx.reply(
    '📢 Наш канал с цветами',
    Markup.inlineKeyboard([
      [Markup.button.url('🌸 Перейти в канал', `https://t.me/${process.env.CHANNEL_USERNAME.replace('@', '')}`)],
      [Markup.button.callback('📤 Опубликовать пост', 'create_post')]
    ])
  );
});

// Команда /myinfo
bot.command('myinfo', async (ctx) => {
  const userId = ctx.from.id.toString();
  const googleUser = googleUsers.get(userId);
  const contacts = userContacts.get(userId);
  
  let message = `👤 <b>Ваша информация:</b>\n\n` +
    `🆔 <b>Telegram ID:</b> <code>${userId}</code>\n` +
    `👤 <b>Имя:</b> ${ctx.from.first_name || 'Не указано'}\n` +
    `📛 <b>Фамилия:</b> ${ctx.from.last_name || 'Не указано'}\n` +
    `📱 <b>Username:</b> @${ctx.from.username || 'Не указан'}\n`;
  
  if (googleUser) {
    message += `\n✅ <b>Google авторизация:</b>\n`;
    message += `📧 <b>Email:</b> ${googleUser.email}\n`;
    message += `👤 <b>Имя:</b> ${googleUser.name}\n`;
    message += `📅 <b>Дата:</b> ${new Date(googleUser.authDate).toLocaleString('ru-RU')}\n`;
    message += `📊 <b>Постов:</b> ${googleUser.postsCount || 0}\n`;
  } else {
    message += `\n❌ <b>Google авторизация:</b> Не выполнена\n`;
  }
  
  if (contacts) {
    message += `\n✅ <b>Контакты:</b>\n`;
    message += `📊 <b>Количество:</b> ${contacts.count} шт.\n`;
    message += `📅 <b>Дата:</b> ${new Date(contacts.importedAt).toLocaleString('ru-RU')}\n`;
    message += `📥 <b>Источник:</b> ${contacts.importSource || 'неизвестно'}\n`;
  } else {
    message += `\n❌ <b>Контакты:</b> Не загружены\n`;
  }
  
  await ctx.replyWithHTML(message);
});

// Обработка callback-кнопок
bot.action('google_auth', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.replyWithHTML(
    `<b>🔐 Авторизация через Google</b>\n\n` +
    `Перейдите по кнопке ниже для авторизации:\n\n` +
    `<i>После авторизации вы получите доступ к публикации постов.</i>`,
    Markup.inlineKeyboard([
      [Markup.button.webApp('🚀 Авторизоваться через Google', process.env.WEBAPP_URL)],
      [Markup.button.callback('🔄 Проверить статус', 'check_auth_status')]
    ])
  );
});

bot.action('create_post', async (ctx) => {
  const userId = ctx.from.id.toString();
  const googleUser = googleUsers.get(userId);
  const hasContacts = userContacts.has(userId);
  
  await ctx.answerCbQuery();
  
  if (!googleUser) {
    return ctx.reply(
      '⚠️ Для создания поста нужна авторизация через Google!',
      Markup.inlineKeyboard([
        [Markup.button.webApp('🔐 Авторизоваться', process.env.WEBAPP_URL)]
      ])
    );
  }
  
  if (!hasContacts) {
    return ctx.reply(
      '⚠️ Необходимо загрузить контакты!',
      Markup.inlineKeyboard([
        [Markup.button.webApp('📞 Загрузить контакты', process.env.WEBAPP_URL)]
      ])
    );
  }
  
  await ctx.replyWithHTML(
    `<b>📝 Создание поста для канала</b>\n\n` +
    `<i>Отправьте мне контент для поста:</i>\n\n` +
    `• 📸 Фото/видео с подписью\n` +
    `• 📝 Или просто текст\n` +
    `• 🏷️ Можно добавить хештеги\n\n` +
    `<b>Пример хештегов:</b>\n` +
    `#цветы #букет #доставка #бишкек #flowers`
  );
});

bot.action('check_auth_status', async (ctx) => {
  const userId = ctx.from.id.toString();
  const googleUser = googleUsers.get(userId);
  const hasContacts = userContacts.has(userId);
  
  await ctx.answerCbQuery();
  
  if (googleUser) {
    let message = `✅ <b>Вы авторизованы через Google!</b>\n\n`;
    message += `📧 <b>Email:</b> ${googleUser.email}\n`;
    message += `👤 <b>Имя:</b> ${googleUser.name}\n`;
    message += `📊 <b>Постов:</b> ${googleUser.postsCount || 0}\n\n`;
    
    if (hasContacts) {
      const contacts = userContacts.get(userId);
      message += `✅ <b>Контакты:</b> Загружены (${contacts.count} шт.)\n`;
      message += `Теперь вы можете публиковать посты в канале.`;
    } else {
      message += `❌ <b>Контакты:</b> Не загружены\n`;
      message += `Для публикации постов необходимо загрузить контакты.`;
    }
    
    await ctx.replyWithHTML(message);
  } else {
    await ctx.reply(
      '❌ Вы не авторизованы через Google.\n' +
      'Для авторизации перейдите в магазин.'
    );
  }
});

bot.action('cancel', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('Действие отменено.');
});

// Обработка текстовых сообщений
bot.on('text', async (ctx) => {
  const userId = ctx.from.id.toString();
  const googleUser = googleUsers.get(userId);
  const text = ctx.message.text;
  
  if (googleUser && text && text.length > 3) {
    userPosts.set(userId, { ...userPosts.get(userId), text: text });
    
    await ctx.reply(
      '📝 Текст сохранен! Теперь отправьте фото или видео, или нажмите "Опубликовать":',
      Markup.inlineKeyboard([
        [Markup.button.callback('📤 Опубликовать текст', 'publish_text')],
        [Markup.button.callback('➕ Добавить фото', 'add_photo')],
        [Markup.button.callback('🎥 Добавить видео', 'add_video')],
        [Markup.button.callback('❌ Отмена', 'cancel_post')]
      ])
    );
  }
});

// Обработка медиа
bot.on(['photo', 'video'], async (ctx) => {
  const userId = ctx.from.id.toString();
  const googleUser = googleUsers.get(userId);
  const hasContacts = userContacts.has(userId);
  
  if (!googleUser) {
    return ctx.reply('Сначала авторизуйтесь через Google! Используйте /auth');
  }
  
  if (!hasContacts) {
    return ctx.reply('Необходимо загрузить контакты! Используйте команду /contacts для информации.');
  }
  
  const message = ctx.message;
  const caption = message.caption || '';
  const mediaType = message.photo ? 'photo' : 'video';
  const fileId = message.photo ? 
    message.photo[message.photo.length - 1].file_id : 
    message.video.file_id;
  
  userPosts.set(userId, {
    mediaType,
    fileId,
    caption,
    userId,
    user: googleUser,
    createdAt: new Date()
  });
  
  await ctx.reply(
    `📸 ${mediaType === 'photo' ? 'Фото' : 'Видео'} сохранено!\n\n` +
    'Вы можете:\n' +
    '• 📝 Добавить текст описания\n' +
    '• 📤 Опубликовать сейчас\n' +
    '• 👀 Посмотреть предпросмотр',
    Markup.inlineKeyboard([
      [Markup.button.callback('📤 Опубликовать сейчас', 'publish_media')],
      [Markup.button.callback('✏️ Добавить описание', 'add_caption')],
      [Markup.button.callback('👀 Предпросмотр', 'preview_post')],
      [Markup.button.callback('❌ Отмена', 'cancel_post')]
    ])
  );
});

// Публикация медиа в канал
bot.action('publish_media', async (ctx) => {
  const userId = ctx.from.id.toString();
  const post = userPosts.get(userId);
  const googleUser = googleUsers.get(userId);
  const contacts = userContacts.get(userId);
  
  if (!post) {
    await ctx.answerCbQuery('❌ Нет данных для публикации');
    return;
  }
  
  try {
    const channelId = process.env.CHANNEL_ID;
    
    const caption = `🌸 ${post.caption || 'Красивый букет цветов'}\n\n` +
                   `📱 От: ${googleUser?.name || ctx.from.first_name || 'Пользователь'}\n` +
                   `📧 Email: ${googleUser?.email || 'Не указан'}\n` +
                   `📞 Контактов: ${contacts?.count || 0}\n` +
                   `🕐 ${new Date().toLocaleDateString('ru-RU')}\n\n` +
                   `#цветы #доставка #бишкек #букет #flowers`;
    
    if (post.mediaType === 'photo') {
      await ctx.telegram.sendPhoto(channelId, post.fileId, {
        caption: caption,
        parse_mode: 'HTML'
      });
    } else {
      await ctx.telegram.sendVideo(channelId, post.fileId, {
        caption: caption,
        parse_mode: 'HTML'
      });
    }
    
    await ctx.answerCbQuery('✅ Пост опубликован!');
    await ctx.replyWithHTML(
      `✅ <b>Ваш пост успешно опубликован в канале!</b>\n\n` +
      `📢 <a href="https://t.me/${process.env.CHANNEL_USERNAME.replace('@', '')}">Посмотреть в канале</a>`
    );
    
    userPosts.delete(userId);
    
  } catch (error) {
    console.error('Error publishing to channel:', error);
    await ctx.answerCbQuery('❌ Ошибка публикации');
    await ctx.reply('❌ Ошибка при публикации поста. Проверьте права бота в канале.');
  }
});

bot.action('publish_text', async (ctx) => {
  const userId = ctx.from.id.toString();
  const post = userPosts.get(userId);
  const googleUser = googleUsers.get(userId);
  const contacts = userContacts.get(userId);
  
  if (!post || !post.text) {
    await ctx.answerCbQuery('❌ Нет текста для публикации');
    return;
  }
  
  try {
    const channelId = process.env.CHANNEL_ID;
    
    const caption = `📝 ${post.text}\n\n` +
                   `👤 От: ${googleUser?.name || ctx.from.first_name || 'Пользователь'}\n` +
                   `📧 Email: ${googleUser?.email || 'Не указан'}\n` +
                   `📞 Контактов: ${contacts?.count || 0}\n` +
                   `🕐 ${new Date().toLocaleDateString('ru-RU')}\n\n` +
                   `#цветы #объявление #бишкек #flowers`;
    
    await ctx.telegram.sendMessage(channelId, caption, {
      parse_mode: 'HTML'
    });
    
    await ctx.answerCbQuery('✅ Текст опубликован!');
    await ctx.replyWithHTML(
      `✅ <b>Текст успешно опубликован в канале!</b>\n\n` +
      `📢 <a href="https://t.me/${process.env.CHANNEL_USERNAME.replace('@', '')}">Посмотреть в канале</a>`
    );
    
    userPosts.delete(userId);
    
  } catch (error) {
    console.error('Error publishing text to channel:', error);
    await ctx.answerCbQuery('❌ Ошибка публикации');
    await ctx.reply('❌ Ошибка при публикации текста. Попробуйте позже.');
  }
});

bot.action('preview_post', async (ctx) => {
  const userId = ctx.from.id.toString();
  const post = userPosts.get(userId);
  const googleUser = googleUsers.get(userId);
  
  if (!post) {
    await ctx.answerCbQuery('❌ Нет данных для предпросмотра');
    return;
  }
  
  await ctx.answerCbQuery('👀 Показываю предпросмотр...');
  
  const previewText = `📋 <b>Предпросмотр поста:</b>\n\n` +
    `📷 <b>Тип:</b> ${post.mediaType === 'photo' ? 'Фото' : 'Видео'}\n` +
    `📝 <b>Описание:</b> ${post.caption || 'Нет описания'}\n` +
    `👤 <b>Автор:</b> ${googleUser?.name || 'Не указан'}\n` +
    `📧 <b>Email:</b> ${googleUser?.email || 'Не указан'}\n` +
    `🕐 <b>Дата:</b> ${post.createdAt?.toLocaleDateString('ru-RU') || 'Сейчас'}`;
  
  await ctx.replyWithHTML(previewText);
});

bot.action(['add_photo', 'add_video', 'add_caption'], async (ctx) => {
  await ctx.answerCbQuery('📤 Отправьте мне контент...');
  await ctx.reply('Отправьте мне фото, видео или текст описания:');
});

bot.action('cancel_post', async (ctx) => {
  const userId = ctx.from.id.toString();
  userPosts.delete(userId);
  
  await ctx.answerCbQuery('❌ Пост отменен');
  await ctx.reply('Создание поста отменено.');
});

// Обработка ошибок
bot.catch((err, ctx) => {
  console.error(`Error for ${ctx.updateType}:`, err);
  ctx.reply('❌ Произошла ошибка. Попробуйте еще раз или используйте /help');
});

// Экспорт бота
module.exports = bot;