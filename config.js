// Конфигурация приложения
const config = {
  // Основные настройки
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // Telegram настройки (обязательные)
  botToken: process.env.BOT_TOKEN || '8316210179:AAG7Tfvf1ou8_8g1rQjD8UQt6sKXKXG0hPQ',
  channelId: process.env.CHANNEL_ID || '-1003293921379',
  botUsername: process.env.BOT_USERNAME || '@Flowers_free_bot',
  channelUsername: process.env.CHANNEL_USERNAME || '@flowers_market_kg',
  idBot: process.env.Id_Bot || '8316210179',
  
  // URL настройки
  webappUrl: process.env.WEBAPP_URL || 'https://flowers-telegram-kyrgyzstan.up.railway.app/',
  frontendUrl: process.env.FRONTEND_URL || 'https://flowers-telegram-kyrgyzstan.up.railway.app',
  backendUrl: process.env.BACKEND_URL || 'https://backend-flower-kyrgyz.up.railway.app',
  
  // Google API настройки
  googleClientId: process.env.GOOGLE_CLIENT_ID || '316866498988-v1pqivbgh0eupcb9rs53m26nrqukn9hb.apps.googleusercontent.com',
  googleApiKey: process.env.GOOGLE_API_KEY || 'AIzaSyABvmdHttTDFwLicTdA5ctg38uTy-H_4B0',
  
  // Настройки приложения
  maxFileSize: process.env.MAX_FILE_SIZE || '50mb',
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000, // 15 минут
  rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  logLevel: process.env.LOG_LEVEL || 'info',
};

// Проверка обязательных настроек
const requiredConfig = ['botToken', 'channelId', 'botUsername', 'channelUsername'];
const missingConfig = requiredConfig.filter(key => !config[key]);

if (missingConfig.length > 0 && config.nodeEnv === 'production') {
  console.error('❌ Отсутствуют обязательные настройки:', missingConfig);
  console.error('ℹ️ Установите эти переменные окружения на Railway');
  process.exit(1);
}

// Вывод конфигурации (без токенов в продакшене)
console.log('🔧 Конфигурация приложения:');
console.log(`   Port: ${config.port}`);
console.log(`   Environment: ${config.nodeEnv}`);
console.log(`   Bot: ${config.botUsername}`);
console.log(`   Channel: ${config.channelUsername}`);
console.log(`   WebApp URL: ${config.webappUrl}`);
console.log(`   Backend URL: ${config.backendUrl}`);
console.log(`   Google Client ID: ${config.googleClientId ? 'configured' : 'not configured'}`);

module.exports = config;