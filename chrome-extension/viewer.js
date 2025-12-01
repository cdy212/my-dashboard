document.addEventListener('DOMContentLoaded', () => {
    initGrid();
    loadDashboard();
    
    document.getElementById('refreshBtn').addEventListener('click', loadDashboard);
    document.getElementById('saveLayoutBtn').addEventListener('click', saveLayout);
    document.getElementById('clearBtn').addEventListener('click', clearData);
});

let grid = null;

function initGrid() {
    // Gridstack 초기화
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

        // 작업별 위젯 생성
        tasks.forEach((task, index) => {
            const taskName = task.name;
            const taskItems = allData.filter(d => d.taskName === taskName).reverse();
            const latestTime = taskItems.length > 0 ? taskItems[0].collectedAt : '-';

            const layout = savedLayout.find(l => l.id === taskName) || {
                x: (index * 6) % 12, // 기본 너비 6 (절반)
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
        // [핵심] 위젯 내부를 테이블로 구성
        bodyHtml = '<table class="inner-table">';
        
        // 1. 헤더 생성 (가장 최신 데이터 기준)
        const firstItem = items[0];
        if (firstItem.headers && Array.isArray(firstItem.headers) && firstItem.headers.length > 0) {
            bodyHtml += '<thead><tr>';
            firstItem.headers.forEach(h => {
                bodyHtml += `<th>${h}</th>`;
            });
            bodyHtml += '</tr></thead>';
        }

        // 2. 본문 생성
        bodyHtml += '<tbody>';
        
        // 최신 30개만 표시 (성능 고려)
        items.slice(0, 30).forEach(item => {
            // 구조화된 데이터 처리
            if (Array.isArray(item.content)) {
                item.content.forEach(row => {
                    bodyHtml += '<tr>';
                    // 2D 배열 (Table Row)
                    if (Array.isArray(row)) {
                        row.forEach(cell => {
                            let text = (typeof cell === 'object' && cell.text) ? cell.text : cell;
                            let link = (typeof cell === 'object' && cell.link) ? cell.link : null;
                            
                            if(link) bodyHtml += `<td><a href="${link}" target="_blank">${text}</a></td>`;
                            else bodyHtml += `<td>${text}</td>`;
                        });
                    } 
                    // 1D 배열 (List Item) -> 한 줄에 표시하되 colSpan 처리
                    else {
                        let text = (typeof row === 'object' && row.text) ? row.text : row;
                        let link = (typeof row === 'object' && row.link) ? row.link : null;
                        
                        let colCount = (firstItem.headers) ? firstItem.headers.length : 1;
                        let cellHtml = link ? `<a href="${link}" target="_blank">${text}</a>` : text;
                        
                        bodyHtml += `<td colspan="${colCount}">${cellHtml}</td>`;
                    }
                    bodyHtml += '</tr>';
                });
            } 
            // 단순 텍스트
            else {
                let colCount = (firstItem.headers) ? firstItem.headers.length : 1;
                bodyHtml += `<tr><td colspan="${colCount}">${item.content}</td></tr>`;
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
                최근 업데이트: ${latestTime}
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
    if (confirm("모든 수집 데이터를 삭제하시겠습니까? (설정은 유지됩니다)")) {
        chrome.storage.local.remove(['scraped_data'], () => {
            loadDashboard();
            alert("초기화되었습니다.");
        });
    }
}