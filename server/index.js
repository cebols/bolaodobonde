import app from './app.js';

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`⚽ Bolão da Copa 2026 rodando em http://localhost:${PORT}`);
});
