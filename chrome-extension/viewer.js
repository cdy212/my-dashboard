document.addEventListener('DOMContentLoaded', () => {
    initGrid();
    loadDashboard();
    
    document.getElementById('refreshBtn').addEventListener('click', loadDashboard);
    document.getElementById('saveLayoutBtn').addEventListener('click', saveLayout);
    document.getElementById('clearBtn').addEventListener('click', clearData);
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

            const widgetContent = createWidgetHtml(taskName, taskItems, latestTime, task.url);
            
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

function createWidgetHtml(taskName, items, latestTime, taskUrl) {
    let bodyHtml = '';

    if (items.length === 0) {
        bodyHtml = `<div class="empty-message">수집된 데이터가 없습니다.</div>`;
    } else {
        bodyHtml = '<table class="inner-table">';
        
        // 1. 헤더 생성 (첫 번째 데이터 기준, 고정 헤더)
        const firstItem = items[items.length - 1]; // 가장 오래된 데이터(또는 첫번째)의 헤더 사용
        // 보통 최신 데이터에도 헤더가 있으므로 items[0] 사용
        const headerItem = items[0];
        
        if (headerItem.headers && Array.isArray(headerItem.headers) && headerItem.headers.length > 0) {
            bodyHtml += '<thead><tr>';
            headerItem.headers.forEach(h => {
                bodyHtml += `<th>${h}</th>`;
            });
            bodyHtml += '</tr></thead>';
        }

        // 2. 본문 생성
        bodyHtml += '<tbody>';
        
        // 최신 30개 표시
        items.slice(0, 30).forEach(item => {
            // [New] 신규 데이터 강조 클래스 적용
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
                        let colCount = (headerItem.headers) ? headerItem.headers.length : 1;
                        
                        let cellContent = link ? `<a href="${link}" target="_blank">${text}</a>` : text;
                        bodyHtml += `<td colspan="${colCount}">${cellContent}</td>`;
                    }
                    bodyHtml += '</tr>';
                });
            } else {
                // 단순 텍스트
                let colCount = (headerItem.headers) ? headerItem.headers.length : 1;
                bodyHtml += `<tr class="${rowClass}"><td colspan="${colCount}">${item.content}</td></tr>`;
            }
        });
        bodyHtml += '</tbody></table>';
    }

    return `
        <div class="grid-stack-item-content">
            <div class="card-header">
                <span><i class="fa-solid fa-table"></i> ${taskName}</span>
                <a href="${taskUrl}" target="_blank" style="font-size:12px; color:#666; text-decoration:none;">
                    <i class="fa-solid fa-external-link-alt"></i>
                </a>
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