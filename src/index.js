const express = require('express');
const multer = require('multer');
const path = require('node:path');
require('dotenv').config();

const app = express();

const PUBLIC_KEY = process.env.PUBLIC_KEY_IPDF;
const SECRET_KEY = process.env.API_KEY_IPDF;

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 30 * 1024 * 1024 } // 30MB
});

app.use(express.urlencoded({ extended: true }));

// ================== HALAMAN UTAMA ==================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'views', 'home.html'));
});

app.get('/staf', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'views', 'staf.html'));
})

// ================== ENCRYPT PDF ==================
app.post('/encrypt-pdf', upload.single('pdfFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('Silakan upload file PDF');
    }

    const password = req.body.password;
    if (!password || password.length < 6) {
        return res.status(400).send('Password minimal 6 karakter');
    }

    try {
        const fileBuffer = req.file.buffer;
        const fileName = req.file.originalname || 'document.pdf';

        // Step 0: Autentikasi → dapat JWT token
        const authRes = await fetch('https://api.ilovepdf.com/v1/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ public_key: PUBLIC_KEY })
        });
        if (!authRes.ok) throw new Error(`Auth gagal: ${authRes.status}`);
        const { token } = await authRes.json();

        // Step 1: Buat Task
        const startRes = await fetch('https://api.ilovepdf.com/v1/start/protect', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!startRes.ok) throw new Error(`Gagal start task: ${startRes.status}`);
        const { task: taskId, server: serverHost } = await startRes.json();
        if (!taskId) throw new Error('Task ID tidak ditemukan');

        // Step 2: Upload file
        const formData = new FormData();
        const blob = new Blob([fileBuffer], { type: 'application/pdf' });
        formData.append('task', taskId);
        formData.append('file', blob, fileName);

        const uploadRes = await fetch(`https://${serverHost}/v1/upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });
        if (!uploadRes.ok) throw new Error(`Gagal upload: ${uploadRes.status}`);
        const { server_filename: serverFilename } = await uploadRes.json();
        if (!serverFilename) throw new Error('server_filename tidak ditemukan');

        // Step 3: Proses (protect/encrypt)
        const processRes = await fetch(`https://${serverHost}/v1/process`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                task: taskId,
                tool: 'protect',
                files: [{ server_filename: serverFilename, filename: fileName }],
                password: password
            })
        });
        if (!processRes.ok) {
            const errText = await processRes.text();
            throw new Error(`Gagal proses: ${processRes.status} - ${errText}`);
        }

        // Step 4: Download hasil
        const downloadRes = await fetch(`https://${serverHost}/v1/download/${taskId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!downloadRes.ok) throw new Error(`Gagal download: ${downloadRes.status}`);

        // ✅ Gunakan arrayBuffer(), bukan .buffer() (tidak ada di native fetch)
        const outputBuffer = Buffer.from(await downloadRes.arrayBuffer());

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="PDF_Terkunci.pdf"`);
        res.send(outputBuffer);

    } catch (error) {
        console.error('[encrypt-pdf error]', error);
        res.status(500).send(`Terjadi kesalahan: ${error.message}`);
    }
});

if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`✅ Server berjalan di http://localhost:${PORT}`);
    });
}

module.exports = app;
