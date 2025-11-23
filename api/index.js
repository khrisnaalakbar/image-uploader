const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();

// 1. Konfigurasi CORS Permisif
// Mengizinkan semua origin (*) untuk menyelesaikan masalah 'Connection Refused/CORS' di frontend
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
    credentials: true
}));

// 2. Reverse Proxy Logic
// Menangkap semua request ke root atau sub-path
app.all('*', async (req, res) => {
    // Target endpoint upstream
    const TARGET_URL = 'https://cloudkuimages.guru/';

    // Menangani Preflight Request secara instan agar tidak diteruskan ke upstream
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        // Filter header: Hapus 'host' agar tidak konflik dengan target host
        // Salin header penting seperti 'content-type' (penting untuk boundary multipart)
        const headers = {};
        Object.keys(req.headers).forEach(key => {
            if (key.toLowerCase() !== 'host' && key.toLowerCase() !== 'content-length') {
                headers[key] = req.headers[key];
            }
        });

        // Forward request ke Cloudkuimages
        // Kita passing 'req' langsung sebagai body stream untuk efisiensi memori
        // dan menjaga integritas multipart boundary.
        const upstreamResponse = await fetch(TARGET_URL, {
            method: req.method,
            headers: headers,
            body: (req.method !== 'GET' && req.method !== 'HEAD') ? req : undefined
        });

        // Salin header respons dari upstream kembali ke client (frontend)
        upstreamResponse.headers.forEach((value, key) => {
            // Hapus header CORS dari upstream jika ada, agar tidak konflik dengan CORS proxy kita
            if (!key.toLowerCase().startsWith('access-control-')) {
                res.setHeader(key, value);
            }
        });

        // Set status code sesuai respons asli
        res.status(upstreamResponse.status);

        // Pipe body respons (stream) kembali ke client
        upstreamResponse.body.pipe(res);

    } catch (error) {
        console.error('Gateway Error:', error);
        // Fallback error handling
        if (!res.headersSent) {
            res.status(502).json({ 
                error: 'Bad Gateway', 
                message: 'Failed to communicate with upstream server.',
                details: error.message 
            });
        }
    }
});

// Export app agar Vercel dapat menjalankannya sebagai Serverless Function
module.exports = app;

