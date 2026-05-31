const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// publicフォルダ内の静的ファイル（HTML, CSS, JS）を公開する
app.use(express.static(path.join(__dirname, 'public')));

// どのルートにアクセスしても index.html を返すように設定
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
