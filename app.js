// app.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');

// 컨트롤러 불러오기
const housingController = require('./src/controllers/housingController');

const app = express();
const PORT = 3000;

// --- 1. 공통 미들웨어 ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { success: false, message: "요청 횟수 초과" }
});
app.use('/api', limiter);

// --- 2. 라우팅 (직관적인 네이밍 적용) ---
// URL 경로의 마지막 단어(resource)와 컨트롤러 메소드명이 일치합니다.

// [임대] GET /api/housing/rental
app.get('/api/housing/rental', housingController.getRental);

// [청약] GET /api/housing/subscription
app.get('/api/housing/subscription', housingController.getSubscription);

// [매매] GET /api/housing/sale
app.get('/api/housing/sale', housingController.getSale);


// [범용 수집 API]
app.post('/api/universal/collect', housingController.collectUniversal);
// [범용 조회 API]
app.get('/api/universal/view', housingController.viewUniversal);

// 서버 시작
app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
});