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
        },
        TIMING: {
            RESTORE_DELAY: 1200,
            CLICK_DELAY: 50,
            RESET_DELAY: 100,
            TRANSITION_DURATION: 300,
            POSITION_UPDATE_DELAY: 10,
            THEME_UPDATE_DELAY: 100,
            URL_CHECK_INTERVAL: 1500,
            INIT_DELAY: 1000
        },
        DRAG: {
            EDGE_THRESHOLD: 50,
            COLLAPSE_THRESHOLD: 1,
            DRAG_THRESHOLD: 5
        },
        UI: {
            CHECKBOX_OFFSET: 15,
            DEFAULT_TRIGGER_RIGHT: 30,
            DEFAULT_TRIGGER_BOTTOM: 30
        },
        COLLAPSED_CLASSES: ['collapsed-left', 'collapsed-right', 'collapsed-top', 'collapsed-bottom']
    };

    const state = {
        selectedMessages: new Set(),
        sidebar: null,
        lastUrl: location.href,
        observer: null,
        themeObserver: null,
        currentTheme: 'light',
        dragState: {
            isDragging: false,
            hasMoved: false,
            startX: undefined,
            startY: undefined,
            startLeft: 0,
            startTop: 0
        },
        scrollLocked: false,
        savedScrollPosition: { top: 0, left: 0 }
    };

    // --- 工具函数 ---
    function getCopyButtonSelector() {
        return '.mat-mdc-button-touch-target, button[aria-label*="copy" i], button[aria-label*="复制" i], [aria-label*="Copy" i]';
    }

    // 检查扩展上下文是否有效
    function isExtensionContextValid() {
        try {
            return chrome && chrome.runtime && chrome.runtime.id;
        } catch (e) {
            return false;
        }
    }

    // 安全地获取存储值
    async function safeGetStorage(keys, defaultValue = null) {
        if (!isExtensionContextValid()) {
            return defaultValue;
        }
        try {
            const result = await chrome.storage.local.get(keys);
            return result;
        } catch (err) {
            if (err.message && err.message.includes('Extension context invalidated')) {
                console.warn('[Gemini Export] Extension context invalidated, using default value');
                return defaultValue;
            }
            console.error('[Gemini Export] Failed to get storage:', err);
            return defaultValue;
        }
    }

    function findCopyButton(element, maxDepth = 5) {
        let copyButton = element.querySelector(getCopyButtonSelector());
        if (copyButton) return copyButton;
        
        let parent = element.parentElement;
        let depth = 0;
        while (parent && depth < maxDepth) {
            copyButton = parent.querySelector(getCopyButtonSelector());
            if (copyButton) return copyButton;
            parent = parent.parentElement;
            depth++;
        }
        return null;
    }

    function getContentElement(messageElement) {
        if (messageElement.tagName === 'USER-QUERY') {
            return messageElement.querySelector('.user-query-bubble-with-background') 
                || messageElement.querySelector('.user-query-content')
                || messageElement;
        } else if (messageElement.tagName === 'MODEL-RESPONSE') {
            return messageElement.querySelector('div.container') || messageElement;
        }
        return messageElement;
    }

    // --- 统一文本处理：从消息元素到最终 Markdown ---
    // 使用 html-to-markdown.js 工具模块
    const HTMLToMarkdown = window.HTMLToMarkdown;
    
    if (!HTMLToMarkdown) {
        console.error('[Gemini Export] HTMLToMarkdown module not loaded!');
    }

    // --- 主题检测与更新 ---
    function detectTheme() {
        // 方法1: 检查 body 类名
        if (document.body.classList.contains('dark-theme')) return 'dark';
        if (document.body.classList.contains('light-theme')) return 'light';
        
        // 方法2: 检查实际背景色
        try {
            const computedStyle = window.getComputedStyle(document.body);
            const bgColor = computedStyle.backgroundColor;
            
            const rgbMatch = bgColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
            if (rgbMatch) {
                const [, r, g, b] = rgbMatch.map(Number);
                const brightness = (r * 299 + g * 587 + b * 114) / 1000;
                if (brightness < 128) return 'dark';
            }
            
            const surfaceColor = computedStyle.getPropertyValue('--gem-sys-color--surface') || 
                               computedStyle.getPropertyValue('--mat-sys-surface');
            if (surfaceColor) {
                const darkColors = ['rgb(32, 33, 36)', '#202124', 'rgb(45, 46, 48)'];
                if (darkColors.some(color => surfaceColor.includes(color))) {
                    return 'dark';
                }
            }
        } catch (e) {
            console.warn('[Gemini Export] Theme detection error:', e);
        }
        
        // 方法3: 检查 prefers-color-scheme（作为后备）
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            return 'dark';
        }
        
        return 'light';
    }

    function getThemeColors(theme) {
        const themes = {
            dark: {
                sidebarBg: '#202124',
                headerBg: '#2d2e30',
                footerBg: '#2d2e30',
                previewBg: '#202124',
                previewText: '#e8eaed',
                headerText: '#e8eaed',
                footerText: '#e8eaed',
                border: '#3c4043',
                btnBg: '#303134',
                btnText: '#e8eaed',
                btnBorder: '#3c4043',
                btnHoverBg: '#3c4043',
                btnPrimaryBg: '#8ab4f8',
                btnPrimaryText: '#202124',
                triggerBg: '#8ab4f8',
                triggerText: '#202124',
                shadow: 'rgba(0,0,0,0.5)',
                primaryHoverColor: '#aecbfa'
            },
            light: {
                sidebarBg: '#ffffff',
                headerBg: '#f8f9fa',
                footerBg: '#f8f9fa',
                previewBg: '#ffffff',
                previewText: '#333333',
                headerText: '#202124',
                footerText: '#202124',
                border: '#e0e0e0',
                btnBg: '#ffffff',
                btnText: '#202124',
                btnBorder: '#dadce0',
                btnHoverBg: '#f1f3f4',
                btnPrimaryBg: '#1a73e8',
                btnPrimaryText: '#ffffff',
                triggerBg: '#1a73e8',
                triggerText: '#ffffff',
                shadow: 'rgba(0,0,0,0.25)',
                primaryHoverColor: '#1557b0'
            }
        };
        return themes[theme] || themes.light;
    }

    function updateTheme() {
        const newTheme = detectTheme();
        if (state.currentTheme && newTheme === state.currentTheme) return;
        
        state.currentTheme = newTheme;
        const colors = getThemeColors(newTheme);
        const style = document.getElementById('gemini-export-theme-style');
        
        if (!style) return;
        
        style.textContent = `
            #gemini-export-sidebar { 
                background: ${colors.sidebarBg} !important;
            }
            .gemini-header { 
                background: ${colors.headerBg} !important;
                border-bottom-color: ${colors.border} !important;
            }
            .gemini-header span { 
                color: ${colors.headerText} !important;
            }
            #close-gemini-export { 
                color: ${colors.headerText} !important;
            }
            .gemini-preview { 
                background: ${colors.previewBg} !important;
                color: ${colors.previewText} !important;
            }
            .gemini-footer { 
                background: ${colors.footerBg} !important;
                border-top-color: ${colors.border} !important;
            }
            .gemini-btn-small { 
                background: ${colors.btnBg} !important;
                color: ${colors.btnText} !important;
                border-color: ${colors.btnBorder} !important;
            }
            .gemini-btn-small:hover { 
                background: ${colors.btnHoverBg} !important;
                border-color: ${colors.btnPrimaryBg} !important;
            }
            .gemini-btn { 
                background: ${colors.btnBg} !important;
                color: ${colors.btnText} !important;
                border-color: ${colors.btnBorder} !important;
            }
            .gemini-btn:hover { 
                background: ${colors.btnHoverBg} !important;
            }
            .gemini-btn-primary { 
                background: ${colors.btnPrimaryBg} !important;
                color: ${colors.btnPrimaryText} !important;
                border: none !important;
            }
            .gemini-btn-primary:hover { 
                background: ${colors.primaryHoverColor} !important;
            }
            .gemini-btn:disabled { 
                opacity: 0.6 !important; 
                cursor: not-allowed !important; 
            }
            #export-trigger { 
                background: ${colors.triggerBg} !important;
                color: ${colors.triggerText} !important;
                box-shadow: 0 4px 12px ${colors.shadow}, 0 2px 4px rgba(0,0,0,0.1) !important;
            }
            #export-trigger:not(.collapsed-left):not(.collapsed-right):not(.collapsed-top):not(.collapsed-bottom):hover {
                box-shadow: 0 6px 16px ${colors.shadow}, 0 2px 4px rgba(0,0,0,0.15) !important;
            }
            .cb-input { 
                accent-color: ${colors.btnPrimaryBg} !important;
            }
        `;
    }

    function setupThemeObserver() {
        if (state.themeObserver) {
            state.themeObserver.disconnect();
        }
        
        state.themeObserver = new MutationObserver(updateTheme);
        state.themeObserver.observe(document.body, {
            attributes: true,
            attributeFilter: ['class']
        });
        
        if (window.matchMedia) {
            const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
            mediaQuery.addEventListener('change', updateTheme);
        }
        
        updateTheme();
    }

    // --- 按钮状态管理 ---
    function createButtonStateManager(btn, btnIcon, btnText) {
        const cleanup = () => {
            if (btn._restoreTimeout) {
                clearTimeout(btn._restoreTimeout);
                btn._restoreTimeout = null;
            }
            if (btn._mouseEnterHandler) {
                btn.removeEventListener('mouseenter', btn._mouseEnterHandler);
                btn._mouseEnterHandler = null;
            }
        };

        const restore = (originalIcon, originalText) => {
            btnIcon.textContent = originalIcon;
            btnText.textContent = originalText;
            btn.classList.remove('success');
            btn._isProcessing = false;
            cleanup();
        };

        const showFeedback = (icon, text, isSuccess = true) => {
            const originalIcon = btnIcon.textContent;
            const originalText = btnText.textContent;
            
            btnIcon.textContent = icon;
            btnText.textContent = text;
            if (isSuccess) {
                btn.classList.add('success');
            }
            
            const restoreFn = () => restore(originalIcon, originalText);
            
            btn._mouseEnterHandler = () => {
                if (btn._restoreTimeout) {
                    clearTimeout(btn._restoreTimeout);
                    btn._restoreTimeout = null;
                }
                restoreFn();
            };
            btn.addEventListener('mouseenter', btn._mouseEnterHandler);
            
            btn._restoreTimeout = setTimeout(restoreFn, CONFIG.TIMING.RESTORE_DELAY);
        };

        return {
            isProcessing: () => btn._isProcessing,
            setProcessing: (value) => { btn._isProcessing = value; },
            cleanup,
            showFeedback
        };
    }

    // --- 辅助函数：导出按钮设置 ---
    function setupExportButton(buttonId) {
        const btn = document.getElementById(buttonId);
        if (!btn) return null;
        const btnIcon = btn.querySelector('.btn-icon');
        const btnText = btn.querySelector('.btn-text');
        const manager = createButtonStateManager(btn, btnIcon, btnText);
        
        if (manager.isProcessing()) return null;
        manager.cleanup();
        manager.setProcessing(true);
        
        return manager;
    }

    // --- UI 注入 ---
    function createStyles() {
        const style = document.createElement('style');
        style.textContent = `
            #gemini-export-sidebar { position: fixed; top: 0; right: 0; width: ${CONFIG.SIDEBAR_WIDTH}px; height: 100vh; background: #ffffff; box-shadow: -2px 0 10px rgba(0,0,0,0.1); z-index: 2147483647; transform: translateX(100%); transition: 0.3s cubic-bezier(0.4, 0, 0.2, 1); display: flex; flex-direction: column; font-family: -apple-system, sans-serif; }
            #gemini-export-sidebar.open { transform: translateX(0); }
            body.export-open { margin-right: ${CONFIG.SIDEBAR_WIDTH}px !important; transition: margin-right 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
            body.export-open > *:not(#gemini-export-sidebar):not(#export-trigger) { 
                transition: margin-right 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            }
            .gemini-header { padding: 16px; border-bottom: 1px solid #e0e0e0; background: #f8f9fa; display: flex; flex-direction: column; gap: 12px; transition: background-color 0.3s, border-color 0.3s, color 0.3s; }
            .gemini-header-top { display: flex; justify-content: space-between; align-items: center; }
            .gemini-header-top span { color: #202124; }
            #close-gemini-export { color: #202124; }
            .gemini-header-actions { display: flex; gap: 8px; }
            .gemini-btn-small { padding: 6px 12px; border-radius: 6px; border: 1px solid #dadce0; background: white; color: #202124; cursor: pointer; font-weight: 500; font-size: 12px; transition: 0.2s; }
            .gemini-btn-small:hover { background: #f1f3f4; border-color: #1a73e8; }
            .gemini-preview { flex: 1; overflow-y: auto; padding: 20px; font-family: 'Consolas', 'Monaco', monospace; font-size: 13px; line-height: 1.6; white-space: pre-wrap; background: #fff; color: #333; transition: background-color 0.3s, color 0.3s; cursor: text; }
            .gemini-preview:focus { background: #fafafa; }
            .gemini-preview pre { 
                margin: 0; 
                padding: 0; 
                white-space: pre-wrap !important; 
                word-wrap: break-word !important; 
                overflow-wrap: break-word !important; 
                word-break: break-word !important; 
                font-family: inherit; 
                font-size: inherit; 
                line-height: inherit; 
                width: 100%;
                max-width: 100%;
                box-sizing: border-box;
            }
            .gemini-footer { padding: 16px; border-top: 1px solid #e0e0e0; background: #f8f9fa; display: flex; gap: 12px; transition: background-color 0.3s, border-color 0.3s, color 0.3s; }
            .gemini-btn { 
                flex: 1; 
                padding: 10px; 
                border-radius: 8px; 
                border: 1px solid #dadce0; 
                background: white; 
                color: #202124; 
                cursor: pointer; 
                font-weight: 500; 
                transition: all 0.2s; 
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                position: relative;
                min-height: 40px;
            }
            .gemini-btn:hover { background: #f1f3f4; }
            .gemini-btn:active { transform: scale(0.98); }
            .gemini-btn-primary { background: #1a73e8; color: white; border: none; }
            .gemini-btn-primary:hover { background: #1557b0; }
            .gemini-btn-primary:active { transform: scale(0.98); }
            .gemini-btn .btn-icon { 
                font-size: 16px; 
                line-height: 1;
                display: inline-block;
                transition: transform 0.2s;
            }
            .gemini-btn .btn-text { 
                font-size: 14px;
                white-space: nowrap;
            }
            .gemini-btn.success .btn-icon { 
                transform: scale(1.2);
            }
            .gemini-btn.success { 
                animation: successPulse 0.3s ease-out;
            }
            @keyframes successPulse {
                0% { transform: scale(1); }
                50% { transform: scale(1.05); }
                100% { transform: scale(1); }
            }
            .gemini-btn:disabled { 
                opacity: 0.6; 
                cursor: not-allowed; 
                pointer-events: none;
            }
            #export-cb-column { position: absolute; left: 0; top: 0; width: 60px; pointer-events: none; z-index: 2147483640; display: none; }
            body.export-open #export-cb-column { display: block; }
            .cb-wrapper { position: absolute; left: 20px; pointer-events: auto; width: 20px; height: 20px; }
            .cb-input { width: 18px; height: 18px; cursor: pointer; accent-color: #1a73e8; }
            #export-trigger { 
                position: fixed; 
                width: 44px; 
                height: 44px; 
                border-radius: 50%; 
                background: #1a73e8; 
                color: white; 
                border: none; 
                cursor: move; 
                box-shadow: 0 4px 12px rgba(0,0,0,0.25), 0 2px 4px rgba(0,0,0,0.1); 
                font-weight: 600; 
                font-size: 10px;
                z-index: 2147483645;
                display: flex;
                align-items: center;
                justify-content: center;
                user-select: none;
                transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.3s, border-radius 0.3s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.3s, color 0.3s;
                padding: 0;
            }
            #export-trigger:active {
                transform: scale(0.95);
            }
            #export-trigger.dragging {
                cursor: grabbing;
                transition: border-radius 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            }
            #export-trigger.collapsed-left {
                left: 0 !important;
                transform: translateX(calc(-100% + 18px));
                border-radius: 0 50% 50% 0;
            }
            #export-trigger.collapsed-left:hover {
                transform: translateX(0) scale(1.1);
            }
            #export-trigger.collapsed-right {
                left: auto !important;
                transform: translateX(calc(100% - 18px));
                border-radius: 50% 0 0 50%;
            }
            #export-trigger.collapsed-right:hover {
                transform: translateX(0) scale(1.1);
            }
            #export-trigger.collapsed-top {
                top: 0 !important;
                transform: translateY(calc(-100% + 18px));
                border-radius: 0 0 50% 50%;
            }
            #export-trigger.collapsed-top:hover {
                transform: translateY(0) scale(1.1);
            }
            #export-trigger.collapsed-bottom {
                bottom: 0 !important;
                top: auto !important;
                transform: translateY(calc(100% - 18px));
                border-radius: 50% 50% 0 0;
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
        return style;
    }

    function createSidebarHTML() {
        return `
            <div class="gemini-header">
                <div class="gemini-header-top">
                    <span style="font-weight:bold">Gemini to Markdown</span>
                    <button id="close-gemini-export" style="background:none; border:none; cursor:pointer; font-size:18px;">✕</button>
                </div>
                <div class="gemini-header-actions">
                    <button class="gemini-btn-small" id="select-all-btn">全选</button>
                    <button class="gemini-btn-small" id="invert-select-btn">反选</button>
                    <button class="gemini-btn-small" id="clear-select-btn">清空</button>
                    <button class="gemini-btn-small" id="scroll-to-top-btn" title="滚动到顶部">⬆️</button>
                </div>
            </div>
            <div class="gemini-preview" id="gemini-md-preview"><pre id="gemini-md-preview-pre">请在左侧勾选消息进行导出...</pre></div>
            <div class="gemini-footer">
                <button class="gemini-btn" id="gemini-download">
                    <span class="btn-icon">⬇️</span>
                    <span class="btn-text">下载 Markdown</span>
                </button>
                <button class="gemini-btn gemini-btn-primary" id="gemini-copy">
                    <span class="btn-icon">📋</span>
                    <span class="btn-text">复制内容</span>
                </button>
            </div>
        `;
    }

    // 设置预览区域的 Ctrl+A 全选功能
    function setupPreviewSelectAll() {
        const preview = document.getElementById('gemini-md-preview');
        if (!preview) return;

        // 使预览区域可以聚焦
        preview.setAttribute('tabindex', '0');
        preview.style.outline = 'none';

        // 添加键盘事件监听器
        preview.addEventListener('keydown', (e) => {
            // 检查是否按下了 Ctrl+A (Windows/Linux) 或 Cmd+A (Mac)
            if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
                e.preventDefault();
                e.stopPropagation();
                
                // 选中预览区域中的所有文本
                const selection = window.getSelection();
                const range = document.createRange();
                
                // 查找实际的文本容器（pre 元素或预览区域本身）
                const textContainer = document.getElementById('gemini-md-preview-pre') || preview;
                
                // 选中整个文本容器的内容
                range.selectNodeContents(textContainer);
                selection.removeAllRanges();
                selection.addRange(range);
            }
        });

        // 添加点击事件，使预览区域可以聚焦
        preview.addEventListener('click', (e) => {
            // 如果点击的不是链接或其他交互元素，则聚焦预览区域
            if (e.target === preview || e.target.closest('#gemini-md-preview-pre')) {
                preview.focus();
            }
        });
    }

    function setupSidebarEventHandlers(sidebar, trigger) {
        const toggleSidebar = () => {
            const isOpen = sidebar.classList.toggle('open');
            document.body.classList.toggle('export-open', isOpen);
            
            const history = document.querySelector(CONFIG.SELECTORS.history);
            
            if (isOpen) {
                // 展开时：锁定滚动
                if (history) {
                    lockScroll(history);
                }
            } else {
                // 收起时：解锁滚动（如果被锁定）
                if (history && state.scrollLocked) {
                    unlockScroll(history);
                }
            }
            
            const mainContainers = [
                document.querySelector('main'),
                document.querySelector('[role="main"]'),
                document.querySelector('.main-container'),
                document.querySelector('#main-content'),
                document.body.firstElementChild
            ].filter(el => el && el !== sidebar && el !== trigger);
            
            mainContainers.forEach(container => {
                if (isOpen) {
                    container.style.marginRight = `${CONFIG.SIDEBAR_WIDTH}px`;
                    container.style.transition = 'margin-right 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
                } else {
                    container.style.marginRight = '';
                }
            });
            
            if (!trigger.classList.contains('dragging')) {
                trigger.style.transition = 'left 0.3s cubic-bezier(0.4, 0, 0.2, 1), right 0.3s cubic-bezier(0.4, 0, 0.2, 1), top 0.3s cubic-bezier(0.4, 0, 0.2, 1), bottom 0.3s cubic-bezier(0.4, 0, 0.2, 1), border-radius 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
            }
            
            setTimeout(() => {
                const rect = trigger.getBoundingClientRect();
                const isCollapsedRight = trigger.classList.contains('collapsed-right');
                const currentRight = trigger.style.right;
                const distanceToWindowRight = window.innerWidth - rect.right;
                
                if (isOpen) {
                    if (isCollapsedRight || (currentRight && parseFloat(currentRight) < 50) || distanceToWindowRight < 50) {
                        trigger.style.right = `${CONFIG.SIDEBAR_WIDTH}px`;
                        trigger.style.left = 'auto';
                        if (!isCollapsedRight) {
                            trigger.classList.add('collapsed-right');
                        }
                    }
                } else {
                    if (isCollapsedRight) {
                        trigger.style.right = '0';
                        trigger.style.left = 'auto';
                    } else if (currentRight && parseFloat(currentRight) === CONFIG.SIDEBAR_WIDTH) {
                        trigger.style.right = '0';
                        trigger.style.left = 'auto';
                        trigger.classList.add('collapsed-right');
                    }
                }
                
                setTimeout(() => {
                    if (!trigger.classList.contains('dragging')) {
                        trigger.style.transition = 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.3s, border-radius 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
                    }
                }, CONFIG.TIMING.TRANSITION_DURATION);
            }, CONFIG.TIMING.POSITION_UPDATE_DELAY);
            
            if (isOpen) {
                // 延迟执行 syncCheckboxes，等待 DOM 渲染完成
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        syncCheckboxes();
                        // syncCheckboxes 完成后解锁滚动
                        if (history) {
                            // 再等待一帧确保所有操作完成
                            requestAnimationFrame(() => {
                                unlockScroll(history);
                            });
                        }
                    });
                });
            }
        };

        const scrollToTop = () => {
            const history = document.querySelector(CONFIG.SELECTORS.history);
            if (history) {
                history.scrollTo({ top: 0, behavior: 'smooth' });
            } else {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        };

        document.getElementById('close-gemini-export').onclick = toggleSidebar;
        document.getElementById('gemini-copy').onclick = handleCopy;
        document.getElementById('gemini-download').onclick = handleDownload;
        document.getElementById('select-all-btn').onclick = handleSelectAll;
        document.getElementById('invert-select-btn').onclick = handleInvertSelect;
        document.getElementById('clear-select-btn').onclick = handleClearSelect;
        document.getElementById('scroll-to-top-btn').onclick = scrollToTop;

        // 为预览区域添加 Ctrl+A 全选功能
        setupPreviewSelectAll();

        state.toggleSidebar = toggleSidebar;
    }

    function injectUI() {
        if (document.getElementById('gemini-export-sidebar')) return;
        
        const themeStyle = document.createElement('style');
        themeStyle.id = 'gemini-export-theme-style';
        document.head.appendChild(themeStyle);
        updateTheme();
        
        document.head.appendChild(createStyles());

        const sidebar = document.createElement('div');
        sidebar.id = 'gemini-export-sidebar';
        sidebar.innerHTML = createSidebarHTML();
        document.body.appendChild(sidebar);
        state.sidebar = sidebar;

        const trigger = document.createElement('button');
        trigger.id = 'export-trigger';
        trigger.innerHTML = '<span style="line-height:1; font-size:18px;">📄</span>';
        trigger.title = '导出 Markdown';
        document.body.appendChild(trigger);

        loadTriggerPosition(trigger);
        setupDragAndDrop(trigger, sidebar);
        setupSidebarEventHandlers(sidebar, trigger);
        setupThemeObserver();
    }

    // --- 位置管理 ---
    // 辅助函数：位置转换逻辑
    function convertPositionForSidebar(pos, sidebarOpen, isLoad) {
        if (sidebarOpen && pos.right !== undefined) {
            if (pos.collapsed === 'collapsed-right') {
                pos.right = isLoad ? CONFIG.SIDEBAR_WIDTH : 0;
            } else {
                pos.right = isLoad 
                    ? Math.max(0, pos.right - CONFIG.SIDEBAR_WIDTH)
                    : pos.right + CONFIG.SIDEBAR_WIDTH;
            }
        }
        return pos;
    }

    function loadTriggerPosition(trigger) {
        try {
            const saved = localStorage.getItem('gemini-export-trigger-position');
            if (!saved) {
                trigger.style.right = `${CONFIG.UI.DEFAULT_TRIGGER_RIGHT}px`;
                trigger.style.bottom = `${CONFIG.UI.DEFAULT_TRIGGER_BOTTOM}px`;
                return;
            }

            const pos = JSON.parse(saved);
            const sidebarOpen = document.body.classList.contains('export-open');
            
            // 使用公共函数转换位置
            convertPositionForSidebar(pos, sidebarOpen, true);
            
            if (pos.right !== undefined || pos.bottom !== undefined) {
                if (pos.right !== undefined) {
                    trigger.style.right = pos.right + 'px';
                    trigger.style.left = 'auto';
                }
                if (pos.bottom !== undefined) {
                    trigger.style.bottom = pos.bottom + 'px';
                    trigger.style.top = 'auto';
                }
                if (pos.left !== undefined && pos.right === undefined) {
                    trigger.style.left = pos.left + 'px';
                }
                if (pos.top !== undefined && pos.bottom === undefined) {
                    trigger.style.top = pos.top + 'px';
                }
            } else if (pos.left !== undefined || pos.top !== undefined) {
                if (pos.left !== undefined) {
                    trigger.style.left = pos.left + 'px';
                    trigger.style.right = 'auto';
                }
                if (pos.top !== undefined) {
                    trigger.style.top = pos.top + 'px';
                    trigger.style.bottom = 'auto';
                }
            }
            
            if (pos.collapsed) {
                trigger.classList.remove(...CONFIG.COLLAPSED_CLASSES);
                trigger.classList.add(pos.collapsed);
                
                const borderRadiusMap = {
                    'collapsed-left': '0 50% 50% 0',
                    'collapsed-right': '50% 0 0 50%',
                    'collapsed-top': '0 0 50% 50%',
                    'collapsed-bottom': '50% 50% 0 0'
                };
                trigger.style.borderRadius = borderRadiusMap[pos.collapsed] || '50%';
            } else {
                trigger.style.borderRadius = '50%';
            }
        } catch (e) {
            console.error('[Gemini Export] Failed to load trigger position:', e);
        }
    }

    function saveTriggerPosition(trigger) {
        try {
            const pos = {};
            const style = trigger.style;
            const sidebarOpen = document.body.classList.contains('export-open');
            
            const parseStyleValue = (value) => {
                if (!value || value === 'auto' || value === '') return undefined;
                const num = parseFloat(value);
                return isNaN(num) ? undefined : num;
            };

            pos.left = parseStyleValue(style.left);
            pos.top = parseStyleValue(style.top);
            pos.right = parseStyleValue(style.right);
            pos.bottom = parseStyleValue(style.bottom);
            
            if (pos.left === undefined && pos.right === undefined && pos.top === undefined && pos.bottom === undefined) {
                const rect = trigger.getBoundingClientRect();
                pos.left = rect.left;
                pos.top = rect.top;
            }
            
            const collapsedClass = CONFIG.COLLAPSED_CLASSES.find(cls => trigger.classList.contains(cls));
            if (collapsedClass) {
                pos.collapsed = collapsedClass;
            }
            
            // 使用公共函数转换位置
            convertPositionForSidebar(pos, sidebarOpen, false);
            
            localStorage.setItem('gemini-export-trigger-position', JSON.stringify(pos));
        } catch (e) {
            console.error('[Gemini Export] Failed to save trigger position:', e);
        }
    }

    // --- 拖动处理 ---
    function handleDragStart(e, trigger, isTouch = false) {
        if (isTouch && e.touches.length !== 1) return;
        if (!isTouch && e.button !== 0) return;
        
        const point = isTouch ? e.touches[0] : e;
        state.dragState.hasMoved = false;
        state.dragState.startX = point.clientX;
        state.dragState.startY = point.clientY;
        
        const rect = trigger.getBoundingClientRect();
        state.dragState.startLeft = rect.left;
        state.dragState.startTop = rect.top;
    }

    function handleDragMove(e, trigger, isTouch = false) {
        if (state.dragState.startX === undefined || state.dragState.startY === undefined) return;
        if (isTouch && e.touches.length !== 1) return;
        
        const point = isTouch ? e.touches[0] : e;
        const deltaX = point.clientX - state.dragState.startX;
        const deltaY = point.clientY - state.dragState.startY;
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        
        if (!state.dragState.hasMoved && distance > CONFIG.DRAG.DRAG_THRESHOLD) {
            state.dragState.hasMoved = true;
            state.dragState.isDragging = true;
            trigger.classList.add('dragging');
            trigger.style.transition = 'border-radius 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
        }
        
        if (!state.dragState.isDragging) return;
        
        const sidebarOpen = document.body.classList.contains('export-open');
        const visibleWidth = sidebarOpen ? window.innerWidth - CONFIG.SIDEBAR_WIDTH : window.innerWidth;
        const visibleHeight = window.innerHeight;
        
        let newLeft = state.dragState.startLeft + deltaX;
        let newTop = state.dragState.startTop + deltaY;
        
        const maxLeft = visibleWidth - trigger.offsetWidth;
        const maxTop = visibleHeight - trigger.offsetHeight;
        
        newLeft = Math.max(0, Math.min(newLeft, maxLeft));
        newTop = Math.max(0, Math.min(newTop, maxTop));
        
        const isCurrentlyCollapsed = CONFIG.COLLAPSED_CLASSES.some(cls => trigger.classList.contains(cls));
        const currentCollapsedClass = CONFIG.COLLAPSED_CLASSES.find(cls => trigger.classList.contains(cls));
        
        if (isCurrentlyCollapsed) {
            let shouldReleaseCollapse = false;
            
            if (currentCollapsedClass === 'collapsed-left') {
                shouldReleaseCollapse = deltaX > CONFIG.DRAG.DRAG_THRESHOLD;
            } else if (currentCollapsedClass === 'collapsed-right') {
                shouldReleaseCollapse = deltaX < -CONFIG.DRAG.DRAG_THRESHOLD;
            } else if (currentCollapsedClass === 'collapsed-top') {
                shouldReleaseCollapse = deltaY > CONFIG.DRAG.DRAG_THRESHOLD;
            } else if (currentCollapsedClass === 'collapsed-bottom') {
                shouldReleaseCollapse = deltaY < -CONFIG.DRAG.DRAG_THRESHOLD;
            }
            
            if (shouldReleaseCollapse) {
                trigger.classList.remove(...CONFIG.COLLAPSED_CLASSES);
                trigger.style.right = 'auto';
                trigger.style.bottom = 'auto';
                trigger.style.left = newLeft + 'px';
                trigger.style.top = newTop + 'px';
                
                const rectAfter = trigger.getBoundingClientRect();
                state.dragState.startLeft = rectAfter.left;
                state.dragState.startTop = rectAfter.top;
                state.dragState.startX = point.clientX;
                state.dragState.startY = point.clientY;
            } else {
                state.dragState.startX = point.clientX;
                state.dragState.startY = point.clientY;
                return;
            }
        } else {
            trigger.classList.remove(...CONFIG.COLLAPSED_CLASSES);
            trigger.style.right = 'auto';
            trigger.style.bottom = 'auto';
            trigger.style.left = newLeft + 'px';
            trigger.style.top = newTop + 'px';
        }
        
        const newRect = trigger.getBoundingClientRect();
        const distances = {
            left: newRect.left,
            right: visibleWidth - newRect.right,
            top: newRect.top,
            bottom: visibleHeight - newRect.bottom
        };
        
        const minDistance = Math.min(...Object.values(distances));
        let isCollapsed = false;
        
        if (minDistance < CONFIG.DRAG.COLLAPSE_THRESHOLD) {
            const edgeActions = {
                left: () => {
                    trigger.classList.add('collapsed-left');
                    trigger.style.left = '0';
                    trigger.style.right = 'auto';
                    trigger.style.borderRadius = '0 50% 50% 0';
                },
                right: () => {
                    trigger.classList.add('collapsed-right');
                    trigger.style.right = sidebarOpen ? `${CONFIG.SIDEBAR_WIDTH}px` : '0';
                    trigger.style.left = 'auto';
                    trigger.style.borderRadius = '50% 0 0 50%';
                },
                top: () => {
                    trigger.classList.add('collapsed-top');
                    trigger.style.top = '0';
                    trigger.style.bottom = 'auto';
                    trigger.style.borderRadius = '0 0 50% 50%';
                },
                bottom: () => {
                    trigger.classList.add('collapsed-bottom');
                    trigger.style.bottom = '0';
                    trigger.style.top = 'auto';
                    trigger.style.borderRadius = '50% 50% 0 0';
                }
            };
            
            const nearestEdge = Object.keys(distances).find(key => distances[key] === minDistance);
            if (nearestEdge && edgeActions[nearestEdge]) {
                edgeActions[nearestEdge]();
                isCollapsed = true;
                
                const collapsedRect = trigger.getBoundingClientRect();
                state.dragState.startLeft = collapsedRect.left;
                state.dragState.startTop = collapsedRect.top;
                state.dragState.startX = point.clientX;
                state.dragState.startY = point.clientY;
            }
        }
        
        if (!isCollapsed) {
            trigger.style.borderRadius = '50%';
        }
        
        if (isTouch) e.preventDefault();
    }

    function handleDragEnd(trigger) {
        const wasDragging = state.dragState.isDragging;
        const hadMoved = state.dragState.hasMoved;
        
        if (state.dragState.isDragging) {
            state.dragState.isDragging = false;
            trigger.classList.remove('dragging');
            trigger.style.transition = '';
            saveTriggerPosition(trigger);
        }
        
        state.dragState.startX = undefined;
        state.dragState.startY = undefined;
        
        if (wasDragging || hadMoved) {
            setTimeout(() => {
                state.dragState.hasMoved = false;
            }, CONFIG.TIMING.RESET_DELAY);
        } else {
            state.dragState.hasMoved = false;
        }
    }

    function setupDragAndDrop(trigger, sidebar) {
        let clickHandled = false;

        trigger.addEventListener('mousedown', (e) => {
            clickHandled = false;
            handleDragStart(e, trigger, false);
        });
        
        trigger.addEventListener('mouseup', () => {
            if (state.dragState.hasMoved || state.dragState.isDragging) {
                clickHandled = false;
                return;
            }
            
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
            }, CONFIG.TIMING.CLICK_DELAY);
        });
        
        trigger.onclick = (e) => {
            if (clickHandled || state.dragState.hasMoved || state.dragState.isDragging) {
                e.preventDefault();
            }
        };

        document.addEventListener('mousemove', (e) => handleDragMove(e, trigger, false));
        document.addEventListener('mouseup', () => handleDragEnd(trigger));

        trigger.addEventListener('touchstart', (e) => {
            clickHandled = false;
            handleDragStart(e, trigger, true);
        });
        document.addEventListener('touchmove', (e) => handleDragMove(e, trigger, true));
        document.addEventListener('touchend', () => handleDragEnd(trigger));
    }

    // --- 滚动锁定功能 ---
    function lockScroll(history) {
        if (!history || state.scrollLocked) return;
        
        state.scrollLocked = true;
        state.savedScrollPosition.top = history.scrollTop;
        state.savedScrollPosition.left = history.scrollLeft;
        
        // 禁用滚动：设置 overflow: hidden
        history.style.overflow = 'hidden';
        history.style.pointerEvents = 'none';
    }

    function unlockScroll(history) {
        if (!history || !state.scrollLocked) return;
        
        state.scrollLocked = false;
        
        // 恢复滚动
        history.style.overflow = '';
        history.style.pointerEvents = '';
        
        // 恢复滚动位置
        requestAnimationFrame(() => {
            history.scrollTop = state.savedScrollPosition.top;
            history.scrollLeft = state.savedScrollPosition.left;
        });
    }

    // --- 选择功能 ---
    function getCheckboxColumn() {
        const history = document.querySelector(CONFIG.SELECTORS.history);
        if (!history) return null;
        
        let column = document.getElementById('export-cb-column');
        if (!column) {
            column = document.createElement('div');
            column.id = 'export-cb-column';
            history.appendChild(column);
        }
        return column;
    }

    // 辅助函数：获取消息和列
    function getMessagesAndColumn() {
        const history = document.querySelector(CONFIG.SELECTORS.history);
        if (!history) return null;
        syncCheckboxes();
        const messages = history.querySelectorAll(CONFIG.SELECTORS.messages);
        const column = getCheckboxColumn();
        if (!column) return null;
        return { history, messages, column };
    }

    function handleSelectAll() {
        const data = getMessagesAndColumn();
        if (!data) return;
        
        const { messages, column } = data;
        messages.forEach((msg, idx) => {
            state.selectedMessages.add(idx);
            const wrapper = column.querySelector(`.cb-wrapper[data-idx="${idx}"]`);
            const checkbox = wrapper?.querySelector('.cb-input');
            if (checkbox) checkbox.checked = true;
        });
        updatePreview();
    }

    function handleInvertSelect() {
        const data = getMessagesAndColumn();
        if (!data) return;
        
        const { messages, column } = data;
        messages.forEach((msg, idx) => {
            const wrapper = column.querySelector(`.cb-wrapper[data-idx="${idx}"]`);
            const checkbox = wrapper?.querySelector('.cb-input');
            if (checkbox) {
                if (state.selectedMessages.has(idx)) {
                    state.selectedMessages.delete(idx);
                    checkbox.checked = false;
                } else {
                    state.selectedMessages.add(idx);
                    checkbox.checked = true;
                }
            }
        });
        updatePreview();
    }

    function handleClearSelect() {
        const data = getMessagesAndColumn();
        if (!data) return;
        
        const { column } = data;
        state.selectedMessages.clear();
        column.querySelectorAll('.cb-input').forEach(checkbox => {
            checkbox.checked = false;
        });
        updatePreview();
    }

    function syncCheckboxes() {
        const history = document.querySelector(CONFIG.SELECTORS.history);
        if (!history) return;
        
        // 如果滚动被锁定，保存当前滚动位置（防止在锁定期间位置变化）
        if (state.scrollLocked) {
            state.savedScrollPosition.top = history.scrollTop;
            state.savedScrollPosition.left = history.scrollLeft;
        }
        
        const column = getCheckboxColumn();
        if (!column) return;
        
        const messages = history.querySelectorAll(CONFIG.SELECTORS.messages);
        messages.forEach((msg, idx) => {
            msg.setAttribute('data-export-idx', idx);
            
            let wrapper = column.querySelector(`.cb-wrapper[data-idx="${idx}"]`);
            if (!wrapper) {
                wrapper = document.createElement('div');
                wrapper.className = 'cb-wrapper';
                wrapper.dataset.idx = idx;
                
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'cb-input';
                checkbox.checked = state.selectedMessages.has(idx);
                checkbox.onchange = (e) => {
                    e.target.checked ? state.selectedMessages.add(idx) : state.selectedMessages.delete(idx);
                    updatePreview();
                };
                
                wrapper.appendChild(checkbox);
                column.appendChild(wrapper);
            }
            
            const rect = msg.getBoundingClientRect();
            const parentRect = history.getBoundingClientRect();
            wrapper.style.top = `${rect.top - parentRect.top + history.scrollTop + CONFIG.UI.CHECKBOX_OFFSET}px`;
        });
    }

    /**
     * 获取最终的 Markdown 文本（统一入口）
     * @returns {string} - 处理后的最终 Markdown 文本
     */
    function getFinalMarkdown() {
        if (!HTMLToMarkdown) {
            console.error('[Gemini Export] HTMLToMarkdown not available');
            return '';
        }
        
        const sortedIndices = Array.from(state.selectedMessages).sort((a, b) => a - b);
        const messages = [];

        // 收集所有选中的消息
        sortedIndices.forEach((idx) => {
            const el = document.querySelector(`[data-export-idx="${idx}"]`);
            if (!el) return;
            
            const isUser = el.tagName === 'USER-QUERY';
            messages.push({ element: el, isUser });
        });

        // 使用 html-to-markdown.js 中的合并函数
        const result = HTMLToMarkdown.mergeMessagesToMarkdown(messages, CONFIG.SELECTORS);
        
        return result;
    }

    function updatePreview() {
        if (!HTMLToMarkdown) {
            console.error('[Gemini Export] HTMLToMarkdown not available');
            return;
        }
        
        const preview = document.getElementById('gemini-md-preview-pre') || document.getElementById('gemini-md-preview');
        const cleaned = getFinalMarkdown();
        const text = cleaned || "请勾选消息以开始导出";
        
        // 直接使用原始文本，不进行 HTML 转义，确保显示和复制的内容一致
        if (preview && preview.tagName === 'PRE') {
            preview.textContent = text;
        } else {
            // 如果不是 <pre>，确保使用 <pre> 标签
            const container = document.getElementById('gemini-md-preview');
            if (container) {
                const pre = document.createElement('pre');
                pre.id = 'gemini-md-preview-pre';
                pre.textContent = text;
                container.innerHTML = '';
                container.appendChild(pre);
            }
        }
    }

    // --- 导出功能 ---
    async function handleCopy() {
        const text = getFinalMarkdown();
        if (!text || text.startsWith("请勾选")) return;
        
        const manager = setupExportButton('gemini-copy');
        if (!manager) return;
        
        try {
            await navigator.clipboard.writeText(text);
            manager.showFeedback('✓', '已复制', true);
        } catch (err) {
            console.error('[Gemini Export] Copy failed:', err);
            manager.showFeedback('✗', '复制失败', false);
        }
    }

    function handleDownload() {
        const text = getFinalMarkdown();
        if (!text || text.startsWith("请勾选")) return;
        
        const manager = setupExportButton('gemini-download');
        if (!manager) return;
        
        try {
            const blob = new Blob([text], { type: 'text/markdown' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Gemini_Export_${Date.now()}.md`;
            a.click();
            URL.revokeObjectURL(url);
            manager.showFeedback('✓', '已下载', true);
        } catch (err) {
            console.error('[Gemini Export] Download failed:', err);
            manager.showFeedback('✗', '下载失败', false);
        }
    }

    // --- 初始化 ---
    async function init() {
        // Check if extension is enabled
        let enabled = true; // 默认启用
        try {
            const result = await safeGetStorage(['extensionEnabled'], { extensionEnabled: true });
            enabled = result.extensionEnabled !== false; // Default to true
        } catch (err) {
            console.error('[Gemini Export] Failed to check extension status:', err);
            // 如果出错，默认启用扩展
            enabled = true;
        }
        
        if (!enabled) {
            // Extension is disabled, remove any existing UI and return
            const sidebar = document.getElementById('gemini-export-sidebar');
            const trigger = document.getElementById('gemini-export-trigger');
            const column = document.getElementById('export-cb-column');
            const themeStyle = document.getElementById('gemini-export-theme-style');
            if (sidebar) sidebar.remove();
            if (trigger) trigger.remove();
            if (column) column.remove();
            if (themeStyle) themeStyle.remove();
            // Clean up observers
            if (state.observer) {
                state.observer.disconnect();
                state.observer = null;
            }
            if (state.themeObserver) {
                state.themeObserver.disconnect();
                state.themeObserver = null;
            }
            return;
        }
        
        injectUI();
        const history = document.querySelector(CONFIG.SELECTORS.history);
        if (history) {
            history.addEventListener('scroll', () => {
                // 如果滚动被锁定，忽略滚动事件
                if (state.scrollLocked) return;
                
                if (state.sidebar?.classList.contains('open')) {
                    requestAnimationFrame(syncCheckboxes);
                }
            }, { passive: true });
            
            if (state.observer) state.observer.disconnect();
            state.observer = new MutationObserver(() => {
                // 如果滚动被锁定，忽略 MutationObserver 回调
                if (state.scrollLocked) return;
                
                if (state.sidebar?.classList.contains('open')) {
                    syncCheckboxes();
                }
            });
            state.observer.observe(history, { childList: true, subtree: true });
        }
        
        setTimeout(updateTheme, CONFIG.TIMING.THEME_UPDATE_DELAY);
    }

    setInterval(() => {
        if (state.lastUrl !== location.href) {
            state.lastUrl = location.href;
            state.selectedMessages.clear();
            const col = document.getElementById('export-cb-column');
            if (col) col.innerHTML = '';
            updatePreview();
            setTimeout(init, CONFIG.TIMING.INIT_DELAY);
        }
    }, CONFIG.TIMING.URL_CHECK_INTERVAL);
    
    if (document.readyState === 'complete') {
        init();
    } else {
        window.addEventListener('load', init);
    }
})();