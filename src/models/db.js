// src/models/db.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// 프로젝트 루트 경로에 database.sqlite 파일 생성
const dbPath = path.resolve(__dirname, '../../database.sqlite');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ DB 연결 실패:', err.message);
    } else {
        console.log('📦 SQLite DB 연결 성공:', dbPath);
    }
});

// 테이블 초기화 (서버 실행 시 자동 생성)
db.serialize(() => {
    // 범용 수집 테이블
    db.run(`
        CREATE TABLE IF NOT EXISTS scraped_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_name TEXT,
            content TEXT,
            source_url TEXT,
            collected_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
});

module.exports = db;