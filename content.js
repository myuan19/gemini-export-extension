/**
 * Gemini to Markdown - Content Script
 * Injects UI and extracts conversation data from Gemini pages
 */

(function() {
  'use strict';

  // State management
  const state = {
    selectedMessages: new Set(),
    sidebar: null,
    triggerButton: null,
    observer: null,
    isInitialized: false,
    updateTimeout: null,
    lastChatHistoryId: null, // 用于检测对话切换
    chatHistoryObserver: null, // 监听聊天历史容器的变化
    scrollTimeout: null, // 滚动节流定时器
    scrollHandler: null, // 滚动事件处理器引用
    lastScrollTime: 0, // 上次滚动检查的时间戳
    isClearingCheckboxes: false, // 清理复选框的标志，防止清理期间重复操作
    clearCheckboxesTimeout: null, // 清理复选框的定时器
    checkboxProtectionUntil: 0, // 复选框保护期结束时间戳，保护期内不允许清理
    messageIntersectionObserver: null, // IntersectionObserver 用于检测新出现的消息
    copyButtonListenerAdded: false // 标记是否已添加复制按钮监听器
  };

  // Constants
  const SIDEBAR_WIDTH = 420;
  const CHECKBOX_UPDATE_DELAY = 200;
  const MESSAGE_UPDATE_DELAY = 300;

  /**
   * Create the sidebar panel
   */
  function createSidebar() {
    if (state.sidebar) return state.sidebar;

    const sidebar = document.createElement('div');
    sidebar.id = 'gemini-export-sidebar';
    sidebar.className = 'gemini-export-sidebar';
    sidebar.innerHTML = `
      <div class="gemini-export-header">
        <h3>Gemini to Markdown</h3>
        <button id="gemini-export-close" class="gemini-export-close-btn" aria-label="Close sidebar">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="5" y1="5" x2="15" y2="15"></line>
            <line x1="15" y1="5" x2="5" y2="15"></line>
          </svg>
        </button>
      </div>
      <div class="gemini-export-content">
        <div class="gemini-export-preview" id="gemini-export-preview">
          <p class="gemini-export-placeholder">
            请勾选左侧的消息以开始导出
          </p>
        </div>
      </div>
      <div class="gemini-export-footer">
        <button id="gemini-export-copy" class="gemini-export-btn gemini-export-btn-primary">
          Copy
        </button>
        <button id="gemini-export-download" class="gemini-export-btn gemini-export-btn-secondary">
          Export Markdown
        </button>
      </div>
    `;

    injectStyles();
    document.body.appendChild(sidebar);

    // Bind events
    document.getElementById('gemini-export-close').addEventListener('click', closeSidebar);
    document.getElementById('gemini-export-copy').addEventListener('click', handleCopy);
    document.getElementById('gemini-export-download').addEventListener('click', handleDownload);

    state.sidebar = sidebar;
    return sidebar;
  }

  /**
   * Inject CSS styles
   */
  function injectStyles() {
    if (document.getElementById('gemini-export-styles')) return;

    const style = document.createElement('style');
    style.id = 'gemini-export-styles';
    style.textContent = `
      /* 使用 CSS 变量以便动态调整 */
      :root {
        --gemini-export-sidebar-width: ` + SIDEBAR_WIDTH + `px;
      }
      /* Sidebar - 悬浮显示 */
      #gemini-export-sidebar {
        position: fixed;
        top: 0;
        right: 0;
        width: var(--gemini-export-sidebar-width);
        max-width: 90vw;
        height: 100vh;
        background: #ffffff;
        box-shadow: -2px 0 12px rgba(0, 0, 0, 0.15);
        z-index: 2147483647;
        display: flex;
        flex-direction: column;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        transform: translateX(100%);
        transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      }

      #gemini-export-sidebar.open {
        transform: translateX(0);
      }

      /* 当侧边栏打开时，在中间插入复选框列，右侧显示侧边栏 */
      body.gemini-export-sidebar-open {
        /* 不改变 body 的布局 */
      }

      /* 侧边栏悬浮，不影响布局 */
      body.gemini-export-sidebar-open .main-content,
      body.gemini-export-sidebar-open .content-container,
      body.gemini-export-sidebar-open .chat-container,
      body.gemini-export-sidebar-open chat-window-content {
        /* 不改变原有布局 */
      }

      /* Header */
      .gemini-export-header {
        padding: 16px 20px;
        border-bottom: 1px solid #e0e0e0;
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: #fafafa;
      }

      .gemini-export-header h3 {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
        color: #202124;
      }

      .gemini-export-close-btn {
        background: none;
        border: none;
        cursor: pointer;
        color: #5f6368;
        padding: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        transition: all 0.2s;
      }

      .gemini-export-close-btn:hover {
        background: #f1f3f4;
        color: #202124;
      }

      /* Content */
      .gemini-export-content {
        flex: 1;
        overflow-y: auto;
        padding: 20px;
        background: #ffffff;
      }

      .gemini-export-preview {
        white-space: pre-wrap;
        font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', monospace;
        font-size: 13px;
        line-height: 1.6;
        color: #202124;
        word-wrap: break-word;
      }

      .gemini-export-placeholder {
        color: #9aa0a6;
        text-align: center;
        padding: 40px 20px;
        margin: 0;
        font-size: 14px;
      }

      /* Footer */
      .gemini-export-footer {
        padding: 16px 20px;
        border-top: 1px solid #e0e0e0;
        display: flex;
        gap: 12px;
        background: #fafafa;
      }

      .gemini-export-btn {
        flex: 1;
        padding: 10px 16px;
        border: none;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .gemini-export-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .gemini-export-btn-primary {
        background: #1a73e8;
        color: white;
      }

      .gemini-export-btn-primary:hover:not(:disabled) {
        background: #1557b0;
      }

      .gemini-export-btn-secondary {
        background: #f1f3f4;
        color: #202124;
      }

      .gemini-export-btn-secondary:hover:not(:disabled) {
        background: #e8eaed;
      }

      /* 中间列容器 - 用于放置复选框，位于聊天历史容器内 */
      #gemini-export-checkbox-column {
        position: absolute;
        left: 0;
        top: 0;
        width: 60px;
        min-height: 100%;
        z-index: 2147483645;
        pointer-events: none;
        display: none;
        overflow: visible;
        background: transparent;
      }

      /* 只在侧边栏打开时显示中间列 */
      body.gemini-export-sidebar-open #gemini-export-checkbox-column {
        display: block;
      }

      /* 为聊天历史容器添加左侧padding，为复选框列留出空间 */
      body.gemini-export-sidebar-open infinite-scroller.chat-history {
        padding-left: 60px;
        position: relative;
      }

      /* 复选框包装器 */
      .gemini-export-checkbox-wrapper {
        position: absolute;
        left: 20px;
        width: 20px;
        height: 20px;
        z-index: 2147483646;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: auto;
        transition: top 0.1s ease-out;
      }

      .gemini-export-checkbox {
        width: 20px;
        height: 20px;
        cursor: pointer;
        margin: 0;
        accent-color: #1a73e8;
        flex-shrink: 0;
        pointer-events: auto;
      }

      .gemini-export-message-wrapper {
        position: relative;
        min-height: 0;
        display: contents; /* 关键：让wrapper不参与布局，保持原始DOM结构，避免内容重叠 */
      }

      /* Responsive */
      @media (max-width: 768px) {
        #gemini-export-sidebar {
          width: 100vw;
          max-width: 100vw;
        }
      }
    `;

    document.head.appendChild(style);
  }

  /**
   * Create trigger button
   */
  function createTriggerButton() {
    if (state.triggerButton) return state.triggerButton;

    const button = document.createElement('button');
    button.id = 'gemini-export-trigger';
    button.className = 'gemini-export-trigger';
    button.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M4 2h8v12H4V2z"></path>
        <path d="M6 6h4M6 9h4M6 12h2"></path>
      </svg>
      <span>Export</span>
    `;

    button.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 2147483647;
      padding: 10px 16px;
      background: #1a73e8;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      transition: all 0.2s;
      display: flex;
      align-items: center;
      gap: 6px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    button.addEventListener('mouseenter', () => {
      button.style.background = '#1557b0';
      button.style.transform = 'translateY(-1px)';
      button.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.2)';
    });

    button.addEventListener('mouseleave', () => {
      button.style.background = '#1a73e8';
      button.style.transform = 'translateY(0)';
      button.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.15)';
    });

    button.addEventListener('click', toggleSidebar);

    document.body.appendChild(button);
    state.triggerButton = button;
    return button;
  }

  /**
   * Toggle sidebar visibility
   */
  function toggleSidebar() {
    if (!state.sidebar) {
      createSidebar();
    }
    const isOpening = !state.sidebar.classList.contains('open');
    state.sidebar.classList.toggle('open');
    
    // 当侧边栏打开时，收缩页面内容（使用 CSS 类，更高效）
    if (isOpening) {
      document.body.classList.add('gemini-export-sidebar-open');
    } else {
      document.body.classList.remove('gemini-export-sidebar-open');
    }
  }

  /**
   * Close sidebar
   */
  function closeSidebar() {
    if (state.sidebar) {
      state.sidebar.classList.remove('open');
      document.body.classList.remove('gemini-export-sidebar-open');
    }
  }

  /**
   * Find message elements using multiple selector strategies
   * 按照 DOM 中的实际顺序返回
   */
  function findMessageElements() {
    const chatHistory = document.querySelector('infinite-scroller.chat-history');
    if (!chatHistory) {
      return [];
    }
    
    // 直接按照 DOM 顺序查找所有消息元素
    const allMessages = chatHistory.querySelectorAll('user-query, model-response');
    const foundMessages = new Set();
    
    // 按照 DOM 顺序处理
    allMessages.forEach(el => {
      // 排除已经处理过的元素
      if (el.dataset.geminiExportProcessed === 'true') {
        return;
      }
      
      // 排除侧边栏内的元素
      if (el.closest('#gemini-export-sidebar')) {
        return;
      }
      
      // 排除插件添加的元素
      if (el.closest('#gemini-export-trigger')) {
        return;
      }
      
      // 排除复选框包装器
      if (el.classList.contains('gemini-export-checkbox-wrapper')) {
        return;
      }
      
      // 确定目标元素
      let targetElement = el;
      
      // 对于 user-query，直接使用它
      if (el.tagName === 'USER-QUERY') {
        targetElement = el;
      }
      // 对于 model-response，直接使用它
      else if (el.tagName === 'MODEL-RESPONSE') {
        targetElement = el;
      }
      
      // 过滤掉非消息元素（至少要有一定长度的文本内容）
      const text = targetElement.textContent?.trim() || '';
      if (text.length > 1) { // 至少1个字符（用户可能只发一个数字）
        foundMessages.add(targetElement);
      }
    });
    
    // 按照 DOM 中的实际顺序排序
    const sortedMessages = Array.from(foundMessages).sort((a, b) => {
      const position = a.compareDocumentPosition(b);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
        return -1; // a 在 b 之前
      } else if (position & Node.DOCUMENT_POSITION_PRECEDING) {
        return 1; // a 在 b 之后
      }
      return 0;
    });
    
    return sortedMessages;
  }

  /**
   * Determine message role (user or assistant)
   */
  function getMessageRole(element) {
    // 根据实际 DOM 结构判断角色
    // user-query 表示用户消息
    if (element.tagName === 'USER-QUERY' || element.closest('user-query')) {
      return 'user';
    }
    
    // model-response 表示 AI 回复
    if (element.tagName === 'MODEL-RESPONSE' || element.closest('model-response')) {
      return 'assistant';
    }
    
    // 检查类名和属性
    const userIndicators = [
      '[data-message-author-role="user"]',
      '[data-author="user"]',
      '.user-message',
      '[class*="user-query"]',
      '[class*="user-query"]',
      '[class*="User"]',
      'user-message-container',
      'user-query-container',
      'user-query-bubble'
    ];

    const modelIndicators = [
      '[data-message-author-role="model"]',
      '[data-author="model"]',
      '.model-message',
      '[class*="model"]',
      '[class*="Model"]',
      '[class*="assistant"]',
      '[class*="Assistant"]',
      'model-response',
      'response-container',
      'structured-content-container'
    ];

    // 检查元素本身
    for (const indicator of userIndicators) {
      if (element.matches && element.matches(indicator)) {
        return 'user';
      }
    }

    for (const indicator of modelIndicators) {
      if (element.matches && element.matches(indicator)) {
        return 'assistant';
      }
    }

    // 检查子元素
    for (const indicator of userIndicators) {
      if (element.querySelector(indicator)) {
        return 'user';
      }
    }

    for (const indicator of modelIndicators) {
      if (element.querySelector(indicator)) {
        return 'assistant';
      }
    }

    // 检查父元素
    const parent = element.parentElement;
    if (parent) {
      // 检查父元素是否是 user-query
      if (parent.tagName === 'USER-QUERY' || parent.closest('user-query')) {
        return 'user';
      }
      // 检查父元素是否是 model-response
      if (parent.tagName === 'MODEL-RESPONSE' || parent.closest('model-response')) {
        return 'assistant';
      }
      
      for (const indicator of userIndicators) {
        if (parent.matches && parent.matches(indicator)) {
          return 'user';
        }
        if (parent.querySelector(indicator)) {
          return 'user';
        }
      }
      
      for (const indicator of modelIndicators) {
        if (parent.matches && parent.matches(indicator)) {
          return 'assistant';
        }
        if (parent.querySelector(indicator)) {
          return 'assistant';
        }
      }
    }

    // 默认返回 assistant（因为大多数情况下是 AI 回复）
    return 'assistant';
  }

  /**
   * 获取 Gemini 复制按钮会复制的内容
   * 通过模拟点击复制按钮并从剪贴板读取
   */
  /**
   * 获取 Gemini 复制按钮会复制的内容
   * 不实际点击，直接获取复制按钮关联的内容
   */
  function getCopyButtonContent(messageElement) {
    try {
      // 找到消息块中的复制按钮
      // 复制按钮可能在消息块内部，也可能在父元素的操作栏中
      let copyButton = messageElement.querySelector('.mat-mdc-button-touch-target, button[aria-label*="copy" i], button[aria-label*="复制" i], [aria-label*="Copy" i]');
      
      // 如果没找到，尝试向上查找
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
      
      if (!copyButton) {
        return null;
      }
      
      // 找到复制按钮的父容器（通常是操作栏）
      const actionBar = copyButton.closest('[role="toolbar"], [class*="action"], [class*="button-group"]');
      
      // 尝试找到消息内容区域
      // 对于 user-query，查找实际的内容元素
      let contentElement = null;
      if (messageElement.tagName === 'USER-QUERY') {
        contentElement = messageElement.querySelector('.user-query-bubble-with-background') 
          || messageElement.querySelector('.user-query-content')
          || messageElement;
      }
      // 对于 model-response，查找 container
      else if (messageElement.tagName === 'MODEL-RESPONSE') {
        contentElement = messageElement.querySelector('div.container') || messageElement;
      }
      else {
        contentElement = messageElement;
      }
      
      if (!contentElement) {
        return null;
      }
      
      // 获取内容元素的完整内容（包括代码块）
      // 创建一个克隆，移除不需要的元素
      const clone = contentElement.cloneNode(true);
      
      // 移除其他不需要的元素（如按钮、图标等），但保留代码块
      clone.querySelectorAll('button, .icon, svg, img, .mat-mdc-button-touch-target').forEach(el => {
        el.remove();
      });
      
      // 递归函数：将 DOM 节点转换为保留 Markdown 格式的文本
      function nodeToText(node) {
        if (node.nodeType === Node.TEXT_NODE) {
          return node.textContent || '';
        }
        
        if (node.nodeType !== Node.ELEMENT_NODE) {
          return '';
        }
        
        const tagName = node.tagName.toLowerCase();
        let result = '';
        
        // 处理代码块
        if (tagName === 'pre') {
          const code = node.querySelector('code');
          if (code) {
            const language = code.className.match(/language-(\w+)/)?.[1] || '';
            let codeText = code.textContent || '';
            // 确保代码块末尾只有一个换行符（在结束的```前面）
            // 移除末尾的所有换行符，然后添加一个换行符
            codeText = codeText.replace(/\n+$/, '') + '\n';
            return `\`\`\`${language}\n${codeText}\`\`\``;
          }
          return node.textContent || '';
        }
        
        // 处理行内代码
        if (tagName === 'code' && node.parentElement?.tagName.toLowerCase() !== 'pre') {
          const codeText = node.textContent || '';
          return `\`${codeText}\``;
        }
        
        // 处理换行标签
        if (tagName === 'br') {
          return '\n';
        }
        
        // 处理标题
        if (tagName.match(/^h[1-6]$/)) {
          const level = parseInt(tagName[1]);
          const prefix = '#'.repeat(level) + ' ';
          let content = '';
          for (const child of Array.from(node.childNodes)) {
            content += nodeToText(child);
          }
          return '\n' + prefix + content.trim() + '\n\n';
        }
        
        // 处理粗体
        if (tagName === 'strong' || tagName === 'b') {
          let content = '';
          for (const child of Array.from(node.childNodes)) {
            content += nodeToText(child);
          }
          return `**${content.trim()}**`;
        }
        
        // 处理斜体
        if (tagName === 'em' || tagName === 'i') {
          let content = '';
          for (const child of Array.from(node.childNodes)) {
            content += nodeToText(child);
          }
          return `*${content.trim()}*`;
        }
        
        // 处理有序列表
        if (tagName === 'ol') {
          let listItems = [];
          let index = 1;
          for (const child of Array.from(node.childNodes)) {
            if (child.nodeType === Node.ELEMENT_NODE && child.tagName.toLowerCase() === 'li') {
              let itemContent = '';
              for (const grandChild of Array.from(child.childNodes)) {
                itemContent += nodeToText(grandChild);
              }
              listItems.push(`${index}. ${itemContent.trim()}`);
              index++;
            }
          }
          return '\n' + listItems.join('\n') + '\n\n';
        }
        
        // 处理无序列表
        if (tagName === 'ul') {
          let listItems = [];
          for (const child of Array.from(node.childNodes)) {
            if (child.nodeType === Node.ELEMENT_NODE && child.tagName.toLowerCase() === 'li') {
              let itemContent = '';
              for (const grandChild of Array.from(child.childNodes)) {
                itemContent += nodeToText(grandChild);
              }
              listItems.push(`- ${itemContent.trim()}`);
            }
          }
          return '\n' + listItems.join('\n') + '\n\n';
        }
        
        // 处理列表项（单独处理，避免重复）
        if (tagName === 'li') {
          // 这个会在 ul/ol 中处理，这里直接返回内容
          let content = '';
          for (const child of Array.from(node.childNodes)) {
            content += nodeToText(child);
          }
          return content.trim();
        }
        
        // 处理引用
        if (tagName === 'blockquote') {
          let content = '';
          for (const child of Array.from(node.childNodes)) {
            content += nodeToText(child);
          }
          const lines = content.trim().split('\n');
          return '\n' + lines.map(line => `> ${line}`).join('\n') + '\n\n';
        }
        
        // 处理块级元素（前后添加换行）
        const blockElements = ['p', 'div'];
        const isBlockElement = blockElements.includes(tagName);
        
        if (isBlockElement) {
          result += '\n';
        }
        
        // 递归处理子节点
        for (const child of Array.from(node.childNodes)) {
          result += nodeToText(child);
        }
        
        if (isBlockElement) {
          result += '\n';
        }
        
        return result;
      }
      
      // 使用递归函数获取文本内容
      let text = nodeToText(clone);
      text = text.trim();
      
      // 清理多余的连续换行（保留最多2个连续换行）
      text = text.replace(/\n{3,}/g, '\n\n');
      
      return text || null;
    } catch (e) {
      console.error('[Gemini Export] Failed to get copy button content:', e);
      return null;
    }
  }

  /**
   * Extract message content
   * 保留原有的 Markdown 格式
   */
  function extractMessageContent(element) {
    // 创建一个克隆，避免修改原始元素
    const clone = element.cloneNode(true);
    
    // 移除代码块（代码块单独处理）
    clone.querySelectorAll('pre, code').forEach(el => {
      if (el.tagName === 'PRE') {
        el.remove();
      } else if (el.tagName === 'CODE' && el.closest('pre')) {
        // pre 内的 code 已经在上面被 pre 移除了
        return;
      }
    });
    
    // 移除其他不需要的元素（如按钮、图标等）
    clone.querySelectorAll('button, .icon, svg, img').forEach(el => {
      el.remove();
    });
    
    // 获取文本内容，保留原有的格式（包括 Markdown 标记）
    // 使用 textContent 可以保留 Markdown 格式（如 **bold**, *italic* 等）
    let text = clone.textContent || '';
    
    // 只清理首尾空白，保留中间的格式
    text = text.trim();
    
    // 清理多余的连续换行（保留最多2个连续换行，以保持段落格式）
    text = text.replace(/\n{3,}/g, '\n\n');
    
    return text;
  }

  /**
   * Extract code blocks from message
   */
  function extractCodeBlocks(element) {
    const codeBlocks = [];
    // 只选择 pre 元素，避免重复提取（pre code 会被 pre 包含）
    const preElements = element.querySelectorAll('pre');
    const processedCodes = new Set(); // 用于去重
    
    preElements.forEach(pre => {
      const codeEl = pre.querySelector('code') || pre;
      if (codeEl) {
        // 使用代码内容作为唯一标识，避免重复
        const code = codeEl.textContent || '';
        const codeHash = code.trim();
        
        // 如果这个代码块已经处理过，跳过
        if (processedCodes.has(codeHash)) {
          return;
        }
        processedCodes.add(codeHash);
        
        const language = 
          codeEl.className.match(/language-(\w+)/)?.[1] ||
          codeEl.getAttribute('data-language') ||
          pre.className.match(/language-(\w+)/)?.[1] ||
          'text';
        
        if (code.trim()) {
          codeBlocks.push({ language, code });
        }
      }
    });
    
    return codeBlocks;
  }

  /**
   * Add checkboxes to messages
   */
  function addCheckboxesToMessages() {
    // 如果正在清理复选框，直接返回，避免在清理期间添加复选框
    if (state.isClearingCheckboxes) {
      return;
    }
    
    // 首先检查聊天历史容器是否存在，如果不存在则直接返回
    const chatHistory = document.querySelector('infinite-scroller.chat-history');
    if (!chatHistory) {
      // 容器不存在，可能是页面还在加载或结构已改变，静默返回
      return;
    }
    
    const messages = findMessageElements();
    
    // 获取所有消息元素（按照 DOM 顺序），用于计算实际索引
    const allMessagesInDOM = Array.from(chatHistory.querySelectorAll('user-query, model-response'))
      .filter(el => {
        // 排除侧边栏和插件元素
        return !el.closest('#gemini-export-sidebar') && 
               !el.closest('#gemini-export-trigger') &&
               !el.classList.contains('gemini-export-checkbox-wrapper');
      });
    
    messages.forEach((messageEl) => {
      // 跳过已经处理过的元素
      if (messageEl.dataset.geminiExportProcessed === 'true') {
        return;
      }

      // 检查元素是否还在DOM中
      if (!document.body.contains(messageEl)) {
        return;
      }

      const role = getMessageRole(messageEl);
      if (!role) return;

      // 检查是否已经有复选框（防止重复）
      if (messageEl.querySelector('.gemini-export-checkbox')) {
        messageEl.dataset.geminiExportProcessed = 'true';
        return;
      }

      // 计算消息在 DOM 中的实际索引
      const actualIndex = allMessagesInDOM.indexOf(messageEl);
      if (actualIndex === -1) {
        return; // 消息不在 DOM 中，跳过
      }
      
      const index = actualIndex; // 使用 DOM 中的实际索引

      // 确定目标元素：优先使用 user-query 或 model-response
      let targetElement = messageEl;
      
      // 对于 user-query，直接使用它
      if (messageEl.tagName === 'USER-QUERY') {
        targetElement = messageEl;
      }
      // 对于 user-query-bubble-with-background，找到 user-query 父元素
      else if (messageEl.classList.contains('user-query-bubble-with-background')) {
        const userQuery = messageEl.closest('user-query');
        if (userQuery) {
          // 如果父元素已经处理过，跳过
          if (userQuery.dataset.geminiExportProcessed === 'true') {
            return;
          }
          targetElement = userQuery;
        }
      }
      // 对于 model-response，直接使用它
      else if (messageEl.tagName === 'MODEL-RESPONSE') {
        targetElement = messageEl;
      }
      // 对于其他元素，尝试找到 model-response 父元素
      else {
        const modelResponse = messageEl.closest('model-response');
        if (modelResponse) {
          // 如果父元素已经处理过，跳过
          if (modelResponse.dataset.geminiExportProcessed === 'true') {
            return;
          }
          targetElement = modelResponse;
        }
      }

      // 再次检查目标元素是否还在DOM中
      if (!document.body.contains(targetElement)) {
        return;
      }

      // 检查目标元素是否已经有复选框
      if (targetElement.querySelector('.gemini-export-checkbox')) {
        targetElement.dataset.geminiExportProcessed = 'true';
        return;
      }

      // 标记为已处理（直接在元素上，不创建wrapper）
      targetElement.dataset.geminiExportProcessed = 'true';
      targetElement.dataset.geminiExportIndex = index.toString();
      targetElement.dataset.geminiExportRole = role;

      // 不创建wrapper，直接使用targetElement，保持Angular的DOM结构不变

      // 创建中间列容器（如果不存在）
      let checkboxColumn = document.getElementById('gemini-export-checkbox-column');
      
      // 检查是否已经有复选框（检查中间列容器）
      if (checkboxColumn) {
        const existingCheckbox = checkboxColumn.querySelector(`.gemini-export-checkbox-wrapper[data-message-index="${index}"]`);
        if (existingCheckbox) {
          return;
        }
      }

      // 创建复选框
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'gemini-export-checkbox';
      checkbox.dataset.messageIndex = index.toString();

      // 存储消息数据（使用实际的消息内容元素）
      let contentElement = targetElement;
      
      // 对于 user-query，查找实际的内容元素
      if (targetElement.tagName === 'USER-QUERY') {
        contentElement = targetElement.querySelector('.user-query-bubble-with-background') 
          || targetElement.querySelector('.user-query-content')
          || targetElement;
      }
      // 对于 model-response，查找 container
      else if (targetElement.tagName === 'MODEL-RESPONSE') {
        contentElement = targetElement.querySelector('div.container') || targetElement;
      }
      // 对于 div.container，直接使用
      else if (messageEl.tagName === 'DIV' && messageEl.classList.contains('container')) {
        contentElement = messageEl;
      }
      
      // 获取复制按钮的内容（不使用自己提取的内容）
      const copyButtonContent = getCopyButtonContent(targetElement);
      
      const messageData = {
        index,
        role,
        content: copyButtonContent || '', // 使用复制按钮的内容（已包含代码块）
        codeBlocks: [], // 不再单独提取代码块，因为内容中已包含
        element: contentElement,
        targetElement: targetElement
      };
      // 直接在targetElement上存储数据，不创建wrapper
      targetElement.dataset.messageData = JSON.stringify(messageData);
      targetElement.dataset.messageIndex = index.toString();

      // 处理复选框变化
      checkbox.addEventListener('change', (e) => {
        const checked = e.target.checked;
        const msgIndex = parseInt(e.target.dataset.messageIndex);
        
        if (checked) {
          state.selectedMessages.add(msgIndex);
        } else {
          state.selectedMessages.delete(msgIndex);
        }
        
        updatePreview();
      });

      // 确保中间列容器存在，并附加到聊天历史容器
      if (!checkboxColumn) {
        // 找到聊天历史容器（已经在函数开头检查过，这里应该存在）
        const chatHistory = document.querySelector('infinite-scroller.chat-history');
        if (!chatHistory) {
          // 如果容器不存在，跳过这个消息的处理
          return;
        }
        
        checkboxColumn = document.createElement('div');
        checkboxColumn.id = 'gemini-export-checkbox-column';
        chatHistory.appendChild(checkboxColumn);
        
        // 全局滚动监听（只添加一次，使用防抖优化）
        let rafId = null;
        const updateAllCheckboxPositions = () => {
          if (rafId) return;
          rafId = requestAnimationFrame(() => {
            const checkboxes = checkboxColumn.querySelectorAll('.gemini-export-checkbox-wrapper');
            checkboxes.forEach(cbWrapper => {
              const msgIndex = cbWrapper.dataset.messageIndex;
              // 直接查找元素，不再使用wrapper
              const msgElement = document.querySelector(`[data-message-index="${msgIndex}"]`);
              if (msgElement && document.body.contains(msgElement)) {
                // 找到实际的对齐元素
                let alignElement = null;
                
                // 对于 user-query，查找 .user-query-container
                if (msgElement.tagName === 'USER-QUERY') {
                  alignElement = msgElement.querySelector('.user-query-container') 
                    || msgElement.querySelector('.user-query-bubble-with-background')
                    || msgElement;
                }
                // 对于 model-response，查找 div.container
                else if (msgElement.tagName === 'MODEL-RESPONSE') {
                  alignElement = msgElement.querySelector('div.container') || msgElement;
                }
                // 其他情况，使用元素本身
                else {
                  alignElement = msgElement;
                }
                
                // 计算相对于聊天历史容器的位置
                // getBoundingClientRect() 返回相对于视口的位置
                const chatHistoryRect = chatHistory.getBoundingClientRect();
                const alignElementRect = alignElement.getBoundingClientRect();
                
                // 计算相对于容器的位置：元素相对于视口的位置 - 容器相对于视口的位置 + 容器的滚动距离
                const relativeTop = alignElementRect.top - chatHistoryRect.top + chatHistory.scrollTop;
                
                cbWrapper.style.top = relativeTop + 'px';
              }
            });
            rafId = null;
          });
        };
        
        // 监听聊天历史容器的滚动
        chatHistory.addEventListener('scroll', updateAllCheckboxPositions, { passive: true });
        window.addEventListener('resize', updateAllCheckboxPositions);
        
        // 使用 MutationObserver 监听聊天历史容器高度变化
        const resizeObserver = new MutationObserver(updateAllCheckboxPositions);
        resizeObserver.observe(chatHistory, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['style', 'class']
        });
        
        // 初始更新一次
        setTimeout(updateAllCheckboxPositions, 50);
      }
      
      // 创建复选框包装器并添加到中间列
      const checkboxWrapper = document.createElement('div');
      checkboxWrapper.className = 'gemini-export-checkbox-wrapper';
      checkboxWrapper.dataset.messageIndex = index.toString();
      checkboxWrapper.appendChild(checkbox);
      checkboxColumn.appendChild(checkboxWrapper);
      
      // 查找对齐元素（直接在targetElement上查找）
      let alignElement = null;
      
      // 对于 user-query，查找 .user-query-container
      if (targetElement.tagName === 'USER-QUERY') {
        alignElement = targetElement.querySelector('.user-query-container') 
          || targetElement.querySelector('.user-query-bubble-with-background')
          || targetElement;
      }
      // 对于 model-response，查找 div.container（这是实际内容容器）
      else if (targetElement.tagName === 'MODEL-RESPONSE') {
        alignElement = targetElement.querySelector('div.container') || targetElement;
      }
      // 其他情况，使用元素本身
      else {
        alignElement = targetElement;
      }
      
      // 初始设置位置 - 计算相对于聊天历史容器的位置
      if (chatHistory && document.body.contains(targetElement) && alignElement) {
        // getBoundingClientRect() 返回相对于视口的位置
        const chatHistoryRect = chatHistory.getBoundingClientRect();
        const alignElementRect = alignElement.getBoundingClientRect();
        
        // 计算相对于容器的位置：元素相对于视口的位置 - 容器相对于视口的位置 + 容器的滚动距离
        const relativeTop = alignElementRect.top - chatHistoryRect.top + chatHistory.scrollTop;
        checkboxWrapper.style.top = relativeTop + 'px';
      } else {
        // 备用方案：使用绝对位置
        const rect = alignElement ? alignElement.getBoundingClientRect() : targetElement.getBoundingClientRect();
        checkboxWrapper.style.top = rect.top + 'px';
      }
    });
    
    // 添加复选框后，设置保护期（1秒内不允许清理）
    state.checkboxProtectionUntil = Date.now() + 1000;
  }

  /**
   * Update preview panel
   */
  function updatePreview() {
    const preview = document.getElementById('gemini-export-preview');
    if (!preview) return;

    const copyBtn = document.getElementById('gemini-export-copy');
    const downloadBtn = document.getElementById('gemini-export-download');

    if (state.selectedMessages.size === 0) {
      preview.innerHTML = '<p class="gemini-export-placeholder">请勾选左侧的消息以开始导出</p>';
      if (copyBtn) copyBtn.disabled = true;
      if (downloadBtn) downloadBtn.disabled = true;
      return;
    }

    if (copyBtn) copyBtn.disabled = false;
    if (downloadBtn) downloadBtn.disabled = false;

    const messages = Array.from(state.selectedMessages)
      .sort((a, b) => a - b)
      .map(index => {
        // 直接查找元素，不再使用wrapper
        const element = document.querySelector(`[data-message-index="${index}"]`);
        if (!element || !document.body.contains(element)) return null;
        try {
          const msgData = JSON.parse(element.dataset.messageData);
          
          // 如果内容为空，尝试重新获取复制按钮的内容
          if (!msgData.content || !msgData.content.trim()) {
            const copyButtonContent = getCopyButtonContent(element);
            if (copyButtonContent && copyButtonContent.trim()) {
              msgData.content = copyButtonContent;
            }
          }
          
          return msgData;
        } catch (e) {
          console.error('Failed to parse message data:', e);
          return null;
        }
      })
      .filter(msg => msg !== null && msg.content && msg.content.trim()); // 只保留有内容的消息

    const markdown = convertToMarkdown(messages);
    preview.textContent = markdown;
  }

  /**
   * Convert messages to Markdown format
   */
  function convertToMarkdown(messages) {
    if (!messages || messages.length === 0) return '';

    let markdown = '';
    
    messages.forEach((msg, index) => {
      const role = msg.role === 'user' ? 'You' : 'Gemini';
      markdown += `**${role}:**\n\n`;
      
      // Add content (already includes code blocks in Markdown format)
      const text = msg.content || '';
      if (text.trim()) {
        // 对于 Gemini 的输出，如果代码块最后一行是空行，去掉它
        if (msg.role === 'assistant') {
          let processedText = text;
          
          // 处理格式：语言名称\n\n```\n代码\n```
          // 将语言名称提取到代码块标识符中
          processedText = processedText.replace(/(\w+)\n\n```\n([\s\S]*?)\n```/g, (match, langName, code) => {
            // 将语言名称转换为小写（如 JavaScript -> javascript）
            const lang = langName.toLowerCase();
            // 确保代码块末尾只有一个换行符（在结束的```前面）
            let processedCode = code;
            // 移除末尾的所有换行符，然后添加一个换行符
            processedCode = processedCode.replace(/\n+$/, '') + '\n';
            return `\`\`\`${lang}\n${processedCode}\`\`\``;
          });
          
          // 匹配已有的 Markdown 代码块：```language\n...code...\n``` 或 ```\n...code...\n```
          processedText = processedText.replace(/```(\w+)?\n([\s\S]*?)\n```/g, (match, lang, code) => {
            // 确保代码块末尾只有一个换行符（在结束的```前面）
            // 移除末尾的所有换行符，然后添加一个换行符
            code = code.replace(/\n+$/, '') + '\n';
            // 如果有语言标识，使用它；如果没有，保持空（不添加默认语言）
            return `\`\`\`${lang || ''}\n${code}\`\`\``;
          });
          
          markdown += `${processedText}\n\n`;
        } else {
          markdown += `${text}\n\n`;
        }
      }
      
      // Add separator (except for last message)
      if (index < messages.length - 1) {
        markdown += '\n---\n\n';
      }
    });
    
    return markdown.trim();
  }

  /**
   * 监听 Gemini 的复制按钮，点击时自动添加消息到导出列表
   */
  function setupGeminiCopyButtonListener() {
    // 如果已经添加过监听器，直接返回
    if (state.copyButtonListenerAdded) {
      return;
    }
    
    // 监听所有复制按钮的点击
    document.addEventListener('click', (e) => {
      // 检查是否点击了复制按钮
      // mat-mdc-button-touch-target 是 Material Design 的触摸目标
      // 也可能有 aria-label 包含 copy 或复制的按钮
      const copyButton = e.target.closest('.mat-mdc-button-touch-target, button[aria-label*="copy" i], button[aria-label*="复制" i], [aria-label*="Copy" i]');
      if (!copyButton) return;
      
      // 找到对应的消息元素
      // 复制按钮通常在消息容器内
      let messageElement = copyButton.closest('user-query, model-response');
      
      // 如果没找到，尝试向上查找父元素
      if (!messageElement) {
        let parent = copyButton.parentElement;
        let depth = 0;
        while (parent && depth < 10) {
          if (parent.tagName === 'USER-QUERY' || parent.tagName === 'MODEL-RESPONSE') {
            messageElement = parent;
            break;
          }
          parent = parent.parentElement;
          depth++;
        }
      }
      
      if (!messageElement) return;
      
      // 检查是否已经处理过这个消息
      const messageIndex = messageElement.dataset.messageIndex;
      if (messageIndex === undefined) {
        // 如果消息还没有索引，先添加复选框（这会自动分配索引）
        addCheckboxesToMessages();
        // 等待一下，让复选框添加完成
        setTimeout(() => {
          const updatedIndex = messageElement.dataset.messageIndex;
          if (updatedIndex !== undefined) {
            // 自动勾选对应的复选框
            const checkbox = document.querySelector(`.gemini-export-checkbox[data-message-index="${updatedIndex}"]`);
            if (checkbox && !checkbox.checked) {
              checkbox.checked = true;
              checkbox.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
        }, 200);
      } else {
        // 如果已经有索引，直接勾选对应的复选框
        const checkbox = document.querySelector(`.gemini-export-checkbox[data-message-index="${messageIndex}"]`);
        if (checkbox && !checkbox.checked) {
          checkbox.checked = true;
          checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    }, true); // 使用捕获阶段，确保能捕获到事件
    
    // 标记已添加监听器
    state.copyButtonListenerAdded = true;
  }

  /**
   * Handle copy to clipboard
   */
  async function handleCopy() {
    const preview = document.getElementById('gemini-export-preview');
    if (!preview) return;

    const text = preview.textContent || '';
    if (!text.trim()) {
      showNotification('没有内容可复制', 'error');
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      showNotification('已复制到剪贴板', 'success');
      
      const btn = document.getElementById('gemini-export-copy');
      if (btn) {
        const originalText = btn.textContent;
        btn.textContent = '✓ Copied!';
        btn.style.background = '#34a853';
        
        setTimeout(() => {
          btn.textContent = originalText;
          btn.style.background = '#1a73e8';
        }, 2000);
      }
    } catch (err) {
      console.error('Failed to copy:', err);
      showNotification('复制失败，请手动复制', 'error');
    }
  }

  /**
   * Handle download Markdown file
   */
  function handleDownload() {
    const preview = document.getElementById('gemini-export-preview');
    if (!preview) return;

    const text = preview.textContent || '';
    if (!text.trim()) {
      showNotification('没有内容可导出', 'error');
      return;
    }

    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gemini-conversation-${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showNotification('文件已下载', 'success');
  }

  /**
   * Show notification (simple implementation)
   */
  function showNotification(message, type = 'info') {
    // Simple notification - can be enhanced with a proper notification system
    console.log(`[${type.toUpperCase()}] ${message}`);
  }

  /**
   * Clear all checkboxes and message wrappers
   */
  function clearCheckboxes() {
    // 清理所有复选框
    const checkboxColumn = document.getElementById('gemini-export-checkbox-column');
    if (checkboxColumn) {
      checkboxColumn.innerHTML = '';
    }
    
    // 清理所有消息元素的处理标记
    const processedElements = document.querySelectorAll('[data-gemini-export-processed], [data-gemini-export-index], [data-gemini-export-role]');
    processedElements.forEach(el => {
      el.removeAttribute('data-gemini-export-processed');
      el.removeAttribute('data-gemini-export-index');
      el.removeAttribute('data-gemini-export-role');
    });
    
    // 不清理wrapper，让Gemini自己管理wrapper的删除
    // wrapper使用display: contents，不影响布局，Gemini删除内容时会自动删除wrapper
    
    // 清理选中的消息
    state.selectedMessages.clear();
    
    // 更新预览
    updatePreview();
  }

  /**
   * Check if UI elements still exist, recreate if needed
   */
  function ensureUIElements() {
    // 检查并重新创建触发按钮
    const existingTrigger = document.getElementById('gemini-export-trigger');
    if (!existingTrigger) {
      state.triggerButton = null;
      createTriggerButton();
    } else {
      state.triggerButton = existingTrigger;
    }
    
    // 检查并重新创建侧边栏
    const existingSidebar = document.getElementById('gemini-export-sidebar');
    if (!existingSidebar) {
      state.sidebar = null;
      const wasOpen = document.body.classList.contains('gemini-export-sidebar-open');
      createSidebar();
      // 如果之前是打开状态，恢复打开状态
      if (wasOpen && state.sidebar) {
        state.sidebar.classList.add('open');
        document.body.classList.add('gemini-export-sidebar-open');
      }
    } else {
      state.sidebar = existingSidebar;
    }
    
    // 检查并重新创建复选框列（如果需要）
    const checkboxColumn = document.getElementById('gemini-export-checkbox-column');
    const chatHistory = document.querySelector('infinite-scroller.chat-history');
    if (!checkboxColumn && chatHistory) {
      // 复选框列被移除了，会在 addCheckboxesToMessages 中自动重新创建
    }
  }

  /**
   * Detect conversation switch by monitoring chat history container
   */
  function setupConversationSwitchDetection() {
    const chatHistory = document.querySelector('infinite-scroller.chat-history');
    if (!chatHistory) return;
    
    // 获取当前对话的唯一标识（使用更可靠的方法）
    const getConversationId = () => {
      const messages = chatHistory.querySelectorAll('user-query, model-response');
      if (messages.length === 0) {
        return `empty-${Date.now()}`; // 使用时间戳确保唯一性
      }
      
      // 使用前几个消息的容器ID组合作为标识
      const ids = [];
      for (let i = 0; i < Math.min(3, messages.length); i++) {
        const container = messages[i].closest('[id]');
        if (container && container.id) {
          ids.push(container.id);
        }
      }
      
      // 如果找不到ID，使用消息数量+第一个消息的部分文本
      if (ids.length === 0) {
        const firstText = messages[0].textContent?.trim().substring(0, 30) || '';
        return `msg-${messages.length}-${firstText.length}`;
      }
      
      return ids.join('-');
    };
    
    // 检查对话是否切换（添加防抖和更严格的检查）
    let checkTimeout = null;
    let lastMessageCount = 0;
    let isInitialLoad = true; // 标记是否是首次加载
    let initialLoadTimeout = null;
    
    const checkConversationSwitch = () => {
      // 防抖处理
      if (checkTimeout) {
        clearTimeout(checkTimeout);
      }
      
      checkTimeout = setTimeout(() => {
        const messages = chatHistory.querySelectorAll('user-query, model-response');
        const currentMessageCount = messages.length;
        const currentId = getConversationId();
        
        // 如果是首次加载，等待一段时间让内容稳定
        if (isInitialLoad) {
          // 延迟标记首次加载完成，给页面足够时间加载内容
          if (initialLoadTimeout) {
            clearTimeout(initialLoadTimeout);
          }
          initialLoadTimeout = setTimeout(() => {
            isInitialLoad = false;
            lastMessageCount = currentMessageCount;
            state.lastChatHistoryId = currentId;
          }, 200);
          return;
        }
        
        // 检查对话ID是否变化
        const conversationIdChanged = currentId !== null && 
                                     state.lastChatHistoryId !== null && 
                                     currentId !== state.lastChatHistoryId;
        
        // 如果对话切换了，只更新ID和清理选中的消息，不清理复选框
        // 让复选框跟随消息元素的添加/移除自然同步
        if (conversationIdChanged) {
          state.lastChatHistoryId = currentId;
          lastMessageCount = currentMessageCount;
          
          // 清理选中的消息（因为对话切换了）
          state.selectedMessages.clear();
          updatePreview();
        } else {
          // 更新消息数量和ID（内容可能还在加载）
          lastMessageCount = currentMessageCount;
          if (currentId !== null) {
            state.lastChatHistoryId = currentId;
          }
        }
      }, 100);
    };
    
    // 监听聊天历史容器的变化
    if (state.chatHistoryObserver) {
      state.chatHistoryObserver.disconnect();
    }
    
    state.chatHistoryObserver = new MutationObserver((mutations) => {
      // 只检查对话切换，不主动清理复选框
      // 让复选框跟随消息元素的添加/移除自然同步
      checkConversationSwitch();
    });
    
    state.chatHistoryObserver.observe(chatHistory, {
      childList: true,
      subtree: true
    });
    
    // 初始检查 - 延迟标记首次加载完成
    const messages = chatHistory.querySelectorAll('user-query, model-response');
    lastMessageCount = messages.length;
    state.lastChatHistoryId = getConversationId();
    
    // 标记首次加载，等待一段时间后取消
    isInitialLoad = true;
    initialLoadTimeout = setTimeout(() => {
      isInitialLoad = false;
    }, 300);
  }

  /**
   * 设置滚动监听器
   */
  function setupScrollListener() {
    // 如果已经有滚动监听器，先移除
    if (state.scrollHandler) {
      const chatHistory = document.querySelector('infinite-scroller.chat-history');
      if (chatHistory) {
        chatHistory.removeEventListener('scroll', state.scrollHandler);
      }
      state.scrollHandler = null;
    }
    if (state.scrollTimeout) {
      clearTimeout(state.scrollTimeout);
      state.scrollTimeout = null;
    }
    
    // 如果已经有 IntersectionObserver，先断开
    if (state.messageIntersectionObserver) {
      state.messageIntersectionObserver.disconnect();
      state.messageIntersectionObserver = null;
    }
    
    const chatHistory = document.querySelector('infinite-scroller.chat-history');
    if (!chatHistory) return;
    
    // 添加滚动监听器，减少检查间隔，滚动时立即检查
    const SCROLL_CHECK_INTERVAL = 200; // 从500ms减少到200ms
    
    state.scrollHandler = () => {
      // 检查容器是否存在
      const chatHistory = document.querySelector('infinite-scroller.chat-history');
      if (!chatHistory) {
        return;
      }
      
      // 如果正在清理复选框，跳过
      if (state.isClearingCheckboxes) {
        return;
      }
      
      // 如果复选框在保护期内，跳过
      if (Date.now() < state.checkboxProtectionUntil) {
        return;
      }
      
      const now = Date.now();
      // 如果距离上次检查已经超过间隔时间，则执行检查
      if (now - state.lastScrollTime >= SCROLL_CHECK_INTERVAL) {
        state.lastScrollTime = now;
        addCheckboxesToMessages();
      } else {
        // 如果还没到间隔时间，清除之前的定时器，设置新的定时器
        if (state.scrollTimeout) {
          clearTimeout(state.scrollTimeout);
        }
        const remainingTime = SCROLL_CHECK_INTERVAL - (now - state.lastScrollTime);
        state.scrollTimeout = setTimeout(() => {
          state.lastScrollTime = Date.now();
          addCheckboxesToMessages();
        }, remainingTime);
      }
    };
    
    chatHistory.addEventListener('scroll', state.scrollHandler, { passive: true });
    
    // 使用 IntersectionObserver 检测新出现的消息元素
    state.messageIntersectionObserver = new IntersectionObserver((entries) => {
      // 如果正在清理复选框，跳过
      if (state.isClearingCheckboxes) {
        return;
      }
      
      // 如果复选框在保护期内，跳过
      if (Date.now() < state.checkboxProtectionUntil) {
        return;
      }
      
      let hasNewMessages = false;
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          // 消息进入视口，检查是否需要添加复选框
          const messageEl = entry.target;
          if (messageEl && 
              (messageEl.tagName === 'USER-QUERY' || messageEl.tagName === 'MODEL-RESPONSE') &&
              !messageEl.dataset.geminiExportProcessed) {
            hasNewMessages = true;
          }
        }
      });
      
      if (hasNewMessages) {
        // 延迟一小段时间，确保消息完全渲染
        setTimeout(() => {
          addCheckboxesToMessages();
        }, 50);
      }
    }, {
      root: chatHistory,
      rootMargin: '200px', // 提前200px开始检测，确保滚动时能及时添加复选框
      threshold: 0.1 // 当10%的元素可见时触发
    });
    
    // 观察所有现有的消息元素
    const observeMessages = () => {
      const messages = chatHistory.querySelectorAll('user-query, model-response');
      messages.forEach(msg => {
        if (!msg.dataset.geminiExportObserved) {
          state.messageIntersectionObserver.observe(msg);
          msg.dataset.geminiExportObserved = 'true';
        }
      });
    };
    
    // 初始观察
    observeMessages();
  }

  /**
   * Initialize the extension
   */
  function init() {
    // 确保UI元素存在
    ensureUIElements();
    
    if (state.isInitialized) {
      // 如果已经初始化，检查对话是否切换
      setupConversationSwitchDetection();
      setupScrollListener(); // 确保滚动监听器已设置
      setTimeout(() => {
        addCheckboxesToMessages();
      }, 100); // 减少到100ms，更快显示
      return;
    }
    
    // Create UI elements
    createSidebar();
    createTriggerButton();
    
    // 设置对话切换检测
    setupConversationSwitchDetection();
    
    // Add checkboxes to existing messages
    setTimeout(() => {
      addCheckboxesToMessages();
    }, 100); // 减少到100ms，更快显示
    
    // Observe DOM changes for new messages and navigation
    state.observer = new MutationObserver((mutations) => {
      let shouldUpdate = false;
      let shouldReinit = false;
      let hasNewMessages = false;
      let removedMessageElements = []; // 记录被移除的消息元素
      
      mutations.forEach((mutation) => {
        // 检查是否有节点被移除（可能是导航）
        if (mutation.removedNodes.length > 0) {
          mutation.removedNodes.forEach(node => {
            if (node.nodeType === 1) {
              // 检查是否是我们的元素被移除
              if (node.id === 'gemini-export-trigger' || 
                  node.id === 'gemini-export-sidebar' ||
                  node.id === 'gemini-export-checkbox-column') {
                shouldReinit = true;
              }
              // 检查是否是聊天历史容器被移除
              if (node.classList?.contains('chat-history') || 
                  node.tagName === 'INFINITE-SCROLLER') {
                shouldReinit = true;
                // 重置对话ID
                state.lastChatHistoryId = null;
              }
              
              // 检查是否是消息元素被移除
              if (node.tagName === 'USER-QUERY' || node.tagName === 'MODEL-RESPONSE') {
                removedMessageElements.push(node);
              }
              
              // 检查子元素中是否有消息元素被移除
              const childMessages = node.querySelectorAll('user-query, model-response');
              childMessages.forEach(msg => {
                removedMessageElements.push(msg);
              });
            }
          });
        }
        
        // 只处理添加的节点
        if (mutation.addedNodes.length > 0) {
          // 检查添加的节点是否是消息元素
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === 1) { // Element node
              // 排除插件自己的元素
              if (node.id === 'gemini-export-sidebar' || 
                  node.id === 'gemini-export-trigger') {
                return;
              }
              
              // 检查是否是聊天历史容器
              if (node.classList?.contains('chat-history') || 
                  node.tagName === 'INFINITE-SCROLLER') {
                shouldReinit = true;
                // 重新设置对话切换检测
                setTimeout(() => {
                  setupConversationSwitchDetection();
                }, 100);
              }
              
              // 检查是否是消息元素（user-query 或 model-response）
              if (node.tagName === 'USER-QUERY' || node.tagName === 'MODEL-RESPONSE') {
                hasNewMessages = true;
                // 添加到 IntersectionObserver
                if (state.messageIntersectionObserver && !node.dataset.geminiExportObserved) {
                  state.messageIntersectionObserver.observe(node);
                  node.dataset.geminiExportObserved = 'true';
                }
              }
              
              // 检查子元素中是否有消息元素
              const childMessages = node.querySelectorAll('user-query, model-response');
              if (childMessages.length > 0) {
                hasNewMessages = true;
                childMessages.forEach(msg => {
                  if (state.messageIntersectionObserver && !msg.dataset.geminiExportObserved) {
                    state.messageIntersectionObserver.observe(msg);
                    msg.dataset.geminiExportObserved = 'true';
                  }
                });
              }
              
              // 检查是否是潜在的消息元素
              const text = node.textContent?.trim() || '';
              if (text.length > 10) { // 至少有一些内容
                shouldUpdate = true;
              }
            }
          });
        }
      });
      
      // 处理被移除的消息元素，移除对应的复选框
      if (removedMessageElements.length > 0) {
        const checkboxColumn = document.getElementById('gemini-export-checkbox-column');
        if (checkboxColumn) {
          removedMessageElements.forEach(msgEl => {
            // 获取消息的索引
            const messageIndex = msgEl.dataset.messageIndex || msgEl.dataset.geminiExportIndex;
            if (messageIndex !== undefined) {
              // 找到对应的复选框并移除
              const checkboxWrapper = checkboxColumn.querySelector(
                `.gemini-export-checkbox-wrapper[data-message-index="${messageIndex}"]`
              );
              if (checkboxWrapper) {
                checkboxWrapper.remove();
              }
              
              // 从选中的消息中移除
              state.selectedMessages.delete(parseInt(messageIndex));
            }
          });
          
          // 更新预览
          updatePreview();
        }
      }
      
      if (shouldReinit) {
        // 只有在真正的页面导航时才清理所有复选框
        const chatHistoryExists = document.querySelector('infinite-scroller.chat-history');
        if (!chatHistoryExists) {
          // 页面导航或重要元素变化，清理旧的复选框并重新初始化
          clearTimeout(state.updateTimeout);
          state.updateTimeout = setTimeout(() => {
            clearCheckboxes(); // 先清理旧的复选框
            ensureUIElements();
            setupConversationSwitchDetection();
            setupScrollListener(); // 重新设置滚动监听器
            setTimeout(() => {
              addCheckboxesToMessages();
            }, 100);
          }, 100);
        }
      } else if (hasNewMessages) {
        // 检测到新消息，立即添加复选框（不等待防抖）
        setTimeout(() => {
          addCheckboxesToMessages();
        }, 50);
      } else if (shouldUpdate) {
        // 防抖更新（参考脚本的优化方式）
        clearTimeout(state.updateTimeout);
        state.updateTimeout = setTimeout(() => {
          addCheckboxesToMessages();
        }, MESSAGE_UPDATE_DELAY);
      }
    });
    
    // 定期检查UI元素是否存在（防止被意外移除）
    setInterval(() => {
      if (!document.getElementById('gemini-export-trigger') || 
          !document.getElementById('gemini-export-sidebar')) {
        ensureUIElements();
      }
      // 重新检查对话切换（防止检测失效）
      const chatHistory = document.querySelector('infinite-scroller.chat-history');
      if (chatHistory && !state.chatHistoryObserver) {
        setupConversationSwitchDetection();
      }
      // 确保新消息被添加到 IntersectionObserver
      if (chatHistory && state.messageIntersectionObserver) {
        const messages = chatHistory.querySelectorAll('user-query, model-response');
        messages.forEach(msg => {
          if (!msg.dataset.geminiExportObserved) {
            state.messageIntersectionObserver.observe(msg);
            msg.dataset.geminiExportObserved = 'true';
          }
        });
      }
    }, 2000); // 每2秒检查一次
    
    state.observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    
    // 设置滚动监听器
    setupScrollListener();
    
    // 设置 Gemini 复制按钮监听
    setupGeminiCopyButtonListener();
    
    state.isInitialized = true;
  }

  /**
   * Cleanup function
   */
  function cleanup() {
    // 清理所有复选框和wrapper
    clearCheckboxes();
    
    if (state.observer) {
      state.observer.disconnect();
    }
    if (state.chatHistoryObserver) {
      state.chatHistoryObserver.disconnect();
      state.chatHistoryObserver = null;
    }
    // 清理滚动监听器
    if (state.scrollHandler) {
      const chatHistory = document.querySelector('infinite-scroller.chat-history');
      if (chatHistory) {
        chatHistory.removeEventListener('scroll', state.scrollHandler);
      }
      state.scrollHandler = null;
    }
    if (state.scrollTimeout) {
      clearTimeout(state.scrollTimeout);
      state.scrollTimeout = null;
    }
    state.lastScrollTime = 0; // 重置滚动时间戳
    // 清理复选框清理相关的状态
    if (state.clearCheckboxesTimeout) {
      clearTimeout(state.clearCheckboxesTimeout);
      state.clearCheckboxesTimeout = null;
    }
    state.isClearingCheckboxes = false; // 重置清理标志
    state.checkboxProtectionUntil = 0; // 重置保护期
    // 清理 IntersectionObserver
    if (state.messageIntersectionObserver) {
      state.messageIntersectionObserver.disconnect();
      state.messageIntersectionObserver = null;
    }
    if (state.triggerButton) {
      state.triggerButton.remove();
      state.triggerButton = null;
    }
    if (state.sidebar) {
      state.sidebar.remove();
      state.sidebar = null;
    }
    // 清理中间列容器
    const checkboxColumn = document.getElementById('gemini-export-checkbox-column');
    if (checkboxColumn) {
      checkboxColumn.remove();
    }
    // 清理页面收缩样式
    document.body.classList.remove('gemini-export-sidebar-open');
    state.lastChatHistoryId = null;
    state.isInitialized = false;
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Re-initialize on navigation (for SPAs)
  let lastUrl = location.href;
  const navigationObserver = new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      // URL变化时清理旧的复选框并重新初始化
      clearCheckboxes();
      setTimeout(() => {
        ensureUIElements();
        setTimeout(() => {
          addCheckboxesToMessages();
        }, 200);
      }, 200);
    }
  });
  
  navigationObserver.observe(document, { subtree: true, childList: true });
  
  // 监听 popstate 事件（浏览器前进/后退）
  window.addEventListener('popstate', () => {
    clearCheckboxes();
    setTimeout(() => {
      ensureUIElements();
      setTimeout(() => {
        addCheckboxesToMessages();
      }, 200);
    }, 200);
  });

})();


