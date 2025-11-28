// src/controllers/housingController.js
const axios = require('axios');
const cheerio = require('cheerio');
const NodeCache = require('node-cache');
const db = require('../models/db'); // [Fix] DB 모듈 임포트 추가
const { success, error } = require('../utils/apiResponse');

const myCache = new NodeCache({ stdTTL: 3600 });

/**
 * [공통 함수] SH 데이터 스크래핑
 */
async function fetchSHData(url, label) {
    try {
        const response = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const $ = cheerio.load(response.data);
        const parsedList = [];
        const rows = $('tbody tr');

        rows.each((i, elem) => {
            if ($(elem).find('td.no_data').length > 0 || $(elem).text().includes('조회된 게시물이 없습니다')) return false;
            if (i > 50) return false;

            let titleElement = $(elem).find('td.tit a');
            if (titleElement.length === 0) titleElement = $(elem).find('td.subject a');
            if (titleElement.length === 0) titleElement = $(elem).find('a').first();

            const title = titleElement.text().trim();
            const rawHref = titleElement.attr('href') || '';
            const onClick = titleElement.attr('onclick') || '';
            let date = $(elem).find('td').eq(4).text().trim();
            if (!date) date = $(elem).find('td:nth-last-child(2)').text().trim();

            let finalLink = '#';
            if (rawHref && rawHref.includes('view.do')) {
                if (rawHref.startsWith('.')) finalLink = `https://www.i-sh.co.kr/main/lay2/program/S1T297C4476/www/brd/m_247/${rawHref.substring(2)}`;
                else finalLink = `https://www.i-sh.co.kr${rawHref}`;
            } else if (onClick) {
                const seqMatch = onClick.match(/['"]([0-9]+)['"]/);
                if (seqMatch) finalLink = `https://www.i-sh.co.kr/main/lay2/program/S1T297C4476/www/brd/m_247/view.do?seq=${seqMatch[1]}`;
            } else if (rawHref) {
                finalLink = rawHref.startsWith('http') ? rawHref : `https://www.i-sh.co.kr${rawHref}`;
            }

            if (title && finalLink !== '#') {
                parsedList.push({
                    category: label,
                    type: $(elem).find('.al_Left').text().trim() || '공고',
                    title: title,
                    period: date,
                    link: finalLink
                });
            }
        });
        return parsedList;
    } catch (err) {
        console.error(`[Scraping Error] ${label}: ${err.message}`);
        return [];
    }
}

/**
 * [API] GET /api/housing/rental
 * 기능: SH 임대주택 실시간 조회 (기존 기능 유지)
 */
exports.getRental = async (req, res) => {
    try {
        const itmSeq1 = req.query.itm_seq_1 !== undefined ? req.query.itm_seq_1 : '0';
        const recrnotiState = req.query.recrnotiState !== undefined ? req.query.recrnotiState : 'now';
        const isRefresh = req.query.refresh === 'true';

        console.log(`\n[Rental] 조회 요청: 구분[${itmSeq1}], 상태[${recrnotiState}], 새로고침[${isRefresh}]`);

        const cacheKey = `rental_split_${itmSeq1}_${recrnotiState}`;
        const cachedData = myCache.get(cacheKey);

        if (!isRefresh && cachedData) {
            console.log(`[Rental] 캐시 적중!`);
            return success(res, cachedData, "캐시 데이터 반환", "cache");
        }

        let recruitParam = '';
        if (itmSeq1 === '1' || recrnotiState !== '') {
            recruitParam = '&isRecrnoti=Y';
        }

        const baseUrl = "https://www.i-sh.co.kr/main/lay2/program/S1T297C4476/www/brd/m_247/list.do";
        const commonParams = `multi_itm_seq=2&itm_seq_1=${itmSeq1}${recruitParam}&recrnotiState=${recrnotiState}`;

        const urlHappy = `${baseUrl}?${commonParams}&notType1=2&splyTy=07`;
        const urlLong = `${baseUrl}?${commonParams}&notType1=2&splyTy=03`;

        const [happyList, longList] = await Promise.all([
            fetchSHData(urlHappy, '행복주택'),
            fetchSHData(urlLong, '장기전세')
        ]);

        console.log(`[Rental] 조회 완료: 행복(${happyList.length}), 장기(${longList.length})`);

        const resultData = {
            happy: happyList,
            long: longList
        };

        myCache.set(cacheKey, resultData);
        return success(res, resultData, "분리 조회 성공", "live");

    } catch (err) {
        console.error(err);
        return error(res, "임대 공고 조회 실패");
    }
};

/**
 * [API] GET /api/housing/subscription
 * 기능: 청약 조회 (기존 기능 유지)
 */
exports.getSubscription = async (req, res) => {
    try {
        const cachedData = myCache.get("subscription");
        if (cachedData) return success(res, cachedData, "캐시 반환", "cache");

        const targetUrl = "https://www.i-sh.co.kr/main/lay2/program/S1T297C4476/www/brd/m_247/list.do?multi_itm_seq=1&itm_seq_1=0&isRecrnoti=Y&recrnotiState=now";
        const response = await axios.get(targetUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $ = cheerio.load(response.data);
        const dataList = [];

        $('tbody tr').each((i, elem) => {
            if (i > 5) return false;
            let titleElement = $(elem).find('td.tit a');
            const title = titleElement.text().trim();
            const rawHref = titleElement.attr('href') || '';
            const onClick = titleElement.attr('onclick') || '';
            const type = $(elem).find('.al_Left').text().trim() || '분양';
            const date = $(elem).find('td').eq(4).text().trim();

            let finalLink = '#';
            if (rawHref && rawHref.includes('view.do')) {
                 finalLink = rawHref.startsWith('http') ? rawHref : `https://www.i-sh.co.kr${rawHref.startsWith('/') ? '' : '/'}${rawHref}`;
            } else if (onClick) {
                const seqMatch = onClick.match(/['"]([0-9]+)['"]/);
                if (seqMatch) finalLink = `https://www.i-sh.co.kr/main/lay2/program/S1T297C4476/www/brd/m_247/view.do?seq=${seqMatch[1]}`;
            }

            if (title && finalLink !== '#') {
                dataList.push({ id: i, category: 'subscription', type: type, title: title, period: date, link: finalLink });
            }
        });

        myCache.set("subscription", dataList, 1800);
        return success(res, dataList, "청약 조회 성공", "live");
    } catch (err) {
        return error(res, "청약 조회 실패");
    }
};

/**
 * [범용] 데이터 수집 (확장프로그램에서 호출)
 */
exports.collectUniversal = (req, res) => {
    const { taskName, content, url } = req.body;
    
    // 간단한 중복 방지 (가장 최근 데이터와 내용 비교)
    db.get(`SELECT content FROM scraped_items WHERE task_name = ? ORDER BY id DESC LIMIT 1`, [taskName], (err, row) => {
        if (err) {
            console.error("[DB Error]", err);
            return error(res, "DB 조회 오류");
        }

        if (row && row.content === content) {
            console.log(`[Skip] ${taskName}: 데이터 변경 없음`);
            return success(res, null, "데이터 변경 없음");
        }

        const stmt = db.prepare(`INSERT INTO scraped_items (task_name, content, source_url) VALUES (?, ?, ?)`);
        stmt.run(taskName, content, url, function(err) {
            if (err) {
                console.error("[DB Insert Error]", err);
                return error(res, "데이터 저장 실패");
            }
            console.log(`[Save] ${taskName}: 신규 데이터 저장 완료 (ID: ${this.lastID})`);
            stmt.finalize();
            return success(res, { taskName }, "저장 성공");
        });
    });
};

/**
 * [범용] 데이터 조회
 */
exports.viewUniversal = (req, res) => {
    db.all(`SELECT * FROM scraped_items ORDER BY collected_at DESC LIMIT 50`, [], (err, rows) => {
        if (err) return error(res, "DB Error");
        return success(res, rows, "조회 성공");
    });
};

exports.getSale = async (req, res) => { return success(res, [], "준비중"); };