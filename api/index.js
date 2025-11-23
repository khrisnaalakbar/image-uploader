const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();

// 1. Konfigurasi CORS
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Content-Length'],
    exposedHeaders: ['Content-Length', 'Content-Type'],
    credentials: true
}));

// 2. Proxy Logic
app.all('*', async (req, res) => {
    // URL Target Hulu
    // Catatan: Kami menambahkan req.url (path + query string) agar routing sub-path tetap terjaga
    const BASE_URL = 'https://cloudkuimages.guru';
    const targetUrl = BASE_URL + req.url;

    // Handle Preflight Request (OPTIONS)
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        // --- PERSIAPAN HEADERS ---
        // Kita harus menyalin headers secara selektif.
        // 'host' harus dihapus agar tidak konflik dengan Vercel/Target.
        // 'content-length' dan 'content-type' SANGAT KRUSIAL untuk multipart upload.
        const headers = {};
        
        Object.keys(req.headers).forEach(key => {
            const lowerKey = key.toLowerCase();
            if (lowerKey !== 'host') {
                headers[key] = req.headers[key];
            }
        });

        // --- REQUEST KE UPSTREAM ---
        // Karena bodyParser dimatikan di config bawah, 'req' adalah stream murni.
        // Kita pipe langsung ke node-fetch.
        const upstreamResponse = await fetch(targetUrl, {
            method: req.method,
            headers: headers,
            body: (req.method !== 'GET' && req.method !== 'HEAD') ? req : undefined,
            // Jangan follow redirect otomatis untuk POST/PUT agar status code asli terjaga
            redirect: 'manual' 
        });

        // --- HANDLING RESPONSE DARI UPSTREAM ---
        
        // 1. Error Logging untuk Debugging di Vercel Logs
        if (!upstreamResponse.ok) {
            console.error(`[Upstream Error] ${upstreamResponse.status} ${upstreamResponse.statusText}`);
            console.error(`[Target] ${targetUrl}`);
        }

        // 2. Salin Header Response ke Client
        upstreamResponse.headers.forEach((value, key) => {
            // Hindari duplikasi header CORS atau transfer-encoding chunked yang bisa konflik
            if (key.toLowerCase() !== 'content-encoding' && 
                !key.toLowerCase().startsWith('access-control-')) {
                res.setHeader(key, value);
            }
        });

        // 3. Teruskan Status Code Asli
        // Ini penting agar frontend tahu bedanya 400 (Bad Request) vs 413 (Too Large) vs 500
        res.status(upstreamResponse.status);

        // 4. Pipe Body Response
        upstreamResponse.body.pipe(res);

    } catch (error) {
        console.error('[Gateway Critical Error]:', error);
        
        // Error jaringan level bawah (DNS failure, Connection Refused, dll)
        if (!res.headersSent) {
            res.status(502).json({
                error: 'Gateway Error',
                message: 'Failed to establish connection to upstream server.',
                details: error.message
            });
        }
    }
});

// Export aplikasi Express
module.exports = app;

// --- KONFIGURASI VERCEL (CRITICAL FIX) ---
// Ini memerintahkan Vercel untuk TIDAK melakukan parsing pada body request.
// Tanpa ini, upload multipart akan corrupt atau kosong karena sudah "dikonsumsi" oleh middleware Vercel.
module.exports.config = {
    api: {
        bodyParser: false,
    },
};

