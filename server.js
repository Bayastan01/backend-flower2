const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Только самое необходимое
app.use(express.json());

// Корневой маршрут - самый важный!
app.get('/', (req, res) => {
  console.log('Root route accessed');
  res.json({ 
    status: 'OK', 
    message: 'Flower Bot API is running',
    time: new Date().toISOString()
  });
});

// Простой health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Простой API endpoint для проверки
app.get('/api/test', (req, res) => {
  res.json({ 
    success: true, 
    message: 'API is working',
    data: { test: 'ok' }
  });
});

// Простой POST endpoint
app.post('/api/auth/google', (req, res) => {
  console.log('Google auth request:', req.body);
  res.json({ 
    success: true, 
    message: 'Auth successful',
    user: { id: 'test123', name: 'Test User' }
  });
});

// Обработка 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// Обработка ошибок
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Запуск сервера с обработкой ошибок
const server = app.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
  console.log(`✅ Health check: http://localhost:${PORT}/health`);
});

// Обработка ошибок при запуске сервера
server.on('error', (error) => {
  console.error('Server error:', error);
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use`);
  }
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('Shutting down...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

console.log('✅ Application initialized successfully');