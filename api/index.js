const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();

// 1. Konfigurasi CORS Permisif
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Content-Length'],
    exposedHeaders: ['Content-Length', 'Content-Type'],
    credentials: true
}));

// 2. Logic Reverse Proxy dengan Hardening & Spoofing
app.all('*', async (req, res) => {
    // [HARDCODED TARGET]
    // Memaksa semua traffic ke root endpoint, mengabaikan path dari request asli.
    const TARGET_URL = 'https://cloudkuimages.guru/';

    // Handle Preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        // [HEADER SANITIZATION & SPOOFING]
        const headers = {};
        
        // Header yang WAJIB DIBUANG agar tidak terdeteksi sebagai Proxy/Bot
        // 'host': Konflik dengan target
        // 'origin' & 'referer': Membocorkan bahwa request berasal dari Vercel app
        const BLOCKED_HEADERS = ['host', 'origin', 'referer', 'forwarded', 'via', 'x-forwarded-for'];

        Object.keys(req.headers).forEach(key => {
            if (!BLOCKED_HEADERS.includes(key.toLowerCase())) {
                headers[key] = req.headers[key];
            }
        });

        // [USER-AGENT SPOOFING]
        // Menimpa User-Agent agar terlihat seperti Chrome pada Windows 10
        headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
        
        // Pastikan header browser standar ada (opsional tapi membantu trust)
        headers['Accept'] = 'application/json, text/plain, */*';
        headers['Accept-Language'] = 'en-US,en;q=0.9';
        headers['Cache-Control'] = 'no-cache';

        // [REQUEST EXECUTION]
        // Menggunakan stream langsung (req) untuk efisiensi memori dan integritas multipart
        const upstreamResponse = await fetch(TARGET_URL, {
            method: req.method,
            headers: headers,
            body: (req.method !== 'GET' && req.method !== 'HEAD') ? req : undefined,
            redirect: 'follow'
        });

        // [ERROR RESPONSE DEBUGGING]
        // Jika upstream menolak (4xx/5xx), kita BACA body-nya untuk melihat pesan error asli
        if (!upstreamResponse.ok) {
            const errorBody = await upstreamResponse.text(); // Mengambil teks error dari server
            
            console.error('--- UPSTREAM REJECTION DETECTED ---');
            console.error(`Status Code : ${upstreamResponse.status}`);
            console.error(`Target URL  : ${TARGET_URL}`);
            console.error(`Response Body : ${errorBody.substring(0, 500)}...`); // Log max 500 char
            console.error('-----------------------------------');

            // Kembalikan status dan pesan error asli ke frontend
            res.status(upstreamResponse.status);
            res.setHeader('Content-Type', 'text/plain'); // Atau application/json tergantung respon asli
            return res.send(errorBody);
        }

        // [SUCCESS HANDLING]
        // Salin header aman kembali ke client
        upstreamResponse.headers.forEach((value, key) => {
            const lowerKey = key.toLowerCase();
            if (!lowerKey.startsWith('access-control-') && lowerKey !== 'content-encoding') {
                res.setHeader(key, value);
            }
        });

        res.status(upstreamResponse.status);
        upstreamResponse.body.pipe(res);

    } catch (error) {
        console.error('[GATEWAY INTERNAL ERROR]:', error);
        if (!res.headersSent) {
            res.status(502).json({
                error: 'Gateway Error',
                message: 'Connection failed internally within the proxy.',
                details: error.message
            });
        }
    }
});

module.exports = app;

// [CRITICAL CONFIGURATION]
// Mematikan Body Parser Vercel agar Stream Multipart tidak rusak/dikonsumsi
module.exports.config = {
    api: {
        bodyParser: false,
    },
};


