const { OAuth2Client } = require('google-auth-library');
const bot = require('./bot');

require('dotenv').config();

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Хранилище данных (в продакшене используйте базу данных)
const googleUsers = new Map();
const userContacts = new Map();
const userMediaPosts = new Map();

// Верификация Google токена
async function verifyGoogleToken(token) {
  try {
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    
    const payload = ticket.getPayload();
    
    return {
      success: true,
      data: {
        googleId: payload.sub,
        email: payload.email,
        name: payload.name,
        picture: payload.picture,
        emailVerified: payload.email_verified,
        locale: payload.locale,
        givenName: payload.given_name,
        familyName: payload.family_name
      }
    };
  } catch (error) {
    console.error('Google token verification error:', error);
    return {
      success: false,
      error: 'Invalid Google token',
      details: error.message
    };
  }
}

// Обработка Google авторизации
async function handleGoogleAuth(req, res) {
  try {
    const { token, telegramUserId, telegramUsername } = req.body;
    
    console.log('Google auth request:', { 
      telegramUserId, 
      telegramUsername,
      hasToken: !!token 
    });
    
    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Google token is required'
      });
    }
    
    // Верифицируем Google токен
    const verification = await verifyGoogleToken(token);
    
    if (!verification.success) {
      return res.status(401).json(verification);
    }
    
    const googleData = verification.data;
    
    // Создаем ID пользователя
    const userId = telegramUserId || `google_${googleData.googleId}`;
    
    // Сохраняем/обновляем пользователя
    const userData = {
      ...googleData,
      telegramUserId,
      telegramUsername,
      authDate: new Date(),
      lastLogin: new Date(),
      postsCount: googleUsers.get(userId)?.postsCount || 0,
      isGoogleAuth: true
    };
    
    googleUsers.set(userId, userData);
    
    // Обновляем информацию в боте
    if (telegramUserId && bot) {
      try {
        // Отправляем уведомление пользователю в Telegram
        await bot.telegram.sendMessage(
          telegramUserId,
          `✅ Вы успешно авторизовались через Google!\n\n` +
          `📧 Email: ${googleData.email}\n` +
          `👤 Имя: ${googleData.name}\n\n` +
          `Теперь вы можете публиковать посты в канале.`
        );
        
        console.log(`✅ User ${telegramUserId} authorized with Google: ${googleData.email}`);
      } catch (tgError) {
        console.error('Error sending Telegram notification:', tgError);
      }
    }
    
    // Формируем ответ
    const response = {
      success: true,
      user: {
        id: userId,
        email: googleData.email,
        name: googleData.name,
        picture: googleData.picture,
        telegramUserId: telegramUserId,
        telegramUsername: telegramUsername,
        authDate: userData.authDate,
        isVerified: googleData.emailVerified,
        postsCount: userData.postsCount,
        hasContacts: userContacts.has(userId)
      },
      permissions: {
        canPost: true,
        maxPostsPerDay: 10,
        canUseWebApp: true
      }
    };
    
    res.json(response);
    
  } catch (error) {
    console.error('Google auth error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
}

// Обработка загрузки контактов
async function handleContactsUpload(req, res) {
  try {
    const { userId, chatId, contacts, firstName, importSource } = req.body;
    
    console.log('Contacts upload request:', { 
      userId, 
      chatId,
      contactsCount: contacts?.length,
      importSource 
    });
    
    if (!userId || !chatId) {
      return res.status(400).json({
        success: false,
        error: 'User ID and Chat ID are required'
      });
    }
    
    if (!contacts || !Array.isArray(contacts) || contacts.length < 3) {
      return res.status(400).json({
        success: false,
        error: 'At least 3 contacts are required'
      });
    }
    
    // Сохраняем контакты
    userContacts.set(userId, {
      userId,
      chatId,
      contacts: contacts,
      count: contacts.length,
      importedAt: new Date(),
      importSource: importSource || 'unknown',
      firstName: firstName || 'User'
    });
    
    // Отправляем уведомление администратору
    try {
      const contactsInfo = contacts.slice(0, 5).map((c, i) => 
        `${i + 1}. ${c.name || 'No name'}: ${c.phone || 'No phone'}`
      ).join('\n');
      
      const contactsText = contacts.length > 5 ? 
        `${contactsInfo}\n... и еще ${contacts.length - 5} контактов` : 
        contactsInfo;
      
      await bot.telegram.sendMessage(
        process.env.CHANNEL_ID,
        `📞 НОВЫЕ КОНТАКТЫ ОТ ПОЛЬЗОВАТЕЛЯ\n\n` +
        `👤 Пользователь: ${firstName || 'Неизвестно'}\n` +
        `🆔 ID: ${userId}\n` +
        `📱 Контактов: ${contacts.length}\n` +
        `📥 Источник: ${importSource || 'неизвестно'}\n\n` +
        `📋 Первые контакты:\n${contactsText}\n\n` +
        `#контакты #проверка`
      );
      
      // Отправляем уведомление пользователю
      await bot.telegram.sendMessage(
        chatId,
        `✅ Ваши контакты успешно отправлены администратору!\n\n` +
        `📞 Отправлено контактов: ${contacts.length}\n` +
        `⏱ Время: ${new Date().toLocaleString('ru-RU')}\n\n` +
        `Администратор проверит контакты и вы сможете публиковать объявления.`
      );
      
    } catch (notificationError) {
      console.error('Error sending notifications:', notificationError);
    }
    
    res.json({
      success: true,
      message: 'Contacts uploaded successfully',
      contactsCount: contacts.length,
      userId: userId
    });
    
  } catch (error) {
    console.error('Contacts upload error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
}

// Обработка публикации медиа
async function handleMediaPublish(req, res) {
  try {
    const { 
      userId, 
      chatId, 
      description, 
      price, 
      contacts, 
      freshness, 
      city, 
      district, 
      address, 
      hashtags, 
      mediaFiles 
    } = req.body;
    
    console.log('Media publish request:', { 
      userId, 
      chatId,
      descriptionLength: description?.length,
      mediaCount: mediaFiles?.length 
    });
    
    if (!userId || !chatId) {
      return res.status(400).json({
        success: false,
        error: 'User ID and Chat ID are required'
      });
    }
    
    // Проверяем, есть ли у пользователя контакты
    if (!userContacts.has(userId)) {
      return res.status(403).json({
        success: false,
        error: 'Contacts not uploaded. Please upload contacts first.'
      });
    }
    
    // Проверяем, авторизован ли пользователь через Google
    const user = googleUsers.get(userId);
    if (!user || !user.isGoogleAuth) {
      return res.status(403).json({
        success: false,
        error: 'Google authorization required'
      });
    }
    
    // Проверяем медиа файлы
    if (!mediaFiles || mediaFiles.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'At least one media file is required'
      });
    }
    
    // Формируем текст поста
    const postText = formatPostText({
      description,
      price,
      contacts,
      freshness,
      city,
      district,
      address,
      hashtags,
      user
    });
    
    // Публикуем в канал
    try {
      const channelId = process.env.CHANNEL_ID;
      
      // Если есть медиа файлы, отправляем их
      if (mediaFiles.length > 0) {
        // Для первого файла с текстом
        const firstFile = mediaFiles[0];
        let firstMessageId;
        
        if (firstFile.type.startsWith('image/')) {
          const sentMessage = await bot.telegram.sendPhoto(channelId, 
            Buffer.from(firstFile.data, 'base64'), 
            { caption: postText, parse_mode: 'HTML' }
          );
          firstMessageId = sentMessage.message_id;
        } else if (firstFile.type.startsWith('video/')) {
          const sentMessage = await bot.telegram.sendVideo(channelId,
            Buffer.from(firstFile.data, 'base64'),
            { caption: postText, parse_mode: 'HTML' }
          );
          firstMessageId = sentMessage.message_id;
        }
        
        // Остальные файлы без текста
        for (let i = 1; i < mediaFiles.length; i++) {
          const file = mediaFiles[i];
          
          if (file.type.startsWith('image/')) {
            await bot.telegram.sendPhoto(channelId, 
              Buffer.from(file.data, 'base64')
            );
          } else if (file.type.startsWith('video/')) {
            await bot.telegram.sendVideo(channelId,
              Buffer.from(file.data, 'base64')
            );
          }
          
          // Задержка между отправками
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } else {
        // Если нет файлов, отправляем только текст
        await bot.telegram.sendMessage(channelId, postText, {
          parse_mode: 'HTML'
        });
      }
      
      // Увеличиваем счетчик постов
      if (user) {
        user.postsCount = (user.postsCount || 0) + 1;
        googleUsers.set(userId, user);
      }
      
      // Сохраняем информацию о посте
      const postId = `post_${Date.now()}_${userId}`;
      userMediaPosts.set(postId, {
        userId,
        chatId,
        postText,
        mediaCount: mediaFiles.length,
        publishedAt: new Date(),
        userEmail: user?.email
      });
      
      // Отправляем подтверждение пользователю
      await bot.telegram.sendMessage(
        chatId,
        `✅ Ваше объявление успешно опубликовано в канале!\n\n` +
        `📝 Пост с ${mediaFiles.length} файлом(ами)\n` +
        `👤 От: ${user?.name || 'Вы'}\n` +
        `📢 Канал: @${process.env.CHANNEL_USERNAME.replace('@', '')}\n\n` +
        `Чтобы посмотреть пост, перейдите в канал.`
      );
      
      res.json({
        success: true,
        message: 'Post published successfully',
        postId: postId,
        mediaCount: mediaFiles.length,
        publishedAt: new Date().toISOString()
      });
      
    } catch (publishError) {
      console.error('Error publishing to channel:', publishError);
      
      // Отправляем уведомление об ошибке пользователю
      try {
        await bot.telegram.sendMessage(
          chatId,
          `❌ Ошибка при публикации объявления.\n\n` +
          `Причина: ${publishError.message}\n\n` +
          `Пожалуйста, попробуйте еще раз или обратитесь к администратору.`
        );
      } catch (notificationError) {
        console.error('Error sending error notification:', notificationError);
      }
      
      res.status(500).json({
        success: false,
        error: 'Failed to publish to channel',
        message: publishError.message
      });
    }
    
  } catch (error) {
    console.error('Media publish error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
}

// Форматирование текста поста
function formatPostText(data) {
  const {
    description,
    price,
    contacts,
    freshness,
    city,
    district,
    address,
    hashtags,
    user
  } = data;
  
  let text = `🌸 <b>ПРОДАЖА ЦВЕТОВ</b> 🌸\n\n`;
  
  if (description) {
    text += `📝 <b>Описание:</b>\n${description}\n\n`;
  }
  
  if (price && price !== 'Договорная') {
    text += `💰 <b>Цена:</b> ${price} сом\n`;
  } else if (price === 'Договорная') {
    text += `💰 <b>Цена:</b> Договорная\n`;
  }
  
  if (freshness) {
    text += `🌿 <b>Свежесть:</b> ${freshness}\n`;
  }
  
  if (city || district || address) {
    text += `📍 <b>Местоположение:</b>\n`;
    if (city) text += `Город: ${city}\n`;
    if (district) text += `Район: ${district}\n`;
    if (address) text += `Адрес: ${address}\n`;
    text += '\n';
  }
  
  if (contacts) {
    text += `📞 <b>Контакты:</b> ${contacts}\n\n`;
  }
  
  if (user?.email) {
    text += `👤 <b>Продавец:</b> ${user.name || 'Пользователь'}\n`;
    text += `📧 <b>Email:</b> ${user.email}\n\n`;
  }
  
  if (hashtags) {
    text += `${hashtags}\n\n`;
  }
  
  text += `🕐 ${new Date().toLocaleString('ru-RU')}\n`;
  text += `#цветы${city ? `_${city.toLowerCase().replace(/[^а-яё]/g, '')}` : ''}`;
  
  return text;
}

// Получение информации о пользователе
function getUserInfo(req, res) {
  const { userId } = req.params;
  
  console.log('Get user info for:', userId);
  
  if (!googleUsers.has(userId) && !userContacts.has(userId)) {
    return res.status(404).json({
      success: false,
      error: 'User not found'
    });
  }
  
  const user = googleUsers.get(userId) || {};
  const contacts = userContacts.get(userId);
  
  const response = {
    success: true,
    user: {
      id: userId,
      email: user.email,
      name: user.name,
      picture: user.picture,
      telegramUserId: user.telegramUserId,
      telegramUsername: user.telegramUsername,
      authDate: user.authDate,
      lastLogin: user.lastLogin,
      postsCount: user.postsCount || 0,
      isVerified: user.emailVerified,
      isGoogleAuth: !!user.isGoogleAuth
    },
    contacts: contacts ? {
      hasContacts: true,
      contactsCount: contacts.count,
      importedAt: contacts.importedAt,
      importSource: contacts.importSource
    } : {
      hasContacts: false,
      contactsCount: 0
    }
  };
  
  res.json(response);
}

// Получение статуса пользователя
function getUserStatus(req, res) {
  const { userId } = req.params;
  
  const hasGoogleAuth = googleUsers.has(userId);
  const hasContacts = userContacts.has(userId);
  const user = googleUsers.get(userId);
  const contacts = userContacts.get(userId);
  
  res.json({
    success: true,
    hasGoogleAuth: hasGoogleAuth,
    hasContacts: hasContacts,
    contactsCount: contacts?.count || 0,
    postsCount: user?.postsCount || 0,
    lastLogin: user?.lastLogin,
    canPost: hasGoogleAuth && hasContacts
  });
}

// Функция для обновления количества постов
function incrementUserPosts(userId) {
  if (googleUsers.has(userId)) {
    const user = googleUsers.get(userId);
    user.postsCount = (user.postsCount || 0) + 1;
    googleUsers.set(userId, user);
    return user.postsCount;
  }
  return 0;
}

// Получить всех пользователей (для админки)
function getAllUsers() {
  return Array.from(googleUsers.entries()).map(([id, user]) => ({
    id,
    ...user
  }));
}

module.exports = {
  verifyGoogleToken,
  handleGoogleAuth,
  handleContactsUpload,
  handleMediaPublish,
  getUserInfo,
  getUserStatus,
  incrementUserPosts,
  getAllUsers,
  googleUsers,
  userContacts,
  userMediaPosts
};