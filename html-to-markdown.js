/**
 * HTML to Markdown 转换工具
 * 将 Gemini 聊天界面的 HTML 内容转换为 Markdown 格式
 */
(function() {
    'use strict';

    /**
     * 统一的后处理函数：不做任何处理，直接返回
     * @param {string} markdown - 原始文本
     * @returns {string} - 原始文本（不做处理）
     */
    function postProcessMarkdown(markdown) {
        if (!markdown) return '';
        return markdown;
    }

    /**
     * 核心逻辑：直接返回原始HTML，不做任何转换
     * @param {Node} node - DOM 节点
     * @returns {string} - 原始HTML文本
     */
    function nodeToText(node) {
        if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
        if (node.nodeType !== Node.ELEMENT_NODE) return '';
        
        // 直接返回元素的innerHTML，不做任何转换
        return node.innerHTML || '';
    }

    /**
     * 统一的文本处理函数，整合所有文本处理逻辑
     * @param {HTMLElement} messageElement - 消息元素
     * @param {Object} selectors - 选择器配置对象
     * @returns {string|null} - 处理后的 Markdown 文本，失败返回 null
     */
    function processMessageToMarkdown(messageElement, selectors) {
        try {
            // 直接从 HTML 提取内容，不依赖复制按钮
            const isUser = messageElement.tagName === 'USER-QUERY';
            const contentEl = messageElement.querySelector(
                isUser ? selectors.content.user : selectors.content.model
            ) || messageElement;
            
            // 克隆元素以避免修改原始 DOM
            const clone = contentEl.cloneNode(true);
            
            // 移除不需要的元素：按钮、图标、SVG、图片等
            clone.querySelectorAll('button, .icon, svg, img, mat-icon, .mat-mdc-button-touch-target, [aria-label*="copy" i], [aria-label*="复制" i]').forEach(el => el.remove());
            
            // 获取原始 HTML
            const originalHTML = clone.innerHTML;
            
            // 使用 nodeToText 获取文本（实际上就是原始HTML）
            let text = nodeToText(clone);
            
            if (!text || !text.trim()) {
                return null;
            }
            
            const processed = text.trim();
            
            // 调试：输出原始HTML和转换后的md（在每次转换时触发）
            console.log('[HTML to Markdown] ========== 原始 HTML ==========');
            console.log(originalHTML);
            console.log('[HTML to Markdown] ========== 转换后的 MD ==========');
            console.log(processed);
            
            return processed;
        } catch (e) {
            console.error('[HTML to Markdown] Failed to process message to markdown:', e);
            return null;
        }
    }

    /**
     * 转义 HTML 特殊字符，用于安全地显示 Markdown 文本
     * 保留反斜杠不变，避免 textContent 转义反斜杠的问题
     * @param {string} text - 原始文本
     * @returns {string} - 转义后的 HTML 字符串
     */
    function escapeHtmlForPreview(text) {
        if (!text) return '';
        // 转义 HTML 特殊字符，但保留反斜杠不变
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    /**
     * 合并多条消息为最终的 Markdown 文本
     * @param {Array<{element: HTMLElement, isUser: boolean}>} messages - 消息数组，每个元素包含 element 和 isUser 标志
     * @param {Object} selectors - 选择器配置对象
     * @returns {string} - 合并后的 Markdown 文本
     */
    function mergeMessagesToMarkdown(messages, selectors) {
        const items = [];
        
        messages.forEach(({ element, isUser }) => {
            const processedText = processMessageToMarkdown(element, selectors);
            
            if (processedText) {
                items.push(processedText);
            }
        });
        
        // 合并所有消息
        const finalMarkdown = items.join('\n\n---\n\n');
        
        // 使用统一的后处理函数
        return postProcessMarkdown(finalMarkdown);
    }

    // 导出到全局对象
    if (typeof window !== 'undefined') {
        window.HTMLToMarkdown = {
            processMessageToMarkdown,
            postProcessMarkdown,
            nodeToText,
            escapeHtmlForPreview,
            mergeMessagesToMarkdown
        };
    }
})();

