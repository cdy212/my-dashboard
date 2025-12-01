// background.js

const DEFAULT_INTERVAL = 60; 
const SERVER_API_URL = "http://localhost:3000/api/universal/collect";
const ALARM_NAME = "universal_scraper_pulse";

let USE_SERVER_STORAGE = false; 

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error(error));

function log(level, message, details = null) {
    const now = new Date();
    const timeString = now.toLocaleTimeString('ko-KR', { hour12: false });
    let logEntry = `[${timeString}] [${level}] ${message}`;
    if (details) logEntry += `\n   └─ ${details}`;
    
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
            tasks.forEach(task => {
                chrome.alarms.create(task.id.toString(), { 
                    periodInMinutes: parseInt(task.interval) || DEFAULT_INTERVAL
                });
            });
            log("INFO", `스케줄 등록 완료 (${tasks.length}개)`);
        });
    });
}

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
                chrome.alarms.clear(alarm.name);
            }
        });
    }
});

async function executeScraping(task) {
    const updateStatus = (status) => {
        chrome.storage.local.get(['tasks'], (result) => {
            const tasks = result.tasks || [];
            const idx = tasks.findIndex(t => t.id === task.id);
            if (idx !== -1) {
                const now = new Date();
                tasks[idx].lastStatus = status;
                tasks[idx].lastRunTime = `${now.getHours()}:${String(now.getMinutes()).padStart(2,'0')}`;
                chrome.storage.local.set({ tasks: tasks });
            }
        });
    };

    let tabId = null;
    try {
        log("INFO", `[STEP 1] 작업 시작: ${task.name}`);
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

                if (chrome.runtime.lastError || !results || !results[0] || !results[0].result) {
                    log("ERROR", `스크립트 실행 실패 (${task.name})`);
                    updateStatus('fail');
                    return;
                }

                const { success, content, headers, structure, error, meta } = results[0].result;

                if (meta.currentUrl !== meta.originalUrl) {
                    log("WARN", `[Redirect] ${task.name}`, `이동됨: ${meta.currentUrl}`);
                }

                if (success && content) {
                    let preview = "";
                    if (Array.isArray(content)) preview = `[Items: ${content.length}]`;
                    else preview = content.substring(0, 30);

                    log("INFO", `[STEP 3] 추출 성공 (${task.name})`, `${preview}...`);
                    
                    // [수정] headers와 structure 정보도 함께 전달
                    saveData(task, content, headers, structure);
                    updateStatus('success');
                } else {
                    log("WARN", `[STEP 3] 추출 실패 (${task.name})`, error);
                    updateStatus('fail');
                }
            });
        }, 15000);
    } catch (e) {
        log("ERROR", `시스템 오류 (${task.name})`, e.toString());
        if (tabId) chrome.tabs.remove(tabId).catch(() => {});
        updateStatus('fail');
    }
}

function extractDataFromPage(selector, originalUrl) {
    try {
        const currentUrl = window.location.href;
        const title = document.title;
        const meta = { originalUrl, currentUrl, title };

        const element = document.querySelector(selector);
        if (!element) return { success: false, error: "Element Not Found", meta };

        let content = null;
        let headers = null;
        let structure = 'text';

        const tagName = element.tagName;

        // 1. 테이블 처리
        if (['TABLE', 'TBODY', 'THEAD'].includes(tagName)) {
            structure = 'table';
            let table = tagName === 'TABLE' ? element : element.closest('table');
            
            // [New] 헤더 추출
            const thead = table ? table.querySelector('thead') : null;
            if (thead) {
                headers = Array.from(thead.querySelectorAll('th')).map(th => th.innerText.trim());
            }

            const tbody = table ? (table.querySelector('tbody') || table) : element;
            const trs = tbody.querySelectorAll('tr');
            
            let rows = [];
            trs.forEach((tr, idx) => {
                // 헤더가 없고 첫 줄이 th라면 헤더로 간주
                if (!headers && idx === 0 && tr.querySelector('th')) {
                    headers = Array.from(tr.querySelectorAll('th')).map(th => th.innerText.trim());
                    return;
                }
                // 이미 헤더를 찾았는데 또 th 행이면 스킵 (중복 방지)
                if (headers && idx === 0 && tr.querySelector('th')) return;

                const cells = tr.querySelectorAll('td');
                if (cells.length > 0) {
                    let cellData = [];
                    cells.forEach(td => {
                        let text = td.innerText.trim().replace(/[\s\n\t]+/g, ' ');
                        let link = null;
                        const a = td.querySelector('a');
                        if (a && a.href) {
                            link = a.href;
                            if (link.startsWith('/')) link = window.location.origin + link;
                        }
                        cellData.push({ text, link });
                    });
                    rows.push(cellData);
                }
            });
            content = rows;
        }
        // 2. 리스트 처리
        else if (['UL', 'OL'].includes(tagName)) {
            structure = 'list';
            let listItems = [];
            const lis = element.querySelectorAll('li');
            lis.forEach(li => {
                let text = li.innerText.trim().replace(/[\s\n\t]+/g, ' ');
                let link = null;
                const a = li.querySelector('a');
                if (a && a.href) {
                    link = a.href;
                    if (link.startsWith('/')) link = window.location.origin + link;
                }
                if (text) listItems.push({ text, link });
            });
            content = listItems;
        }
        // 3. 일반 텍스트
        else {
            let text = element.innerText ? element.innerText.trim() : "";
            if (!text) text = element.textContent ? element.textContent.trim() : "";
            if (!text && element.tagName === 'IMG') text = element.alt || element.src;
            
            if (!text) return { success: false, error: "Empty Text", meta };
            content = text.replace(/[\s\n\t]+/g, ' ');
        }

        return { success: true, content, headers, structure, meta };
    } catch (e) {
        return { success: false, error: e.toString(), meta: { originalUrl, currentUrl: window.location.href } };
    }
}

function saveData(task, content, headers, structure) {
    if (USE_SERVER_STORAGE) {
        sendDataToServer(task, content, headers, structure);
    } else {
        saveToLocal(task, content, headers, structure);
    }
}

function sendDataToServer(task, content, headers, structure) {
    const payload = JSON.stringify({ content, headers, structure });
    fetch(SERVER_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            taskName: task.name,
            content: payload,
            url: task.url
        })
    })
    .then(res => res.json())
    .then(data => log("INFO", `[STEP 4] 서버 전송 완료`))
    .catch(err => log("ERROR", `[STEP 4] 서버 전송 실패`, err.message));
}

function saveToLocal(task, content, headers, structure) {
    chrome.storage.local.get(['scraped_data'], (result) => {
        let dataList = result.scraped_data || [];
        
        // 중복 검사 로직 (기존 유지)
        const existingItems = dataList.filter(d => d.taskName === task.name);
        const existingKeys = new Set();
        existingItems.forEach(item => {
            if (Array.isArray(item.content)) {
                item.content.forEach(row => {
                    if (Array.isArray(row)) { // 2D
                        const firstCell = row[0];
                        const key = (typeof firstCell === 'object') ? (firstCell.link || firstCell.text) : firstCell;
                        existingKeys.add(key);
                    } else { // 1D
                        const key = (row.link || row.text || row);
                        existingKeys.add(key);
                    }
                });
            } else {
                existingKeys.add(item.content);
            }
        });

        let newItems = [];
        
        if (Array.isArray(content)) {
            newItems = content.filter(row => {
                let key = '';
                if (Array.isArray(row)) {
                    const firstCell = row[0];
                    key = (typeof firstCell === 'object') ? (firstCell.link || firstCell.text) : firstCell;
                } else {
                    key = (row.link || row.text || row);
                }
                return !existingKeys.has(key);
            });
        } else {
            if (!existingKeys.has(content)) newItems = content;
        }

        if (!newItems || (Array.isArray(newItems) && newItems.length === 0)) {
            log("INFO", `[Skip] 데이터 변경 없음 (${task.name})`);
            return;
        }

        // [New] 신규 데이터 생성 (headers, structure, isNew 포함)
        const newEntry = {
            id: Date.now(),
            taskName: task.name,
            url: task.url,
            content: newItems,
            headers: headers,
            structure: structure,
            isNew: true, // 신규 표시용 플래그
            collectedAt: new Date().toLocaleString('ko-KR')
        };

        dataList.push(newEntry);
        if (dataList.length > 5000) dataList = dataList.slice(dataList.length - 5000);

        chrome.storage.local.set({ scraped_data: dataList }, () => {
            const count = Array.isArray(newItems) ? newItems.length : 1;
            log("INFO", `💾 로컬 저장 완료 (${task.name}) - 신규 ${count}건`);
        });
    });
}