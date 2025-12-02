document.addEventListener('DOMContentLoaded', () => {
    initGrid();
    loadDashboard();
    
    document.getElementById('refreshBtn').addEventListener('click', loadDashboard);
    document.getElementById('saveLayoutBtn').addEventListener('click', saveLayout);
    document.getElementById('clearBtn').addEventListener('click', clearData);

    // [New] 알림 버튼 클릭 이벤트 위임 (동적 요소 처리)
    document.querySelector('.grid-stack').addEventListener('click', (e) => {
        const notifyBtn = e.target.closest('.btn-notify');
        if (notifyBtn) {
            const taskName = notifyBtn.dataset.taskName;
            toggleNotification(taskName, notifyBtn);
        }
    });
});

let grid = null;

function initGrid() {
    grid = GridStack.init({
        column: 12,
        cellHeight: 100,
        minRow: 1,
        margin: 10,
        animate: true,
        handle: '.card-header', 
        resizable: { handles: 'se, sw, ne, nw' }
    });
}

function loadDashboard() {
    chrome.storage.local.get(['tasks', 'scraped_data', 'dashboard_layout'], (result) => {
        const tasks = result.tasks || [];
        const allData = result.scraped_data || [];
        const savedLayout = result.dashboard_layout || [];

        grid.removeAll();

        if (tasks.length === 0) {
            alert("등록된 수집 작업이 없습니다.");
            return;
        }

        tasks.forEach((task, index) => {
            const taskName = task.name;
            const taskItems = allData.filter(d => d.taskName === taskName).reverse();
            const latestTime = taskItems.length > 0 ? taskItems[0].collectedAt : '-';

            const layout = savedLayout.find(l => l.id === taskName) || {
                x: (index * 6) % 12, 
                y: Math.floor((index * 6) / 12) * 4, 
                w: 6, 
                h: 5
            };

            // [Mod] task 객체를 직접 전달하여 notify 설정 확인
            const widgetContent = createWidgetHtml(task, taskItems, latestTime);
            
            grid.addWidget({
                id: taskName,
                x: layout.x,
                y: layout.y,
                w: layout.w,
                h: layout.h,
                content: widgetContent
            });
        });
    });
}

// [Mod] taskName, taskUrl 대신 task 객체 전체 수신
function createWidgetHtml(task, items, latestTime) {
    let bodyHtml = '';

    if (items.length === 0) {
        bodyHtml = `<div class="empty-message">수집된 데이터가 없습니다.</div>`;
    } else {
        bodyHtml = '<table class="inner-table">';
        
        const headerItem = items[0]; // 최신 데이터 기준으로 헤더 사용
        
        if (headerItem && headerItem.headers && Array.isArray(headerItem.headers) && headerItem.headers.length > 0) {
            bodyHtml += '<thead><tr>';
            headerItem.headers.forEach(h => {
                bodyHtml += `<th>${h}</th>`;
            });
            bodyHtml += '</tr></thead>';
        }

        bodyHtml += '<tbody>';
        
        // 최신 30개 표시
        items.slice(0, 30).forEach(item => {
            const rowClass = item.isNew ? 'row-new' : '';

            if (Array.isArray(item.content)) {
                item.content.forEach(row => {
                    bodyHtml += `<tr class="${rowClass}">`;
                    
                    if (Array.isArray(row)) { // Table Row
                        row.forEach(cell => {
                            let text = (typeof cell === 'object' && cell.text) ? cell.text : cell;
                            let link = (typeof cell === 'object' && cell.link) ? cell.link : null;
                            
                            if(link) bodyHtml += `<td><a href="${link}" target="_blank">${text}</a></td>`;
                            else bodyHtml += `<td>${text}</td>`;
                        });
                    } 
                    else { // List Item
                        let text = (typeof row === 'object' && row.text) ? row.text : row;
                        let link = (typeof row === 'object' && row.link) ? row.link : null;
                        let colCount = (headerItem && headerItem.headers) ? headerItem.headers.length : 1;
                        
                        let cellContent = link ? `<a href="${link}" target="_blank">${text}</a>` : text;
                        bodyHtml += `<td colspan="${colCount}">${cellContent}</td>`;
                    }
                    bodyHtml += '</tr>';
                });
            } else {
                // 단순 텍스트
                let colCount = (headerItem && headerItem.headers) ? headerItem.headers.length : 1;
                bodyHtml += `<tr class="${rowClass}"><td colspan="${colCount}">${item.content}</td></tr>`;
            }
        });
        bodyHtml += '</tbody></table>';
    }

    // [New] 알림 버튼 상태 결정
    const isNotifyOn = task.notify === true;
    const notifyClass = isNotifyOn ? 'active' : '';
    const notifyIcon = isNotifyOn ? 'fa-solid fa-bell' : 'fa-regular fa-bell';
    const notifyTitle = isNotifyOn ? '새글 알림 켜짐' : '새글 알림 꺼짐';

    return `
        <div class="grid-stack-item-content">
            <div class="card-header">
                <div class="header-title">
                    <span><i class="fa-solid fa-table"></i> ${task.name}</span>
                </div>
                <div class="header-actions">
                    <!-- [New] 알림 토글 버튼 -->
                    <button class="btn-notify ${notifyClass}" data-task-name="${task.name}" title="${notifyTitle}">
                        <i class="${notifyIcon}"></i>
                    </button>
                    <a href="${task.url}" target="_blank" style="font-size:12px; color:#666; text-decoration:none;">
                        <i class="fa-solid fa-external-link-alt"></i>
                    </a>
                </div>
            </div>
            <div class="card-body">
                ${bodyHtml}
            </div>
            <div class="card-footer">
                Update: ${latestTime}
            </div>
        </div>
    `;
}

// [New] 알림 설정 토글 함수
function toggleNotification(taskName, btnElement) {
    chrome.storage.local.get(['tasks'], (result) => {
        const tasks = result.tasks || [];
        const taskIndex = tasks.findIndex(t => t.name === taskName);
        
        if (taskIndex !== -1) {
            // 상태 토글
            const currentStatus = tasks[taskIndex].notify || false;
            const newStatus = !currentStatus;
            tasks[taskIndex].notify = newStatus;

            chrome.storage.local.set({ tasks: tasks }, () => {
                // UI 업데이트
                const icon = btnElement.querySelector('i');
                if (newStatus) {
                    btnElement.classList.add('active');
                    icon.className = 'fa-solid fa-bell';
                    btnElement.title = '새글 알림 켜짐';
                    alert(`[${taskName}] 새글 알림이 켜졌습니다.`);
                } else {
                    btnElement.classList.remove('active');
                    icon.className = 'fa-regular fa-bell';
                    btnElement.title = '새글 알림 꺼짐';
                }
            });
        }
    });
}

function saveLayout() {
    const layoutData = grid.save(); 
    const savedData = layoutData.map(item => ({
        id: item.id, x: item.x, y: item.y, w: item.w, h: item.h
    }));
    chrome.storage.local.set({ dashboard_layout: savedData }, () => {
        alert('레이아웃이 저장되었습니다.');
    });
}

function clearData() {
    if (confirm("모든 수집 데이터를 삭제하시겠습니까? (작업 목록은 유지됩니다)")) {
        chrome.storage.local.remove(['scraped_data'], () => {
            loadDashboard();
            alert("삭제되었습니다.");
        });
    }
}