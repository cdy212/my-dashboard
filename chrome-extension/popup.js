document.addEventListener('DOMContentLoaded', () => {
    restoreDraft();
    loadTasks();
    loadSettings();
    updateDataCount();
    // populateTaskFilter(); // [삭제] 필터 UI가 삭제되었으므로 제거
});

// [New] 설정 메뉴 토글 기능
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
            // renderPreview(); // [삭제] 미리보기 영역이 없으므로 제거
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
        const currentInterval = result.intervalMin || 60;
        document.getElementById('intervalInput').value = currentInterval;
        const useServer = result.useServer || false;
        document.getElementById('useServerCheck').checked = useServer;
    });
}

document.getElementById('saveIntervalBtn').addEventListener('click', () => {
    const minutes = parseInt(document.getElementById('intervalInput').value);
    if (!minutes || minutes < 1) return alert("1분 이상 입력해주세요.");

    chrome.storage.local.set({ intervalMin: minutes }, () => {
        chrome.runtime.sendMessage({ type: "UPDATE_ALARM", interval: minutes }); 
        alert(`기본 주기가 ${minutes}분으로 설정되었습니다.\n(신규 작업부터 적용됩니다)`);
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
        url: document.getElementById('targetUrl').value
    };
    chrome.storage.local.set({ 'draftInput': draft });
}

function restoreDraft() {
    chrome.storage.local.get(['draftInput'], (result) => {
        if (result.draftInput) {
            document.getElementById('taskName').value = result.draftInput.name || '';
            document.getElementById('targetUrl').value = result.draftInput.url || '';
        }
    });
}

['taskName', 'targetUrl', 'intervalInput'].forEach(id => {
    // intervalInput은 설정 영역에 있지만 드래프트 저장 대상이 아니면 제외 가능
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
    // 등록 시 주기는 기본 설정값(intervalInput) 사용
    const interval = parseInt(document.getElementById('intervalInput').value) || 60;

    if (!name || !url || !selector) return alert('모든 항목을 입력해주세요.');

    const newTask = {
        id: Date.now(),
        name: name,
        url: url,
        selector: selector,
        interval: interval,
        lastStatus: 'pending',
        lastRunTime: '-'
    };

    chrome.storage.local.get(['tasks'], (result) => {
        const tasks = result.tasks || [];
        tasks.push(newTask);
        
        chrome.storage.local.set({ tasks: tasks }, () => {
            chrome.runtime.sendMessage({ type: "SYNC_ALARMS" });
            
            document.getElementById('taskName').value = '';
            document.getElementById('targetUrl').value = '';
            document.getElementById('selector').value = '';
            chrome.storage.local.remove('draftInput');
            
            alert(`[${name}] 작업이 등록되었습니다.`);
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
                </div>
                <div class="edit-form" id="edit-form-${index}" style="display:none; margin-top:5px; gap:5px; align-items:center;">
                    <input type="number" id="edit-interval-${index}" value="${task.interval}" style="width:60px; padding:4px; margin:0;" min="1">
                    <span style="font-size:11px;">분</span>
                    <button class="save-edit-btn" data-index="${index}" style="margin:0; padding:4px 8px; background:#28a745; border:none; color:white; border-radius:4px; cursor:pointer;">저장</button>
                    <button class="cancel-edit-btn" data-index="${index}" style="margin:0; padding:4px 8px; background:#6c757d; border:none; color:white; border-radius:4px; cursor:pointer;">취소</button>
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
        updateTaskInterval(idx, newInterval);
    }));
}

function updateTaskInterval(index, newInterval) {
    if (!newInterval || newInterval < 1) return alert("1분 이상 입력해주세요.");
    chrome.storage.local.get(['tasks'], (result) => {
        const tasks = result.tasks || [];
        tasks[index].interval = newInterval;
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