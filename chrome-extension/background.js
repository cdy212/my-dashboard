// background.js

// [설정] 기본 수집 주기 (분 단위)
const DEFAULT_INTERVAL = 60; 
// [중요] 백엔드 서버 주소
const SERVER_API_URL = "http://localhost:3000/api/universal/collect";
const ALARM_NAME = "universal_scraper_pulse";

// [New] 저장 방식 설정 (true: 서버 전송, false: 로컬 저장)
let USE_SERVER_STORAGE = false; 

// 아이콘 클릭 시 사이드 패널 열기
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error(error));

/**
 * [Logger] 시스템 로그 저장 함수
 */
function log(level, message, details = null) {
    const now = new Date();
    const timeString = now.toLocaleTimeString('ko-KR', { hour12: false });
    
    let logEntry = `[${timeString}] [${level}] ${message}`;
    if (details) {
        logEntry += `\n   └─ ${details}`;
    }
    
    if (level === 'ERROR') console.error(logEntry);
    else if (level === 'WARN') console.warn(logEntry);
    else console.log(logEntry);

    chrome.storage.local.get(['system_logs'], (result) => {
        let logs = result.system_logs || [];
        logs.push(logEntry);
        if (logs.length > 100) logs = logs.slice(logs.length - 100);
        chrome.storage.local.set({ system_logs: logs });
    });
}

// -------------------------------------------------------------
// 1. 초기화 및 알람 설정
// -------------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
    log("INFO", "=== 확장프로그램 설치/업데이트됨 ===");
    loadStorageSetting();
    syncAlarms();
});

chrome.runtime.onStartup.addListener(() => {
    log("INFO", "=== 브라우저 시작됨 ===");
    loadStorageSetting();
    syncAlarms();
});

function loadStorageSetting() {
    chrome.storage.local.get(['useServer'], (result) => {
        USE_SERVER_STORAGE = result.useServer || false;
        log("INFO", `저장 모드 초기화: ${USE_SERVER_STORAGE ? '서버 전송' : '로컬 저장'}`);
    });
}

chrome.runtime.onMessage.addListener((request) => {
    if (request.type === "SYNC_ALARMS") {
        log("INFO", "🔄 사용자 요청: 알람 동기화");
        syncAlarms();
    }
    if (request.type === "UPDATE_STORAGE_MODE") {
        USE_SERVER_STORAGE = request.useServer;
        log("INFO", `저장 모드 변경됨 -> ${USE_SERVER_STORAGE ? '서버 전송' : '로컬 저장'}`);
    }
});

function syncAlarms() {
    chrome.alarms.clearAll(() => {
        chrome.storage.local.get(['tasks'], (result) => {
            const tasks = result.tasks || [];
            if (tasks.length === 0) {
                log("INFO", "대기 중인 작업 없음");
                return;
            }
            tasks.forEach(task => {
                chrome.alarms.create(task.id.toString(), { 
                    periodInMinutes: parseInt(task.interval) || DEFAULT_INTERVAL
                });
                log("INFO", `스케줄 등록: ${task.name} (${task.interval}분 주기)`);
            });
        });
    });
}

// -------------------------------------------------------------
// 2. 알람 실행 핸들러
// -------------------------------------------------------------

chrome.alarms.onAlarm.addListener((alarm) => {
    const taskId = parseInt(alarm.name);
    if (!isNaN(taskId)) {
        chrome.storage.local.get(['tasks'], (result) => {
            const tasks = result.tasks || [];
            const task = tasks.find(t => t.id === taskId);

            if (task) {
                log("INFO", `⏰ 알람 실행: ${task.name}`);
                executeScraping(task);
            } else {
                log("WARN", `삭제된 작업 알람 정리 (ID: ${taskId})`);
                chrome.alarms.clear(alarm.name);
            }
        });
    }
});

// -------------------------------------------------------------
// 3. 스크래핑 엔진
// -------------------------------------------------------------

async function executeScraping(task) {
    const updateStatus = (status) => {
        chrome.storage.local.get(['tasks'], (result) => {
            const tasks = result.tasks || [];
            const idx = tasks.findIndex(t => t.id === task.id);
            if (idx !== -1) {
                const now = new Date();
                const timeStr = `${now.getHours()}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
                tasks[idx].lastStatus = status;
                tasks[idx].lastRunTime = timeStr;
                chrome.storage.local.set({ tasks: tasks });
            }
        });
    };

    let tabId = null;

    try {
        log("INFO", `[STEP 1] 작업 시작: ${task.name} (${task.url})`);
        
        const tab = await chrome.tabs.create({ url: task.url, active: false });
        tabId = tab.id;

        setTimeout(() => {
            if (!tabId) return;

            chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: extractDataFromPage,
                args: [task.selector, task.url]
            }, (results) => {
                chrome.tabs.remove(tabId).catch(() => {});

                if (chrome.runtime.lastError) {
                    log("ERROR", `[STEP 2] 스크립트 주입 실패 (${task.name})`, chrome.runtime.lastError.message);
                    updateStatus('fail');
                    return;
                }

                if (!results || !results[0] || !results[0].result) {
                    log("ERROR", `[STEP 2] 결과 반환 실패 (${task.name})`, "페이지 로드 불가 또는 차단됨");
                    updateStatus('fail');
                    return;
                }

                const { success, content, error, meta } = results[0].result;

                if (meta.currentUrl !== meta.originalUrl) {
                    log("WARN", `[Check] 리다이렉트 감지 (${task.name})`, 
                        `요청: ${meta.originalUrl}\n   └─ 실제: ${meta.currentUrl}`);
                }

                if (success && content) {
                    // 미리보기 로그
                    let preview = "";
                    if(Array.isArray(content)) preview = `[Items: ${content.length}] ` + (content[0].text || JSON.stringify(content[0]));
                    else preview = content.substring(0, 30);

                    log("INFO", `[STEP 3] 데이터 추출 성공 (${task.name})`, `내용: ${preview}...`);
                    
                    // 저장 실행 (중복 제거 로직 포함)
                    saveData(task, content);
                    
                    updateStatus('success');
                } else {
                    log("WARN", `[STEP 3] 추출 실패 (${task.name})`, 
                        `원인: ${error}\n   └─ Selector: ${task.selector}`);
                    updateStatus('fail');
                }
            });
        }, 15000);

    } catch (e) {
        log("ERROR", `[System] 실행 오류 (${task.name})`, e.toString());
        if (tabId) chrome.tabs.remove(tabId).catch(() => {});
        updateStatus('fail');
    }
}

function extractDataFromPage(selector, originalUrl) {
    try {
        const currentUrl = window.location.href;
        const title = document.title;
        const width = window.innerWidth;
        const meta = { originalUrl, currentUrl, title, width };

        const element = document.querySelector(selector);
        
        if (!element) {
            return { success: false, error: "Element Not Found", meta };
        }

        let content = null;

        // [Smart Processing] Table/List 구조적 추출 (Link 포함)
        const tagName = element.tagName;
        if (['TABLE', 'TBODY', 'THEAD', 'UL', 'OL'].includes(tagName)) {
            let rows = [];
            
            let children = element.querySelectorAll(tagName === 'UL' || tagName === 'OL' ? 'li' : 'tr');
            if (children.length === 0 && tagName === 'TABLE') {
                const tbody = element.querySelector('tbody');
                if (tbody) children = tbody.querySelectorAll('tr');
            }

            if (children.length > 0) {
                children.forEach(row => {
                    let rowText = row.innerText.trim().replace(/[\s\n\t]+/g, ' ');
                    if (rowText) {
                        let rowLink = null;
                        const anchor = row.querySelector('a');
                        if (anchor && anchor.href) {
                            rowLink = anchor.href;
                            if (rowLink.startsWith('/')) rowLink = window.location.origin + rowLink;
                        }
                        // 구조화된 데이터 (텍스트, 링크)
                        rows.push({ text: rowText, link: rowLink });
                    }
                });
                content = rows; // 배열 반환
            }
        }

        if (!content) {
            let text = element.innerText ? element.innerText.trim() : "";
            if (!text) text = element.textContent ? element.textContent.trim() : "";
            if (!text && element.tagName === 'IMG') text = element.alt || element.src;
            
            if (!text) return { success: false, error: "Empty Text", meta };
            content = text.replace(/[\s\n\t]+/g, ' ');
        }

        return { success: true, content: content, meta };
    } catch (e) {
        return { 
            success: false, 
            error: `Script Error: ${e.toString()}`, 
            meta: { originalUrl, currentUrl: window.location.href } 
        };
    }
}

/**
 * [라우팅] 저장 방식 결정 함수
 */
function saveData(task, content) {
    if (USE_SERVER_STORAGE) {
        sendDataToServer(task, content);
    } else {
        saveToLocal(task, content);
    }
}

// 1. 서버 전송
function sendDataToServer(task, content) {
    fetch(SERVER_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            taskName: task.name,
            content: typeof content === 'object' ? JSON.stringify(content) : content,
            url: task.url
        })
    })
    .then(res => res.json())
    .then(data => log("INFO", `[STEP 4] 서버 전송 완료 (${task.name})`))
    .catch(err => log("ERROR", `[STEP 4] 서버 전송 실패 (${task.name})`, `${err.message}`));
}

// 2. 로컬 저장 (중복 제거 로직 적용)
function saveToLocal(task, content) {
    chrome.storage.local.get(['scraped_data'], (result) => {
        let dataList = result.scraped_data || [];
        
        // [Deduplication] 중복 제거 로직
        // 기존에 저장된 해당 작업(Task)의 데이터들을 확인하여 이미 있는 내용인지 검사
        const existingItems = dataList.filter(d => d.taskName === task.name);
        
        // 중복 판단을 위한 Set 생성 (Link가 있으면 Link로, 없으면 Text로)
        const existingKeys = new Set();
        existingItems.forEach(item => {
            if (Array.isArray(item.content)) {
                item.content.forEach(row => {
                    if(row.link) existingKeys.add(row.link);
                    else if(row.text) existingKeys.add(row.text);
                });
            } else {
                existingKeys.add(item.content);
            }
        });

        let newItems = [];
        
        // 수집된 콘텐츠가 배열(리스트/테이블)인 경우 -> 개별 항목 비교
        if (Array.isArray(content)) {
            // 이미 존재하는 키(Link/Text)가 없는 항목만 필터링
            const filteredContent = content.filter(row => {
                const key = row.link || row.text;
                return !existingKeys.has(key);
            });

            if (filteredContent.length > 0) {
                // 새로운 항목들만 모아서 저장
                newItems = filteredContent;
            }
        } 
        // 단일 텍스트인 경우 -> 통째로 비교
        else {
            if (!existingKeys.has(content)) {
                newItems = content;
            }
        }

        // 저장할 새로운 데이터가 없다면 종료
        if (newItems.length === 0 || (Array.isArray(newItems) && newItems.length === 0)) {
            log("INFO", `[Skip] 중복 데이터 제외됨 (신규 항목 없음)`);
            return;
        }

        // 새로운 항목만 저장
        const newEntry = {
            id: Date.now(),
            taskName: task.name,
            url: task.url,
            content: newItems, // 필터링된 '신규' 데이터만 저장
            collectedAt: new Date().toLocaleString('ko-KR')
        };

        dataList.push(newEntry);
        
        // 용량 관리 (최신 5000건)
        if (dataList.length > 5000) dataList = dataList.slice(dataList.length - 5000);

        chrome.storage.local.set({ scraped_data: dataList }, () => {
            const count = Array.isArray(newItems) ? newItems.length : 1;
            log("INFO", `💾 로컬 저장 완료 (${task.name}) - 신규 ${count}건`);
        });
    });
}