// Tiny static file server for local development.
// The app in public/ is fully self-contained — this is just a convenience.

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`assembly viewer running at http://localhost:${PORT}`);
});
