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
        observer: null
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
            .gemini-header { padding: 16px; border-bottom: 1px solid #e0e0e0; background: #f8f9fa; display: flex; justify-content: space-between; align-items: center; }
            .gemini-preview { flex: 1; overflow-y: auto; padding: 20px; font-family: 'Consolas', 'Monaco', monospace; font-size: 13px; line-height: 1.6; white-space: pre-wrap; background: #fff; color: #333; }
            .gemini-footer { padding: 16px; border-top: 1px solid #e0e0e0; display: flex; gap: 12px; background: #f8f9fa; }
            .gemini-btn { flex: 1; padding: 10px; border-radius: 8px; border: 1px solid #dadce0; cursor: pointer; font-weight: 500; transition: 0.2s; }
            .gemini-btn-primary { background: #1a73e8; color: white; border: none; }
            #export-cb-column { position: absolute; left: 0; top: 0; width: 60px; pointer-events: none; z-index: 2147483640; display: none; }
            body.export-open #export-cb-column { display: block; }
            .cb-wrapper { position: absolute; left: 20px; pointer-events: auto; width: 20px; height: 20px; }
            .cb-input { width: 18px; height: 18px; cursor: pointer; accent-color: #1a73e8; }
            #export-trigger { position: fixed; bottom: 30px; right: 30px; z-index: 2147483645; padding: 12px 24px; background: #1a73e8; color: white; border: none; border-radius: 50px; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.25); font-weight: 600; }
            body.export-open infinite-scroller.chat-history { padding-left: 60px !important; }
        `;
        document.head.appendChild(style);

        const sb = document.createElement('div');
        sb.id = 'gemini-export-sidebar';
        sb.innerHTML = `
            <div class="gemini-header"><span style="font-weight:bold">Gemini to Markdown</span><button id="close-gemini-export" style="background:none; border:none; cursor:pointer; font-size:18px;">✕</button></div>
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
        trigger.innerText = '导出 Markdown';
        document.body.appendChild(trigger);

        trigger.onclick = () => {
            const isOpen = sb.classList.toggle('open');
            document.body.classList.toggle('export-open', isOpen);
            if (isOpen) syncCheckboxes();
        };
        document.getElementById('close-gemini-export').onclick = () => trigger.click();
        document.getElementById('gemini-copy').onclick = handleCopy;
        document.getElementById('gemini-download').onclick = handleDownload;
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