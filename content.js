/**
 * Gemini to Markdown - 逻辑全保留优化版（代码块内部换行修复）
 * 功能：深度解析 DOM 结构，完美还原 Markdown 格式
 */
(function() {
    'use strict';

    // --- 配置与状态 ---
    const CONFIG = {
        SIDEBAR_WIDTH: 420,
        SELECTORS: {
            history: 'infinite-scroller.chat-history',
            messages: 'user-query, model-response',
            content: {
                user: '.user-query-container, .user-query-bubble-with-background, .user-query-content',
                model: 'div.container'
            }
        }
    };

    const state = {
        selectedMessages: new Set(),
        sidebar: null,
        lastUrl: location.href,
        observer: null,
        dragState: {
            isDragging: false,
            hasMoved: false,
            startX: undefined,
            startY: undefined,
            startLeft: 0,
            startTop: 0
        }
    };

    // --- 获取复制按钮内容 ---
    function getCopyButtonContent(messageElement) {
        try {
            let copyButton = messageElement.querySelector('.mat-mdc-button-touch-target, button[aria-label*="copy" i], button[aria-label*="复制" i], [aria-label*="Copy" i]');
            if (!copyButton) {
                let parent = messageElement.parentElement;
                let depth = 0;
                while (parent && depth < 5) {
                    copyButton = parent.querySelector('.mat-mdc-button-touch-target, button[aria-label*="copy" i], button[aria-label*="复制" i]');
                    if (copyButton) break;
                    parent = parent.parentElement;
                    depth++;
                }
            }
            if (!copyButton) return null;
            
            let contentElement = null;
            if (messageElement.tagName === 'USER-QUERY') {
                contentElement = messageElement.querySelector('.user-query-bubble-with-background') 
                    || messageElement.querySelector('.user-query-content')
                    || messageElement;
            } else if (messageElement.tagName === 'MODEL-RESPONSE') {
                contentElement = messageElement.querySelector('div.container') || messageElement;
            } else {
                contentElement = messageElement;
            }
            
            if (!contentElement) return null;
            const clone = contentElement.cloneNode(true);
            clone.querySelectorAll('button, .icon, svg, img, .mat-mdc-button-touch-target').forEach(el => el.remove());
            return nodeToText(clone);
        } catch (e) {
            console.error('[Gemini Export] Failed to get copy button content:', e);
            return null;
        }
    }

    // --- 核心逻辑：深度 DOM 转 Markdown 解析器 ---
    function nodeToText(node) {
        if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
        if (node.nodeType !== Node.ELEMENT_NODE) return '';

        const tagName = node.tagName.toLowerCase();
        const getChildrenText = (n) => Array.from(n.childNodes).map(nodeToText).join('');

        switch (tagName) {
            case 'pre':
                const code = node.querySelector('code');
                if (code) {
                    const lang = code.className.match(/language-(\w+)/)?.[1] || '';
                    // 核心修复：确保代码内容末尾只有一个换行
                    let codeText = (code.textContent || '').replace(/\s+$/, '') + '\n';
                    const isInListItem = node.closest('li') !== null;
                    const indent = isInListItem ? '    ' : '';
                    return `${indent}\`\`\`${lang}\n${codeText}${indent}\`\`\`\n`;
                }
                const isInListItem = node.closest('li') !== null;
                const indent = isInListItem ? '    ' : '';
                return `${indent}\`\`\`\n${node.textContent.trim()}\n${indent}\`\`\`\n`;

            case 'code':
                if (node.parentElement?.tagName.toLowerCase() !== 'pre') {
                    return ` \`${node.textContent.trim()}\` `;
                }
                return node.textContent;

            case 'br': return '\n';
            case 'strong': case 'b': return `**${getChildrenText(node).trim()}**`;
            case 'em': case 'i': return `*${getChildrenText(node).trim()}*`;
            case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
                return `\n${'#'.repeat(parseInt(tagName[1]))} ${getChildrenText(node).trim()}\n\n`;
            case 'ol':
                let olItems = [];
                Array.from(node.childNodes).forEach((child, i) => {
                    if (child.nodeType === 1 && child.tagName.toLowerCase() === 'li') {
                        olItems.push(`${i + 1}. ${getChildrenText(child).replace(/^\s+/, '').replace(/\n+$/, '')}`);
                    }
                });
                return `\n${olItems.join('\n')}\n\n`;
            case 'ul':
                let ulItems = [];
                Array.from(node.childNodes).forEach(child => {
                    if (child.nodeType === 1 && child.tagName.toLowerCase() === 'li') {
                        ulItems.push(`- ${getChildrenText(child).replace(/^\s+/, '').replace(/\n+$/, '')}`);
                    }
                });
                return `\n${ulItems.join('\n')}\n\n`;
            case 'li':
                return getChildrenText(node).replace(/^\n+/, '').replace(/\n+$/, '');
            case 'blockquote':
                return `\n> ${getChildrenText(node).trim().replace(/\n/g, '\n> ')}\n\n`;
            case 'p':
            case 'div':
                const isBlock = ['p', 'div'].includes(tagName);
                return `${isBlock ? '\n' : ''}${getChildrenText(node)}${isBlock ? '\n' : ''}`;
            default:
                return getChildrenText(node);
        }
    }

    // --- UI 注入 ---
    function injectUI() {
        if (document.getElementById('gemini-export-sidebar')) return;
        const style = document.createElement('style');
        style.textContent = `
            #gemini-export-sidebar { position: fixed; top: 0; right: 0; width: ${CONFIG.SIDEBAR_WIDTH}px; height: 100vh; background: #fff; box-shadow: -2px 0 10px rgba(0,0,0,0.1); z-index: 2147483647; transform: translateX(100%); transition: 0.3s cubic-bezier(0.4, 0, 0.2, 1); display: flex; flex-direction: column; font-family: -apple-system, sans-serif; }
            #gemini-export-sidebar.open { transform: translateX(0); }
            .gemini-header { padding: 16px; border-bottom: 1px solid #e0e0e0; background: #f8f9fa; display: flex; flex-direction: column; gap: 12px; }
            .gemini-header-top { display: flex; justify-content: space-between; align-items: center; }
            .gemini-header-actions { display: flex; gap: 8px; }
            .gemini-btn-small { padding: 6px 12px; border-radius: 6px; border: 1px solid #dadce0; cursor: pointer; font-weight: 500; font-size: 12px; transition: 0.2s; background: white; color: #202124; }
            .gemini-btn-small:hover { background: #f1f3f4; border-color: #1a73e8; }
            .gemini-preview { flex: 1; overflow-y: auto; padding: 20px; font-family: 'Consolas', 'Monaco', monospace; font-size: 13px; line-height: 1.6; white-space: pre-wrap; background: #fff; color: #333; }
            .gemini-footer { padding: 16px; border-top: 1px solid #e0e0e0; display: flex; gap: 12px; background: #f8f9fa; }
            .gemini-btn { flex: 1; padding: 10px; border-radius: 8px; border: 1px solid #dadce0; cursor: pointer; font-weight: 500; transition: 0.2s; }
            .gemini-btn-primary { background: #1a73e8; color: white; border: none; }
            #export-cb-column { position: absolute; left: 0; top: 0; width: 60px; pointer-events: none; z-index: 2147483640; display: none; }
            body.export-open #export-cb-column { display: block; }
            .cb-wrapper { position: absolute; left: 20px; pointer-events: auto; width: 20px; height: 20px; }
            .cb-input { width: 18px; height: 18px; cursor: pointer; accent-color: #1a73e8; }
            #export-trigger { 
                position: fixed; 
                width: 56px; 
                height: 56px; 
                border-radius: 50%; 
                background: #1a73e8; 
                color: white; 
                border: none; 
                cursor: move; 
                box-shadow: 0 4px 12px rgba(0,0,0,0.25), 0 2px 4px rgba(0,0,0,0.1); 
                font-weight: 600; 
                font-size: 12px;
                z-index: 2147483645;
                display: flex;
                align-items: center;
                justify-content: center;
                user-select: none;
                transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.3s;
                padding: 0;
            }
            #export-trigger:active {
                transform: scale(0.95);
            }
            #export-trigger.dragging {
                cursor: grabbing;
                transition: none;
            }
            #export-trigger.collapsed-left {
                left: 0 !important;
                transform: translateX(calc(-100% + 20px));
            }
            #export-trigger.collapsed-left:hover {
                transform: translateX(0) scale(1.1);
            }
            #export-trigger.collapsed-right {
                right: 0 !important;
                left: auto !important;
                transform: translateX(calc(100% - 20px));
            }
            #export-trigger.collapsed-right:hover {
                transform: translateX(0) scale(1.1);
            }
            #export-trigger.collapsed-top {
                top: 0 !important;
                transform: translateY(calc(-100% + 20px));
            }
            #export-trigger.collapsed-top:hover {
                transform: translateY(0) scale(1.1);
            }
            #export-trigger.collapsed-bottom {
                bottom: 0 !important;
                top: auto !important;
                transform: translateY(calc(100% - 20px));
            }
            #export-trigger.collapsed-bottom:hover {
                transform: translateY(0) scale(1.1);
            }
            #export-trigger:not(.collapsed-left):not(.collapsed-right):not(.collapsed-top):not(.collapsed-bottom):hover {
                transform: scale(1.1);
                box-shadow: 0 6px 16px rgba(0,0,0,0.3), 0 2px 4px rgba(0,0,0,0.15);
            }
            body.export-open infinite-scroller.chat-history { padding-left: 60px !important; }
        `;
        document.head.appendChild(style);

        const sb = document.createElement('div');
        sb.id = 'gemini-export-sidebar';
        sb.innerHTML = `
            <div class="gemini-header">
                <div class="gemini-header-top">
                    <span style="font-weight:bold">Gemini to Markdown</span>
                    <button id="close-gemini-export" style="background:none; border:none; cursor:pointer; font-size:18px;">✕</button>
                </div>
                <div class="gemini-header-actions">
                    <button class="gemini-btn-small" id="select-all-btn">全选</button>
                    <button class="gemini-btn-small" id="invert-select-btn">反选</button>
                    <button class="gemini-btn-small" id="clear-select-btn">清空</button>
                </div>
            </div>
            <div class="gemini-preview" id="gemini-md-preview">请在左侧勾选消息进行导出...</div>
            <div class="gemini-footer">
                <button class="gemini-btn" id="gemini-download">下载 Markdown</button>
                <button class="gemini-btn gemini-btn-primary" id="gemini-copy">复制内容</button>
            </div>
        `;
        document.body.appendChild(sb);
        state.sidebar = sb;

        const trigger = document.createElement('button');
        trigger.id = 'export-trigger';
        trigger.innerHTML = '<span style="line-height:1; font-size:20px;">📄</span>';
        trigger.title = '导出 Markdown';
        document.body.appendChild(trigger);

        // 加载保存的位置
        loadTriggerPosition(trigger);

        // 拖动功能
        setupDragAndDrop(trigger, sb);
        
        // 切换侧边栏状态的函数
        const toggleSidebar = () => {
            const isOpen = sb.classList.toggle('open');
            document.body.classList.toggle('export-open', isOpen);
            if (isOpen) syncCheckboxes();
        };
        
        document.getElementById('close-gemini-export').onclick = toggleSidebar;
        document.getElementById('gemini-copy').onclick = handleCopy;
        document.getElementById('gemini-download').onclick = handleDownload;
        document.getElementById('select-all-btn').onclick = handleSelectAll;
        document.getElementById('invert-select-btn').onclick = handleInvertSelect;
        document.getElementById('clear-select-btn').onclick = handleClearSelect;
        
        // 将切换函数暴露给拖动处理函数使用
        state.toggleSidebar = toggleSidebar;
    }

    // 加载悬浮球位置
    function loadTriggerPosition(trigger) {
        try {
            const saved = localStorage.getItem('gemini-export-trigger-position');
            if (saved) {
                const pos = JSON.parse(saved);
                trigger.style.left = pos.left + 'px';
                trigger.style.top = pos.top + 'px';
                trigger.style.right = 'auto';
                trigger.style.bottom = 'auto';
            } else {
                // 默认位置：右下角
                trigger.style.right = '30px';
                trigger.style.bottom = '30px';
            }
        } catch (e) {
            console.error('[Gemini Export] Failed to load trigger position:', e);
        }
    }

    // 保存悬浮球位置
    function saveTriggerPosition(trigger) {
        try {
            const rect = trigger.getBoundingClientRect();
            const pos = {
                left: rect.left,
                top: rect.top
            };
            localStorage.setItem('gemini-export-trigger-position', JSON.stringify(pos));
        } catch (e) {
            console.error('[Gemini Export] Failed to save trigger position:', e);
        }
    }

    // 设置拖动和边缘检测
    function setupDragAndDrop(trigger, sidebar) {
        const EDGE_THRESHOLD = 50; // 边缘检测阈值（像素）
        const COLLAPSE_THRESHOLD = 20; // 完全缩进的阈值
        const DRAG_THRESHOLD = 5; // 拖动阈值（像素），超过此距离才认为是拖动
        let clickHandled = false;

        trigger.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return; // 只处理左键
            
            clickHandled = false;
            state.dragState.hasMoved = false;
            state.dragState.startX = e.clientX;
            state.dragState.startY = e.clientY;
            
            const rect = trigger.getBoundingClientRect();
            state.dragState.startLeft = rect.left;
            state.dragState.startTop = rect.top;
        });
        
        // 点击处理
        trigger.addEventListener('mouseup', (e) => {
            // 如果拖动过，不处理点击
            if (state.dragState.hasMoved || state.dragState.isDragging) {
                return;
            }
            
            // 延迟处理点击，确保拖动状态已重置
            setTimeout(() => {
                if (!state.dragState.hasMoved && !state.dragState.isDragging && !clickHandled) {
                    clickHandled = true;
                    if (state.toggleSidebar) {
                        state.toggleSidebar();
                    } else {
                        const isOpen = sidebar.classList.toggle('open');
                        document.body.classList.toggle('export-open', isOpen);
                        if (isOpen) syncCheckboxes();
                    }
                }
            }, 50);
        });
        
        // 阻止默认点击行为
        trigger.onclick = (e) => {
            if (clickHandled || state.dragState.hasMoved || state.dragState.isDragging) {
                e.preventDefault();
                return;
            }
        };

        document.addEventListener('mousemove', (e) => {
            if (state.dragState.startX === undefined || state.dragState.startY === undefined) return;
            
            const deltaX = e.clientX - state.dragState.startX;
            const deltaY = e.clientY - state.dragState.startY;
            const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
            
            // 如果移动距离超过阈值，开始拖动
            if (!state.dragState.hasMoved && distance > DRAG_THRESHOLD) {
                state.dragState.hasMoved = true;
                state.dragState.isDragging = true;
                trigger.classList.add('dragging');
                trigger.style.transition = 'none';
            }
            
            if (!state.dragState.isDragging) return;
            
            let newLeft = state.dragState.startLeft + deltaX;
            let newTop = state.dragState.startTop + deltaY;
            
            // 限制在视窗内
            const maxLeft = window.innerWidth - trigger.offsetWidth;
            const maxTop = window.innerHeight - trigger.offsetHeight;
            
            newLeft = Math.max(0, Math.min(newLeft, maxLeft));
            newTop = Math.max(0, Math.min(newTop, maxTop));
            
            trigger.style.left = newLeft + 'px';
            trigger.style.top = newTop + 'px';
            trigger.style.right = 'auto';
            trigger.style.bottom = 'auto';
            
            // 移除之前的缩进类
            trigger.classList.remove('collapsed-left', 'collapsed-right', 'collapsed-top', 'collapsed-bottom');
            
            // 边缘检测和自动贴合
            const rect = trigger.getBoundingClientRect();
            const distanceToLeft = rect.left;
            const distanceToRight = window.innerWidth - rect.right;
            const distanceToTop = rect.top;
            const distanceToBottom = window.innerHeight - rect.bottom;
            
            // 找到最近边缘
            const minDistance = Math.min(distanceToLeft, distanceToRight, distanceToTop, distanceToBottom);
            
            if (minDistance < EDGE_THRESHOLD) {
                if (distanceToLeft === minDistance && distanceToLeft < COLLAPSE_THRESHOLD) {
                    trigger.classList.add('collapsed-left');
                    trigger.style.left = '0';
                    trigger.style.right = 'auto';
                } else if (distanceToRight === minDistance && distanceToRight < COLLAPSE_THRESHOLD) {
                    trigger.classList.add('collapsed-right');
                    trigger.style.right = '0';
                    trigger.style.left = 'auto';
                } else if (distanceToTop === minDistance && distanceToTop < COLLAPSE_THRESHOLD) {
                    trigger.classList.add('collapsed-top');
                    trigger.style.top = '0';
                    trigger.style.bottom = 'auto';
                } else if (distanceToBottom === minDistance && distanceToBottom < COLLAPSE_THRESHOLD) {
                    trigger.classList.add('collapsed-bottom');
                    trigger.style.bottom = '0';
                    trigger.style.top = 'auto';
                }
            }
        });

        document.addEventListener('mouseup', (e) => {
            const wasDragging = state.dragState.isDragging;
            const hadMoved = state.dragState.hasMoved;
            
            if (state.dragState.isDragging) {
                state.dragState.isDragging = false;
                trigger.classList.remove('dragging');
                trigger.style.transition = '';
                
                // 保存位置
                saveTriggerPosition(trigger);
            }
            
            // 重置拖动状态
            state.dragState.startX = undefined;
            state.dragState.startY = undefined;
            
            // 如果拖动过，延迟重置hasMoved，防止触发点击事件
            if (wasDragging || hadMoved) {
                setTimeout(() => {
                    state.dragState.hasMoved = false;
                }, 100);
            } else {
                state.dragState.hasMoved = false;
            }
        });

        // 触摸设备支持
        trigger.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) return;
            
            state.dragState.hasMoved = false;
            const touch = e.touches[0];
            state.dragState.startX = touch.clientX;
            state.dragState.startY = touch.clientY;
            
            const rect = trigger.getBoundingClientRect();
            state.dragState.startLeft = rect.left;
            state.dragState.startTop = rect.top;
        });

        document.addEventListener('touchmove', (e) => {
            if (state.dragState.startX === undefined || state.dragState.startY === undefined || e.touches.length !== 1) return;
            
            const touch = e.touches[0];
            const deltaX = touch.clientX - state.dragState.startX;
            const deltaY = touch.clientY - state.dragState.startY;
            const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
            
            // 如果移动距离超过阈值，开始拖动
            if (!state.dragState.hasMoved && distance > DRAG_THRESHOLD) {
                state.dragState.hasMoved = true;
                state.dragState.isDragging = true;
                trigger.classList.add('dragging');
                trigger.style.transition = 'none';
            }
            
            if (!state.dragState.isDragging) return;
            
            let newLeft = state.dragState.startLeft + deltaX;
            let newTop = state.dragState.startTop + deltaY;
            
            const maxLeft = window.innerWidth - trigger.offsetWidth;
            const maxTop = window.innerHeight - trigger.offsetHeight;
            
            newLeft = Math.max(0, Math.min(newLeft, maxLeft));
            newTop = Math.max(0, Math.min(newTop, maxTop));
            
            trigger.style.left = newLeft + 'px';
            trigger.style.top = newTop + 'px';
            trigger.style.right = 'auto';
            trigger.style.bottom = 'auto';
            
            trigger.classList.remove('collapsed-left', 'collapsed-right', 'collapsed-top', 'collapsed-bottom');
            
            const rect = trigger.getBoundingClientRect();
            const distanceToLeft = rect.left;
            const distanceToRight = window.innerWidth - rect.right;
            const distanceToTop = rect.top;
            const distanceToBottom = window.innerHeight - rect.bottom;
            
            const minDistance = Math.min(distanceToLeft, distanceToRight, distanceToTop, distanceToBottom);
            
            if (minDistance < EDGE_THRESHOLD) {
                if (distanceToLeft === minDistance && distanceToLeft < COLLAPSE_THRESHOLD) {
                    trigger.classList.add('collapsed-left');
                    trigger.style.left = '0';
                    trigger.style.right = 'auto';
                } else if (distanceToRight === minDistance && distanceToRight < COLLAPSE_THRESHOLD) {
                    trigger.classList.add('collapsed-right');
                    trigger.style.right = '0';
                    trigger.style.left = 'auto';
                } else if (distanceToTop === minDistance && distanceToTop < COLLAPSE_THRESHOLD) {
                    trigger.classList.add('collapsed-top');
                    trigger.style.top = '0';
                    trigger.style.bottom = 'auto';
                } else if (distanceToBottom === minDistance && distanceToBottom < COLLAPSE_THRESHOLD) {
                    trigger.classList.add('collapsed-bottom');
                    trigger.style.bottom = '0';
                    trigger.style.top = 'auto';
                }
            }
            
            e.preventDefault();
        });

        document.addEventListener('touchend', () => {
            const wasDragging = state.dragState.isDragging;
            const hadMoved = state.dragState.hasMoved;
            
            if (state.dragState.isDragging) {
                state.dragState.isDragging = false;
                trigger.classList.remove('dragging');
                trigger.style.transition = '';
                
                saveTriggerPosition(trigger);
            }
            
            // 重置拖动状态
            state.dragState.startX = undefined;
            state.dragState.startY = undefined;
            
            // 如果拖动过，延迟重置hasMoved，防止触发点击事件
            if (wasDragging || hadMoved) {
                setTimeout(() => {
                    state.dragState.hasMoved = false;
                }, 100);
            } else {
                state.dragState.hasMoved = false;
            }
        });
    }

    // 全选功能
    function handleSelectAll() {
        const history = document.querySelector(CONFIG.SELECTORS.history);
        if (!history) return;
        
        // 确保复选框已同步
        syncCheckboxes();
        
        const messages = history.querySelectorAll(CONFIG.SELECTORS.messages);
        const column = document.getElementById('export-cb-column');
        if (!column) return;
        
        messages.forEach((msg, idx) => {
            state.selectedMessages.add(idx);
            const wrapper = column.querySelector(`.cb-wrapper[data-idx="${idx}"]`);
            if (wrapper) {
                const checkbox = wrapper.querySelector('.cb-input');
                if (checkbox) checkbox.checked = true;
            }
        });
        updatePreview();
    }

    // 反选功能
    function handleInvertSelect() {
        const history = document.querySelector(CONFIG.SELECTORS.history);
        if (!history) return;
        
        // 确保复选框已同步
        syncCheckboxes();
        
        const messages = history.querySelectorAll(CONFIG.SELECTORS.messages);
        const column = document.getElementById('export-cb-column');
        if (!column) return;
        
        messages.forEach((msg, idx) => {
            const wrapper = column.querySelector(`.cb-wrapper[data-idx="${idx}"]`);
            if (wrapper) {
                const checkbox = wrapper.querySelector('.cb-input');
                if (checkbox) {
                    if (state.selectedMessages.has(idx)) {
                        state.selectedMessages.delete(idx);
                        checkbox.checked = false;
                    } else {
                        state.selectedMessages.add(idx);
                        checkbox.checked = true;
                    }
                }
            }
        });
        updatePreview();
    }

    // 清空功能
    function handleClearSelect() {
        const history = document.querySelector(CONFIG.SELECTORS.history);
        if (!history) return;
        
        // 确保复选框已同步
        syncCheckboxes();
        
        const column = document.getElementById('export-cb-column');
        if (!column) return;
        
        // 清空所有选中的消息
        state.selectedMessages.clear();
        
        // 取消所有复选框的选中状态
        const checkboxes = column.querySelectorAll('.cb-input');
        checkboxes.forEach(checkbox => {
            checkbox.checked = false;
        });
        
        updatePreview();
    }

    function syncCheckboxes() {
        const history = document.querySelector(CONFIG.SELECTORS.history);
        if (!history) return;
        let column = document.getElementById('export-cb-column') || (function(){
            let c = document.createElement('div'); c.id = 'export-cb-column'; history.appendChild(c); return c;
        })();
        const messages = history.querySelectorAll(CONFIG.SELECTORS.messages);
        messages.forEach((msg, idx) => {
            msg.setAttribute('data-export-idx', idx);
            let wrapper = column.querySelector(`.cb-wrapper[data-idx="${idx}"]`) || (function(){
                let w = document.createElement('div'); w.className = 'cb-wrapper'; w.dataset.idx = idx;
                let i = document.createElement('input'); i.type = 'checkbox'; i.className = 'cb-input';
                i.checked = state.selectedMessages.has(idx);
                i.onchange = (e) => { e.target.checked ? state.selectedMessages.add(idx) : state.selectedMessages.delete(idx); updatePreview(); };
                w.appendChild(i); column.appendChild(w); return w;
            })();
            const rect = msg.getBoundingClientRect(), parentRect = history.getBoundingClientRect();
            wrapper.style.top = `${rect.top - parentRect.top + history.scrollTop + 15}px`;
        });
    }

    function updatePreview() {
        const preview = document.getElementById('gemini-md-preview');
        const sortedIndices = Array.from(state.selectedMessages).sort((a, b) => a - b);
        let items = [];

        sortedIndices.forEach((idx) => {
            const el = document.querySelector(`[data-export-idx="${idx}"]`);
            if (!el) return;
            const isUser = el.tagName === 'USER-QUERY', roleName = isUser ? 'You' : 'Gemini';
            let text = getCopyButtonContent(el);
            if (!text || !text.trim()) {
                const contentEl = el.querySelector(isUser ? CONFIG.SELECTORS.content.user : CONFIG.SELECTORS.content.model) || el;
                const clone = contentEl.cloneNode(true);
                clone.querySelectorAll('button, .icon, svg, mat-icon').forEach(n => n.remove());
                text = nodeToText(clone);
            }
            if (text && text.trim()) {
                let processedText = text.trim();
                
                // 核心修复：清理正则替换中可能引入的代码块内多余空行
                processedText = processedText.replace(/([A-Za-z][A-Za-z0-9\s]*?)\s*\n+(\s*)```\s*\n([\s\S]*?)\n(\s*)```/g, (match, langName, indentBefore, code, indentAfter) => {
                    const lang = langName.trim().replace(/\s+/g, '').toLowerCase();
                    const indent = indentBefore || indentAfter || '';
                    return `${indent}\`\`\`${lang}\n${code.trim()}\n${indent}\`\`\``;
                });
                
                // 第二个正则替换（只匹配空格和制表符作为缩进，不包括换行符）
                processedText = processedText.replace(/([ \t]*)```(\w+)?\n([\s\S]*?)\n([ \t]*)```/g, (match, indentBefore, lang, code, indentAfter) => {
                    // 只使用空格和制表符作为缩进，移除换行符
                    const indent = (indentBefore || indentAfter || '').replace(/[\n\r]/g, '');
                    return `${indent}\`\`\`${lang || ''}\n${code.trim()}\n${indent}\`\`\``;
                });
                
                items.push(`**${roleName}:**\n\n${processedText}`);
            }
        });

        let finalMarkdown = items.join('\n\n---\n\n');
        preview.textContent = finalMarkdown
            .replace(/[ \t]+$/gm, '') 
            .replace(/\n{3,}/g, '\n\n')
            .trim() || "请勾选消息以开始导出";
    }

    async function handleCopy() {
        const text = document.getElementById('gemini-md-preview').textContent;
        if (!text || text.startsWith("请勾选")) return;
        await navigator.clipboard.writeText(text);
        const btn = document.getElementById('gemini-copy'), oldText = btn.innerText;
        btn.innerText = '✓ 已复制'; setTimeout(() => btn.innerText = oldText, 2000);
    }

    function handleDownload() {
        const text = document.getElementById('gemini-md-preview').textContent;
        if (!text || text.startsWith("请勾选")) return;
        const blob = new Blob([text], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob), a = document.createElement('a');
        a.href = url; a.download = `Gemini_Export_${Date.now()}.md`; a.click(); URL.revokeObjectURL(url);
    }

    function init() {
        injectUI();
        const history = document.querySelector(CONFIG.SELECTORS.history);
        if (history) {
            history.addEventListener('scroll', () => { if (state.sidebar?.classList.contains('open')) requestAnimationFrame(syncCheckboxes); }, { passive: true });
            if (state.observer) state.observer.disconnect();
            state.observer = new MutationObserver(() => { if (state.sidebar?.classList.contains('open')) syncCheckboxes(); });
            state.observer.observe(history, { childList: true, subtree: true });
        }
    }

    setInterval(() => {
        if (state.lastUrl !== location.href) {
            state.lastUrl = location.href; state.selectedMessages.clear();
            const col = document.getElementById('export-cb-column'); if (col) col.innerHTML = ''; 
            updatePreview(); setTimeout(init, 1000);
        }
    }, 1500);
    if (document.readyState === 'complete') init(); else window.addEventListener('load', init);
})();