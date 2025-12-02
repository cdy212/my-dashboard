document.addEventListener('DOMContentLoaded', () => {
    restoreDraft();
    loadTasks();
    loadSettings(); // [Mod] 여기서 기본 설정을 불러와 입력창에 셋팅
    updateDataCount();
});

// 설정 메뉴 토글 기능
document.getElementById('toggleSettingsBtn').addEventListener('click', () => {
    const content = document.getElementById('settingsContent');
    const arrow = document.getElementById('settingsArrow');
    
    if (content.style.display === 'block') {
        content.style.display = 'none';
        arrow.innerText = '▼';
    } else {
        content.style.display = 'block';
        arrow.innerText = '▲';
    }
});

// [수집 데이터 확인] 전체 화면 뷰어 열기
document.getElementById('openViewerBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: 'viewer.html' });
});

// [전체 데이터 삭제]
document.getElementById('clearDataBtn').addEventListener('click', () => {
    if (confirm("정말 수집된 모든 데이터를 삭제하시겠습니까?\n(작업 설정은 유지됩니다)")) {
        chrome.storage.local.remove('scraped_data', () => {
            alert("모든 수집 데이터가 삭제되었습니다.");
            updateDataCount();
        });
    }
});

function updateDataCount() {
    chrome.storage.local.get(['scraped_data'], (result) => {
        document.getElementById('dataCount').textContent = result.scraped_data ? result.scraped_data.length : 0;
    });
}

// --- [설정 로드 및 저장] ---
function loadSettings() {
    chrome.storage.local.get(['intervalMin', 'useServer'], (result) => {
        const globalDefaultInterval = result.intervalMin || 60;
        
        // 1. 환경 설정(Accordion 안) Input 셋팅
        document.getElementById('intervalInput').value = globalDefaultInterval;
        
        // 2. [Fix] '3. 주기' 입력창에 환경 설정값을 '기본값'으로 셋팅
        // 단, 이미 사용자가 draft로 입력해둔 값이 있다면 덮어쓰지 않음
        const currentTaskInterval = document.getElementById('interval').value;
        if (!currentTaskInterval) {
            document.getElementById('interval').value = globalDefaultInterval;
        }

        const useServer = result.useServer || false;
        document.getElementById('useServerCheck').checked = useServer;
    });
}

document.getElementById('saveIntervalBtn').addEventListener('click', () => {
    const minutes = parseInt(document.getElementById('intervalInput').value);
    if (!minutes || minutes < 1) return alert("1분 이상 입력해주세요.");

    chrome.storage.local.set({ intervalMin: minutes }, () => {
        chrome.runtime.sendMessage({ type: "UPDATE_ALARM", interval: minutes }); 
        
        // [Fix] 환경 설정을 변경하면, 현재 작성 중인 주기 입력창에도 반영해줄지 사용자 편의 고려
        // (작성 중인 내용이 없을 때만 반영)
        if(document.getElementById('interval').value === '') {
            document.getElementById('interval').value = minutes;
        }
        
        alert(`기본 주기가 ${minutes}분으로 설정되었습니다.\n(신규 작업 작성 시 기본값으로 적용됩니다)`);
    });
});

document.getElementById('useServerCheck').addEventListener('change', (e) => {
    const isChecked = e.target.checked;
    chrome.storage.local.set({ useServer: isChecked }, () => {
        chrome.runtime.sendMessage({ 
            type: "UPDATE_STORAGE_MODE", 
            useServer: isChecked 
        });
    });
});

// --- [입력값 임시 저장/복구] ---
function saveDraft() {
    const draft = {
        name: document.getElementById('taskName').value,
        url: document.getElementById('targetUrl').value,
        keyword: document.getElementById('keyword').value,
        interval: document.getElementById('interval').value // [New] 주기 값도 임시 저장
    };
    chrome.storage.local.set({ 'draftInput': draft });
}

function restoreDraft() {
    chrome.storage.local.get(['draftInput'], (result) => {
        if (result.draftInput) {
            document.getElementById('taskName').value = result.draftInput.name || '';
            document.getElementById('targetUrl').value = result.draftInput.url || '';
            document.getElementById('keyword').value = result.draftInput.keyword || '';
            if (result.draftInput.interval) {
                document.getElementById('interval').value = result.draftInput.interval;
            }
        }
    });
}

['taskName', 'targetUrl', 'interval', 'keyword'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.addEventListener('input', saveDraft);
});

// --- [선택자 피커 메시지 수신] ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "SELECTOR_PICKED") {
        const selectorInput = document.getElementById('selector');
        const urlInput = document.getElementById('targetUrl');
        const nameInput = document.getElementById('taskName');

        selectorInput.value = request.selector;
        urlInput.value = request.url;

        if (request.title) {
            chrome.storage.local.get(['tasks'], (result) => {
                const tasks = result.tasks || [];
                let baseName = request.title.trim();
                let finalName = baseName;
                let counter = 1;
                while (tasks.some(t => t.name === finalName)) {
                    finalName = `${baseName} (${counter})`;
                    counter++;
                }
                nameInput.value = finalName;
                
                [selectorInput, urlInput, nameInput].forEach(input => {
                    input.style.transition = "background-color 0.3s";
                    input.style.backgroundColor = "#e8f0fe";
                    setTimeout(() => input.style.backgroundColor = "white", 800);
                });
                saveDraft();
            });
        }
        saveDraft();
    }
    return true;
});

// --- [피커 실행 버튼] ---
document.getElementById('pickBtn').addEventListener('click', async () => {
    saveDraft(); 
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return alert("활성화된 탭이 없습니다.");
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['selector_picker.js'] });
});

// --- [작업 등록 버튼] ---
document.getElementById('addBtn').addEventListener('click', () => {
    const name = document.getElementById('taskName').value;
    const url = document.getElementById('targetUrl').value;
    const selector = document.getElementById('selector').value;
    
    // [Bug Fix] 기존: intervalInput(전역설정) 값을 읽음 -> 수정: interval(개별설정) 값을 읽음
    // 만약 개별 설정값이 비어있으면 60분을 기본으로 함
    const interval = parseInt(document.getElementById('interval').value) || 60;
    
    const keyword = document.getElementById('keyword').value.trim();

    if (!name || !url || !selector) return alert('모든 항목을 입력해주세요.');

    const newTask = {
        id: Date.now(),
        name: name,
        url: url,
        selector: selector,
        interval: interval, // [Fix] 개별 설정된 주기 저장
        keyword: keyword,
        lastStatus: 'pending',
        lastRunTime: '-'
    };

    chrome.storage.local.get(['tasks'], (result) => {
        const tasks = result.tasks || [];
        tasks.push(newTask);
        
        chrome.storage.local.set({ tasks: tasks }, () => {
            chrome.runtime.sendMessage({ type: "SYNC_ALARMS" });
            
            // 입력창 초기화
            document.getElementById('taskName').value = '';
            document.getElementById('targetUrl').value = '';
            document.getElementById('selector').value = '';
            document.getElementById('keyword').value = '';
            
            // [Fix] 등록 후 주기 입력창은 다시 '전역 설정값'으로 리셋
            chrome.storage.local.get(['intervalMin'], (res) => {
                document.getElementById('interval').value = res.intervalMin || 60;
            });

            chrome.storage.local.remove('draftInput');
            
            alert(`[${name}] 작업이 등록되었습니다. (수집 주기: ${interval}분)`);
            loadTasks();
        });
    });
});

// --- [목록 로드] ---
function loadTasks() {
    const listDiv = document.getElementById('taskList');
    listDiv.innerHTML = '';

    chrome.storage.local.get(['tasks'], (result) => {
        const tasks = result.tasks || [];
        if (tasks.length === 0) {
            listDiv.innerHTML = '<div style="padding:15px; text-align:center; color:#999;">등록된 작업이 없습니다.</div>';
            return;
        }

        tasks.forEach((task, index) => {
            let statusClass = task.lastStatus === 'success' ? 'status-success' : (task.lastStatus === 'fail' ? 'status-fail' : '');
            let statusText = task.lastStatus === 'success' ? '정상' : (task.lastStatus === 'fail' ? '실패' : '대기');
            let keywordBadge = task.keyword ? `<span class="keyword-tag">🔍 ${task.keyword}</span>` : '';

            const item = document.createElement('div');
            item.className = 'task-item';
            
            item.innerHTML = `
                <div class="task-top">
                    <span class="task-name">${task.name}</span>
                    <div class="action-btn-group">
                        <button class="text-btn edit-btn" data-index="${index}">수정</button>
                        <button class="text-btn delete-btn" data-index="${index}">삭제</button>
                    </div>
                </div>
                <div class="task-meta" id="meta-${index}">
                    <span>⏱️ <b>${task.interval}</b>분</span>
                    <span style="color:#ddd">|</span>
                    <span class="status-badge ${statusClass}"></span> ${statusText}
                    <span style="color:#ddd">|</span>
                    <span>🕒 ${task.lastRunTime}</span>
                    ${keywordBadge}
                </div>
                <div class="edit-form" id="edit-form-${index}" style="display:none; flex-direction:column; gap:5px; margin-top:5px;">
                     <div style="display:flex; align-items:center; gap:5px;">
                        <span style="font-size:11px;">주기:</span>
                        <input type="number" id="edit-interval-${index}" value="${task.interval}" style="width:50px; padding:4px; margin:0;" min="1">
                        <span style="font-size:11px;">분</span>
                     </div>
                     <div style="display:flex; align-items:center; gap:5px;">
                        <span style="font-size:11px;">키워드:</span>
                        <input type="text" id="edit-keyword-${index}" value="${task.keyword || ''}" placeholder="키워드" style="flex:1; padding:4px; margin:0;">
                     </div>
                     <div style="display:flex; gap:5px; justify-content:flex-end; margin-top:5px;">
                        <button class="save-edit-btn" data-index="${index}" style="padding:4px 8px; background:#28a745; border:none; color:white; border-radius:4px; cursor:pointer;">저장</button>
                        <button class="cancel-edit-btn" data-index="${index}" style="padding:4px 8px; background:#6c757d; border:none; color:white; border-radius:4px; cursor:pointer;">취소</button>
                     </div>
                </div>
                <div class="info-row" title="${task.url}">URL: ${task.url}</div>
            `;
            listDiv.appendChild(item);
        });
        addListEventListeners();
    });
}

function addListEventListeners() {
    document.querySelectorAll('.delete-btn').forEach(btn => btn.addEventListener('click', (e) => deleteTask(e.target.dataset.index)));
    
    document.querySelectorAll('.edit-btn').forEach(btn => btn.addEventListener('click', (e) => {
        const idx = e.target.dataset.index;
        document.getElementById(`meta-${idx}`).style.display = 'none';
        document.getElementById(`edit-form-${idx}`).style.display = 'flex';
    }));
    
    document.querySelectorAll('.cancel-edit-btn').forEach(btn => btn.addEventListener('click', (e) => {
        const idx = e.target.dataset.index;
        document.getElementById(`meta-${idx}`).style.display = 'flex';
        document.getElementById(`edit-form-${idx}`).style.display = 'none';
    }));
    
    document.querySelectorAll('.save-edit-btn').forEach(btn => btn.addEventListener('click', (e) => {
        const idx = e.target.dataset.index;
        const newInterval = parseInt(document.getElementById(`edit-interval-${idx}`).value);
        const newKeyword = document.getElementById(`edit-keyword-${idx}`).value.trim();
        updateTask(idx, newInterval, newKeyword);
    }));
}

function updateTask(index, newInterval, newKeyword) {
    if (!newInterval || newInterval < 1) return alert("1분 이상 입력해주세요.");
    chrome.storage.local.get(['tasks'], (result) => {
        const tasks = result.tasks || [];
        tasks[index].interval = newInterval;
        tasks[index].keyword = newKeyword;
        chrome.storage.local.set({ tasks: tasks }, () => {
            chrome.runtime.sendMessage({ type: "SYNC_ALARMS" });
            loadTasks();
        });
    });
}

function deleteTask(index) {
    if(!confirm("이 작업을 삭제하시겠습니까?")) return;
    chrome.storage.local.get(['tasks'], (result) => {
        const tasks = result.tasks || [];
        tasks.splice(index, 1);
        chrome.storage.local.set({ tasks: tasks }, () => {
            chrome.runtime.sendMessage({ type: "SYNC_ALARMS" });
            loadTasks();
        });
    });
}

// --- [로그 시스템] ---
document.getElementById('toggleLogBtn').addEventListener('click', () => {
    const logArea = document.getElementById('logArea');
    const logActions = document.getElementById('logActions');
    if (logArea.style.display === 'none') {
        logArea.style.display = 'block';
        logActions.style.display = 'flex';
        document.getElementById('toggleLogBtn').innerText = '📜 로그 닫기';
        loadLogs();
    } else {
        logArea.style.display = 'none';
        logActions.style.display = 'none';
        document.getElementById('toggleLogBtn').innerText = '📜 로그 보기';
    }
});

function loadLogs() {
    chrome.storage.local.get(['system_logs'], (result) => {
        const logs = result.system_logs || [];
        const logTextArea = document.getElementById('logText');
        if (logs.length === 0) logTextArea.value = "기록된 로그가 없습니다.";
        else logTextArea.value = logs.slice().reverse().join('\n');
    });
}

document.getElementById('copyLogBtn').addEventListener('click', () => {
    const logText = document.getElementById('logText');
    logText.select();
    document.execCommand('copy');
    alert("로그가 복사되었습니다.");
});

document.getElementById('clearLogBtn').addEventListener('click', () => {
    if (confirm("로그 기록을 모두 삭제하시겠습니까?")) {
        chrome.storage.local.remove('system_logs', () => loadLogs());
    }
});