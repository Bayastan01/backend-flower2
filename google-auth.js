const { OAuth2Client } = require('google-auth-library');

require('dotenv').config();

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Хранилище данных в памяти
const googleUsers = new Map();

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
        emailVerified: payload.email_verified
      }
    };
  } catch (error) {
    console.error('Google token verification error:', error);
    return {
      success: false,
      error: 'Неверный Google токен'
    };
  }
}

// Обработка Google авторизации
async function handleGoogleAuth(req, res) {
  try {
    const { token, telegramUserId } = req.body;
    
    console.log('Google auth request:', { telegramUserId });
    
    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Google токен обязателен'
      });
    }
    
    // Верифицируем Google токен
    const verification = await verifyGoogleToken(token);
    
    if (!verification.success) {
      return res.status(401).json(verification);
    }
    
    const googleData = verification.data;
    
    // Сохраняем пользователя
    const userId = telegramUserId || `google_${googleData.googleId}`;
    const userData = {
      ...googleData,
      telegramUserId,
      authDate: new Date(),
      lastLogin: new Date(),
      isGoogleAuth: true
    };
    
    googleUsers.set(userId, userData);
    
    console.log(`✅ Пользователь авторизован: ${googleData.email} (Telegram: ${telegramUserId})`);
    
    // Формируем ответ
    const response = {
      success: true,
      user: {
        id: userId,
        email: googleData.email,
        name: googleData.name,
        picture: googleData.picture,
        telegramUserId: telegramUserId,
        authDate: userData.authDate,
        isVerified: googleData.emailVerified
      }
    };
    
    res.json(response);
    
  } catch (error) {
    console.error('Google auth error:', error);
    res.status(500).json({
      success: false,
      error: 'Ошибка сервера'
    });
  }
}

// Проверка статуса пользователя
function getUserStatus(req, res) {
  const { userId } = req.params;
  
  console.log('Check user status:', userId);
  
  const user = googleUsers.get(userId);
  
  if (!user) {
    return res.json({
      success: true,
      isLoggedIn: false,
      needsGoogleAuth: true
    });
  }
  
  res.json({
    success: true,
    isLoggedIn: true,
    needsGoogleAuth: false,
    user: {
      email: user.email,
      name: user.name,
      picture: user.picture
    }
  });
}

// Получение информации о пользователе
function getUserInfo(req, res) {
  const { userId } = req.params;
  
  console.log('Get user info for:', userId);
  
  const user = googleUsers.get(userId);
  
  if (!user) {
    return res.status(404).json({
      success: false,
      error: 'Пользователь не найден'
    });
  }
  
  res.json({
    success: true,
    user: {
      id: userId,
      email: user.email,
      name: user.name,
      picture: user.picture,
      telegramUserId: user.telegramUserId,
      authDate: user.authDate,
      isVerified: user.emailVerified
    }
  });
}

// Загрузка контактов
async function handleContactsUpload(req, res) {
  try {
    const { userId, contacts } = req.body;
    
    console.log('Contacts upload:', { userId, contactsCount: contacts?.length });
    
    if (!userId || !contacts || !Array.isArray(contacts)) {
      return res.status(400).json({
        success: false,
        error: 'Неверные данные'
      });
    }
    
    res.json({
      success: true,
      message: 'Контакты сохранены',
      contactsCount: contacts.length
    });
    
  } catch (error) {
    console.error('Contacts upload error:', error);
    res.status(500).json({
      success: false,
      error: 'Ошибка сервера'
    });
  }
}

// Публикация объявления
async function handleMediaPublish(req, res) {
  try {
    const { 
      userId, 
      title, 
      description, 
      price, 
      contactInfo,
      images
    } = req.body;
    
    console.log('Publish ad:', { 
      userId, 
      title,
      imagesCount: images?.length 
    });
    
    const user = googleUsers.get(userId);
    
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Пользователь не авторизован'
      });
    }
    
    // Формируем текст поста для канала
    const postText = `🌸 <b>НОВОЕ ОБЪЯВЛЕНИЕ</b> 🌸\n\n` +
      `<b>${title || 'Продажа цветов'}</b>\n\n` +
      `📝 <b>Описание:</b>\n${description || 'Нет описания'}\n\n` +
      `💰 <b>Цена:</b> ${price || 'Договорная'}\n\n` +
      `📞 <b>Контакты:</b> ${contactInfo || 'В комментариях'}\n\n` +
      `👤 <b>Продавец:</b> ${user.name}\n` +
      `📧 <b>Email:</b> ${user.email}\n\n` +
      `🕐 ${new Date().toLocaleString('ru-RU')}\n` +
      `#цветы #продажа`;
    
    console.log('📢 Пост для канала:', postText);
    
    // Здесь должен быть код отправки в Telegram канал
    // Для теста просто возвращаем успех
    
    res.json({
      success: true,
      message: 'Объявление опубликовано',
      postPreview: postText,
      imagesCount: images?.length || 0
    });
    
  } catch (error) {
    console.error('Publish ad error:', error);
    res.status(500).json({
      success: false,
      error: 'Ошибка публикации объявления'
    });
  }
}

module.exports = {
  verifyGoogleToken,
  handleGoogleAuth,
  getUserStatus,
  getUserInfo,
  handleContactsUpload,
  handleMediaPublish,
  googleUsers
};