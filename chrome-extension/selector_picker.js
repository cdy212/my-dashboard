// selector_picker.js
(function() {
    if (window.shScraperRunning) return;
    window.shScraperRunning = true;

    let previousElement = null;

    // 1. 스타일 주입
    const styleId = 'sh-scraper-style';
    if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.innerHTML = `
            .sh-scraper-highlight {
                outline: 3px solid #ff0000 !important;
                background-color: rgba(255, 0, 0, 0.1) !important;
                cursor: crosshair !important;
                box-shadow: 0 0 10px rgba(255, 0, 0, 0.3);
                z-index: 2147483647 !important;
            }
            table.sh-scraper-highlight td, 
            table.sh-scraper-highlight th {
                background-color: rgba(255, 0, 0, 0.05) !important;
            }
        `;
        document.head.appendChild(style);
    }

    // [Smart Target]
    function getSmartTarget(element) {
        if (!element) return null;
        const th = element.closest('th');
        if (th) {
            const table = th.closest('table');
            return table ? table : th;
        }
        const td = element.closest('td');
        if (td) {
            const tr = td.closest('tr');
            return tr ? tr : td;
        }
        return element;
    }

    function handleMouseOver(event) {
        event.stopPropagation();
        const target = getSmartTarget(event.target);

        if (previousElement && previousElement !== target) {
            previousElement.classList.remove('sh-scraper-highlight');
        }
        if (target) {
            target.classList.add('sh-scraper-highlight');
            previousElement = target;
        }
    }

    function handleClick(event) {
        event.preventDefault();
        event.stopPropagation();

        const target = getSmartTarget(event.target);
        if (!target) return;

        const selector = generateOptimizedSelector(target);

        if (previousElement) previousElement.classList.remove('sh-scraper-highlight');
        cleanup();

        chrome.runtime.sendMessage({
            type: "SELECTOR_PICKED",
            selector: selector,
            url: window.location.href,
            title: document.title
        });
    }

    /**
     * [Core] 최적화된 Selector 생성 알고리즘 (수정됨)
     */
    function generateOptimizedSelector(el) {
        if (!el) return '';
        
        const path = [];
        
        while (el.nodeType === Node.ELEMENT_NODE) {
            let selector = el.nodeName.toLowerCase();
            
            // 1. ID가 있으면 무조건 ID만 사용하고 종료 (가장 강력)
            if (el.id) {
                selector += `#${el.id}`;
                path.unshift(selector);
                break; 
            } 
            
            // 2. ID가 없을 때만 Class 사용
            else if (el.className && typeof el.className === 'string') {
                const ignoreClasses = ['active', 'show', 'open', 'selected', 'hover', 'focus', 'col-', 'row', 'sh-scraper-highlight'];
                
                const validClasses = el.className.split(/\s+/)
                    .filter(c => c.trim().length > 0)
                    .filter(c => !ignoreClasses.some(ic => c.startsWith(ic)));

                // 첫 번째 유효한 클래스만 붙여서 간결하게 만듦
                if (validClasses.length > 0) {
                    selector += `.${validClasses[0]}`; 
                }
            }

            // 3. 형제 요소 간 유일성 확인 (nth-of-type)
            let parent = el.parentNode;
            if (parent) {
                const siblings = parent.children;
                let matchCount = 0;
                let myIndex = 0;
                
                for (let i = 0; i < siblings.length; i++) {
                    const sib = siblings[i];
                    
                    // 태그명 비교
                    let isSameTag = sib.nodeName.toLowerCase() === el.nodeName.toLowerCase();
                    let isSameClass = true;

                    // 클래스 비교 (클래스가 있는 경우에만)
                    if (el.className && typeof el.className === 'string') {
                        isSameClass = sib.className === el.className;
                    }

                    if (isSameTag && isSameClass) {
                        matchCount++;
                    }
                    
                    if (sib === el) myIndex = matchCount;
                }

                // 유일하지 않다면 순서(nth-of-type) 추가
                if (matchCount > 1) {
                    selector += `:nth-of-type(${myIndex})`;
                }
            }

            path.unshift(selector);
            el = el.parentNode;
            
            if (el.nodeName.toLowerCase() === 'html') break;
        }
        
        return path.join(" > ");
    }

    function cleanup() {
        document.removeEventListener('mouseover', handleMouseOver, true);
        document.removeEventListener('click', handleClick, true);
        window.shScraperRunning = false;
        const style = document.getElementById(styleId);
        if(style) style.remove();
    }

    document.addEventListener('mouseover', handleMouseOver, true);
    document.addEventListener('click', handleClick, true);
})();