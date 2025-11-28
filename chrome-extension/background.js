// background.js

// [설정] 기본 수집 주기 (분 단위)
const DEFAULT_INTERVAL = 60; 
// [중요] 백엔드 서버 주소
const SERVER_API_URL = "http://localhost:3000/api/universal/collect";
const ALARM_NAME = "universal_scraper_pulse";

// [New] 저장 방식 설정 (true: 서버 전송, false: 로컬 저장)
// 추후 팝업 UI에서 이 값을 storage에 저장하고 불러오는 방식으로 확장 가능
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
        if (logs.length > 200) logs = logs.slice(logs.length - 200);
        chrome.storage.local.set({ system_logs: logs });
    });
}

// -------------------------------------------------------------
// 1. 초기화 및 알람 설정
// -------------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
    log("INFO", "=== 확장프로그램 설치/업데이트됨 ===");
    syncAlarms();
});

chrome.runtime.onStartup.addListener(() => {
    log("INFO", "=== 브라우저 시작됨 ===");
    syncAlarms();
});

chrome.runtime.onMessage.addListener((request) => {
    if (request.type === "SYNC_ALARMS") {
        log("INFO", "🔄 사용자 요청: 알람 동기화");
        syncAlarms();
    }
    // [New] 저장 방식 변경 요청 처리 (UI 연동 대비)
    if (request.type === "UPDATE_STORAGE_MODE") {
        USE_SERVER_STORAGE = request.useServer;
        log("INFO", `저장 방식 변경: ${USE_SERVER_STORAGE ? '서버 전송' : '로컬 저장'}`);
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
                const timeStr = `${now.getHours()}:${String(now.getMinutes()).padStart(2,'0')}`;
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
                    const preview = content.length > 30 ? content.substring(0, 30) + "..." : content;
                    log("INFO", `[STEP 3] 데이터 추출 성공 (${task.name})`, `내용: ${preview}`);
                    
                    // [변경] 설정에 따라 저장 방식 분기 처리
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

        // 테이블 스마트 처리
        if (element.tagName === 'TABLE') {
            const tbody = element.querySelector('tbody');
            if (tbody) { /* tbody 우선 */ }
        }

        let text = element.innerText ? element.innerText.trim() : "";
        if (!text) text = element.textContent ? element.textContent.trim() : "";
        if (!text && element.tagName === 'IMG') text = element.alt || element.src;

        if (!text) {
            return { success: false, error: "Empty Text", meta };
        }

        text = text.replace(/\s+/g, ' ');
        return { success: true, content: text, meta };
    } catch (e) {
        return { 
            success: false, 
            error: `Script Error: ${e.toString()}`, 
            meta: { originalUrl, currentUrl: window.location.href } 
        };
    }
}

/**
 * [New] 데이터 저장 라우팅 (서버 vs 로컬)
 */
function saveData(task, content) {
    if (USE_SERVER_STORAGE) {
        sendDataToServer(task, content);
    } else {
        saveToLocal(task, content);
    }
}

// 1. 서버로 전송
function sendDataToServer(task, content) {
    fetch(SERVER_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            taskName: task.name,
            content: content,
            url: task.url
        })
    })
    .then(res => res.json())
    .then(data => log("INFO", `[STEP 4] 서버 전송 완료 (${task.name})`))
    .catch(err => log("ERROR", `[STEP 4] 서버 전송 실패 (${task.name})`, `${err.message}`));
}

// 2. 로컬(브라우저) 저장
function saveToLocal(task, content) {
    chrome.storage.local.get(['scraped_data'], (result) => {
        let dataList = result.scraped_data || [];
        
        // 중복 검사 (가장 최근 데이터와 비교)
        const myData = dataList.filter(d => d.taskName === task.name);
        const lastData = myData.length > 0 ? myData[myData.length - 1] : null;

        if (lastData && lastData.content === content) {
            log("INFO", `[Skip] 데이터 변경 없음 (${task.name})`);
            return;
        }

        const newEntry = {
            id: Date.now(),
            taskName: task.name,
            url: task.url,
            content: content,
            collectedAt: new Date().toLocaleString('ko-KR')
        };

        dataList.push(newEntry);
        if (dataList.length > 5000) dataList = dataList.slice(dataList.length - 5000);

        chrome.storage.local.set({ scraped_data: dataList }, () => {
            log("INFO", `💾 로컬 저장 완료 (${task.name})`);
        });
    });
}