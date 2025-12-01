document.addEventListener('DOMContentLoaded', () => {
    loadData();
    
    document.getElementById('refreshBtn').addEventListener('click', loadData);
    document.getElementById('downloadBtn').addEventListener('click', downloadCSV);
    document.getElementById('clearBtn').addEventListener('click', clearData);
});

function loadData() {
    const tbody = document.getElementById('tableBody');
    const countSpan = document.getElementById('totalCount');
    
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">로딩 중...</td></tr>';

    chrome.storage.local.get(['scraped_data'], (result) => {
        const data = result.scraped_data || [];
        countSpan.textContent = data.length;

        if (data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="empty-msg">저장된 데이터가 없습니다.</td></tr>';
            return;
        }

        tbody.innerHTML = '';

        // 최신순 정렬하여 렌더링
        data.slice().reverse().forEach(row => {
            const tr = document.createElement('tr');
            
            let contentHtml = '';
            
            // 1. [구조화된 테이블]인 경우: 헤더를 테이블 안에 통합 (Thead + Tbody)
            if (row.structure === 'table' && Array.isArray(row.content)) {
                contentHtml += '<table style="width:100%; border-collapse:collapse; font-size:12px; border:1px solid #ddd;">';
                
                // (1) 헤더가 있으면 <thead>로 생성
                if (row.headers && Array.isArray(row.headers) && row.headers.length > 0) {
                    contentHtml += '<thead style="background-color:#f1f8ff; color:#007bff;"><tr>';
                    row.headers.forEach(h => {
                        contentHtml += `<th style="padding:6px; border:1px solid #ddd; text-align:center; white-space:nowrap;">${h}</th>`;
                    });
                    contentHtml += '</tr></thead>';
                }

                // (2) 본문 <tbody> 생성
                contentHtml += '<tbody>';
                row.content.forEach(rowData => {
                    contentHtml += '<tr style="border-bottom:1px solid #eee;">';
                    if (Array.isArray(rowData)) {
                        rowData.forEach(cell => {
                            let cellText = cell.text || cell;
                            let cellLink = cell.link || null;
                            let tdStyle = "padding:6px; border:1px solid #eee;";
                            
                            if(cellLink) {
                                contentHtml += `<td style="${tdStyle}"><a href="${cellLink}" target="_blank" style="color:#333; text-decoration:none; font-weight:bold;">${cellText}</a></td>`;
                            } else {
                                contentHtml += `<td style="${tdStyle}">${cellText}</td>`;
                            }
                        });
                    }
                    contentHtml += '</tr>';
                });
                contentHtml += '</tbody></table>';
            } 
            // 2. [리스트 구조]인 경우
            else if (row.structure === 'list' && Array.isArray(row.content)) {
                // 리스트는 헤더가 있다면 위에 별도로 표시 (리스트엔 thead가 없으므로)
                if (row.headers && row.headers.length > 0) {
                    contentHtml += `<div style="margin-bottom:5px; font-size:12px; color:#007bff; font-weight:bold;">[ ${row.headers.join(' | ')} ]</div>`;
                }

                contentHtml += '<ul class="content-list">';
                row.content.forEach(item => {
                    if (typeof item === 'object' && item.text) {
                        if (item.link) {
                            contentHtml += `<li><a href="${item.link}" target="_blank" style="color:#333; text-decoration:none; hover:underline;">${item.text}</a></li>`;
                        } else {
                            contentHtml += `<li>${item.text}</li>`;
                        }
                    } else {
                        contentHtml += `<li>${item}</li>`;
                    }
                });
                contentHtml += '</ul>';
            } 
            // 3. [일반 텍스트]인 경우
            else {
                if (row.headers && row.headers.length > 0) {
                    contentHtml += `<div style="margin-bottom:5px; font-size:12px; color:#007bff; font-weight:bold;">[ ${row.headers.join(' | ')} ]</div>`;
                }
                contentHtml += `<div>${row.content}</div>`;
            }

            tr.innerHTML = `
                <td class="col-date">${row.collectedAt}</td>
                <td class="col-task">${row.taskName}</td>
                <td class="col-content">${contentHtml}</td>
                <td class="col-link">
                    <a href="${row.url}" target="_blank" class="link-btn">이동 ↗</a>
                </td>
            `;
            tbody.appendChild(tr);
        });
    });
}

function downloadCSV() {
    chrome.storage.local.get(['scraped_data'], (result) => {
        const data = result.scraped_data || [];
        if (data.length === 0) return alert("데이터가 없습니다.");

        let csvContent = "\uFEFFDate,Task Name,Headers,Content,URL\n";
        data.forEach(row => {
            let headerStr = (row.headers && Array.isArray(row.headers)) ? row.headers.join(" | ") : "";
            let contentStr = "";
            
            if (Array.isArray(row.content)) {
                contentStr = row.content.map(item => {
                    if (Array.isArray(item)) {
                        return item.map(c => c.text || c).join(" | ");
                    }
                    if (typeof item === 'object' && item.text) {
                        return item.link ? `${item.text} (${item.link})` : item.text;
                    }
                    return item;
                }).join(" || ");
            } else {
                contentStr = row.content;
            }
            
            const cleanHeaders = `"${headerStr.replace(/"/g, '""')}"`;
            const cleanContent = `"${(contentStr || '').replace(/"/g, '""')}"`;
            
            csvContent += `${row.collectedAt},"${row.taskName}",${cleanHeaders},${cleanContent},"${row.url}"\n`;
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `scraped_data_${new Date().toISOString().slice(0,10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });
}

function clearData() {
    if (confirm("정말 모든 데이터를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.")) {
        chrome.storage.local.remove('scraped_data', () => {
            loadData();
            alert("삭제되었습니다.");
        });
    }
}