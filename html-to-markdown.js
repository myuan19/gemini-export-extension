/**
 * HTML to Markdown 转换工具
 * 将 Gemini 聊天界面的 HTML 内容转换为 Markdown 格式
 */
(function() {
    'use strict';

    /**
     * 计算节点的列表嵌套深度
     * @param {Node} node - DOM 节点
     * @returns {number} - 嵌套深度（0表示不在列表中）
     */
    function getListDepth(node) {
        let depth = 0;
        let current = node;
        
        // 如果节点本身在 li 中，从 li 开始计算
        const li = current.closest('li');
        if (li) {
            // 计算有多少层 ul/ol 祖先
            current = li.parentElement; // ul 或 ol
            while (current) {
                const tagName = current.tagName.toLowerCase();
                if (tagName === 'ul' || tagName === 'ol') {
                    depth++;
                    // 继续向上查找是否有嵌套的列表
                    const parentLi = current.closest('li');
                    if (parentLi) {
                        current = parentLi.parentElement; // 上一层的 ul 或 ol
                    } else {
                        break;
                    }
                } else {
                    current = current.parentElement;
                }
            }
        }
        
        return depth;
    }

    /**
     * 计算缩进字符串
     * @param {number} depth - 嵌套深度
     * @returns {string} - 缩进字符串
     */
    function getIndent(depth) {
        if (depth === 0) return '';
        // 一级列表项（depth=1）：3个空格
        // 二级嵌套项（depth=2）：6个空格（但实际示例中是9个，可能是3*3）
        // 三级嵌套项（depth=3）：12个空格（3*4）
        // 根据示例，缩进规则是：depth * 3 个空格
        return '   '.repeat(depth);
    }

    /**
     * 提取代码块的语言标识
     * @param {HTMLElement} codeBlock - code-block 元素
     * @returns {string} - 语言标识（小写）
     */
    function extractCodeBlockLanguage(codeBlock) {
        let langSpan = codeBlock.querySelector('.code-block-decoration.header-formatted span');
        if (!langSpan) {
            langSpan = codeBlock.querySelector('.header-formatted span');
        }
        if (!langSpan) {
            const decoration = codeBlock.querySelector('.code-block-decoration');
            if (decoration) {
                langSpan = decoration.querySelector('span');
            }
        }
        
        if (langSpan) {
            const rawLang = (langSpan.textContent || '').trim();
            const lowerLang = rawLang.toLowerCase();
            
            // 排除空字符串、plaintext、text
            if (lowerLang === '' || lowerLang === 'plaintext' || lowerLang === 'text') {
                return '';
            }
            
            // 特殊处理：C++ 保持为 c++
            if (lowerLang === 'c++') {
                return 'c++';
            }
            
            // 其他语言转换为小写
            return lowerLang;
        }
        
        return '';
    }

    /**
     * 提取代码块的纯文本内容（去除高亮标签）
     * @param {HTMLElement} codeBlock - code-block 元素
     * @returns {string} - 代码文本
     */
    function extractCodeBlockContent(codeBlock) {
        const codeElement = codeBlock.querySelector('code.code-container, code[data-test-id="code-content"]');
        if (codeElement) {
            // 使用 textContent 获取纯文本，去除所有 HTML 标签
            return codeElement.textContent || '';
        }
        return '';
    }

    /**
     * 获取子节点的文本内容
     * @param {Node} node - DOM 节点
     * @returns {string} - 文本内容
     */
    function getChildrenText(node) {
        return Array.from(node.childNodes)
            .map(child => nodeToText(child))
            .join('');
    }

    /**
     * 核心逻辑：DOM 转 Markdown 解析器
     * @param {Node} node - DOM 节点
     * @returns {string} - Markdown 文本
     */
    function nodeToText(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            return node.textContent || '';
        }
        if (node.nodeType !== Node.ELEMENT_NODE) {
            return '';
        }

        const tagName = node.tagName.toLowerCase();

        switch (tagName) {
            // Gemini 特有的 code-block 元素
            case 'code-block': {
                const depth = getListDepth(node);
                const lang = extractCodeBlockLanguage(node);
                const codeText = extractCodeBlockContent(node).trim();
                
                if (!codeText) return '';
                
                // 构建代码块
                const langPart = lang ? lang : '';
                
                if (depth > 0) {
                    // 列表项中的代码块：和段落使用相同的缩进
                    const indent = getIndent(depth);
                    const indentedCode = codeText.split('\n').map(line => indent + line).join('\n');
                    return `\n${indent}\n${indent}\`\`\`${langPart}\n${indentedCode}\n${indent}\`\`\`\n`;
                } else {
                    // 非列表中的代码块
                    return `\n\`\`\`${langPart}\n${codeText}\n\`\`\`\n\n`;
                }
            }

            case 'pre': {
                const code = node.querySelector('code');
                if (code) {
                    const langMatch = code.className.match(/language-(\w+)/);
                    let lang = '';
                    if (langMatch) {
                        const lowerLang = langMatch[1].toLowerCase();
                        if (lowerLang !== 'plaintext' && lowerLang !== 'text') {
                            lang = lowerLang;
                        }
                    }
                    const codeText = (code.textContent || '').trim();
                    return `\n\`\`\`${lang}\n${codeText}\n\`\`\`\n\n`;
                }
                const codeText = node.textContent.trim();
                return `\n\`\`\`\n${codeText}\n\`\`\`\n\n`;
            }

            case 'code':
                // 如果 code 在 code-block 或 pre 中，由父元素处理
                if (node.closest('code-block') || node.closest('pre')) {
                    return node.textContent;
                }
                // 行内代码
                return `\`${node.textContent.trim()}\``;

            case 'br':
                return '\n';

            case 'hr':
                return '\n\n---\n\n';

            case 'strong':
            case 'b':
                return `**${getChildrenText(node).trim()}**`;

            case 'em':
            case 'i': {
                const content = getChildrenText(node);
                const trimmed = content.replace(/^[\s\n]+|[\s\n]+$/g, '');
                return `*${trimmed}*`;
            }

            case 'h1':
            case 'h2':
            case 'h3':
            case 'h4':
            case 'h5':
            case 'h6': {
                let level = parseInt(tagName[1]);
                // h4 降级为 h3
                if (level === 4) {
                    level = 3;
                }
                return `\n\n### ${getChildrenText(node).trim()}\n\n`;
            }

            case 'response-element':
                // 忽略 response-element 包装器，直接返回子内容
                return getChildrenText(node);

            case 'ol': {
                const isNested = node.closest('li') !== null;
                const indent = isNested ? getIndent(getListDepth(node)) : '';
                
                const items = [];
                Array.from(node.childNodes).forEach((child, i) => {
                    if (child.nodeType === 1 && child.tagName.toLowerCase() === 'li') {
                        const content = getChildrenText(child);
                        const cleaned = content.trim();
                        items.push(`${indent}${i + 1}. ${cleaned}`);
                    }
                });
                return `\n${items.join('\n')}\n\n`;
            }

            case 'ul': {
                const isNested = node.closest('li') !== null;
                const indent = isNested ? getIndent(getListDepth(node)) : '';
                
                const items = [];
                Array.from(node.childNodes).forEach(child => {
                    if (child.nodeType === 1 && child.tagName.toLowerCase() === 'li') {
                        const content = getChildrenText(child);
                        const cleaned = content.trim();
                        items.push(`${indent}- ${cleaned}`);
                    }
                });
                return `\n${items.join('\n')}\n\n`;
            }

            case 'li': {
                const depth = getListDepth(node);
                const indent = getIndent(depth);
                
                // 查找代码块（用于提取语言标识）
                const codeBlock = node.querySelector('code-block, response-element code-block');
                let lang = '';
                if (codeBlock) {
                    lang = extractCodeBlockLanguage(codeBlock);
                }
                
                // 处理列表项内容
                let content = '';
                const children = Array.from(node.childNodes);
                let isFirstPara = true;
                
                for (let i = 0; i < children.length; i++) {
                    const child = children[i];
                    if (child.nodeType === Node.ELEMENT_NODE) {
                        const childTag = child.tagName.toLowerCase();
                        
                        // 处理第一个段落
                        if (childTag === 'p' && isFirstPara) {
                            const boldText = child.querySelector('b, strong');
                            const paraText = getChildrenText(child).trim();
                            const boldOnly = boldText && paraText === getChildrenText(boldText).trim();
                            
                            if (boldOnly) {
                                // 第一个段落只有加粗文本，追加语言标识
                                content += `**${getChildrenText(boldText)}**${lang ? lang : ''}`;
                                content += `\n\n`;
                                isFirstPara = false;
                                continue;
                            } else if (boldText) {
                                // 第一个段落有加粗文本和其他内容
                                const boldContent = getChildrenText(boldText);
                                
                                // 获取加粗文本后的内容
                                let afterBoldText = '';
                                let foundBold = false;
                                Array.from(child.childNodes).forEach(n => {
                                    if (n === boldText) {
                                        foundBold = true;
                                    } else if (foundBold) {
                                        afterBoldText += n.nodeType === Node.TEXT_NODE 
                                            ? n.textContent 
                                            : nodeToText(n);
                                    }
                                });
                                afterBoldText = afterBoldText.trim();
                                
                                // 构建结果：加粗文本 + 语言标识
                                let result = `**${boldContent}**${lang ? lang : ''}`;
                                
                                if (afterBoldText) {
                                    result += `\n\n${indent}${afterBoldText}`;
                                } else {
                                    result += `\n\n`;
                                }
                                
                                content += result;
                                isFirstPara = false;
                                continue;
                            } else {
                                // 第一个段落没有加粗文本
                                if (paraText) {
                                    content += `\n\n${indent}${paraText}`;
                                }
                                isFirstPara = false;
                                continue;
                            }
                        }
                        
                        // 处理 response-element（包含代码块）
                        if (childTag === 'response-element') {
                            content += nodeToText(child);
                            continue;
                        }
                        
                        // 处理其他段落
                        if (childTag === 'p') {
                            const paraText = getChildrenText(child).trim();
                            if (paraText) {
                                // 检查前面是否有代码块
                                let prevSibling = child.previousSibling;
                                let hasCodeBlockBefore = false;
                                while (prevSibling) {
                                    if (prevSibling.nodeType === Node.ELEMENT_NODE) {
                                        const prevTag = prevSibling.tagName.toLowerCase();
                                        if (prevTag === 'code-block' || prevTag === 'response-element') {
                                            hasCodeBlockBefore = true;
                                            break;
                                        }
                                    }
                                    prevSibling = prevSibling.previousSibling;
                                }
                                
                                if (hasCodeBlockBefore) {
                                    // 代码块后的段落，只添加一个换行，避免过多空行
                                    content += `\n${indent}${paraText}`;
                                } else {
                                    content += `\n\n${indent}${paraText}`;
                                }
                            }
                            isFirstPara = false;
                            continue;
                        }
                        
                        // 处理其他元素（ul, ol等）
                        content += nodeToText(child);
                        if (childTag === 'p') {
                            isFirstPara = false;
                        }
                    } else if (child.nodeType === Node.TEXT_NODE) {
                        const text = child.textContent.trim();
                        if (text) {
                            if (!isFirstPara) {
                                content += `\n\n${indent}${text}`;
                            } else {
                                content += text;
                            }
                        }
                    }
                }
                
                return content.replace(/^\s+/, '').replace(/\s+$/, '');
            }

            case 'blockquote':
                return `\n> ${getChildrenText(node).trim().replace(/\n/g, '\n> ')}\n\n`;

            case 'p': {
                const text = getChildrenText(node);
                if (!text || !text.trim()) return '';
                
                const isInListItem = node.closest('li') !== null;
                if (isInListItem) {
                    const depth = getListDepth(node);
                    const indent = getIndent(depth);
                    
                    // 检查是否是列表项中的第一个段落
                    const li = node.closest('li');
                    if (li) {
                        const firstPara = li.querySelector('p');
                        const isFirstPara = firstPara === node;
                        
                        // 检查前面是否有代码块
                        let prevSibling = node.previousSibling;
                        let hasCodeBlockBefore = false;
                        while (prevSibling) {
                            if (prevSibling.nodeType === Node.ELEMENT_NODE) {
                                const prevTag = prevSibling.tagName.toLowerCase();
                                if (prevTag === 'code-block') {
                                    hasCodeBlockBefore = true;
                                    break;
                                }
                                if (prevTag === 'response-element') {
                                    if (prevSibling.querySelector('code-block')) {
                                        hasCodeBlockBefore = true;
                                        break;
                                    }
                                }
                            }
                            prevSibling = prevSibling.previousSibling;
                        }
                        
                        if (hasCodeBlockBefore) {
                            // 代码块后的段落，只添加一个换行和缩进，避免过多空行
                            return `\n${indent}${text.trim()}`;
                        }
                        
                        if (isFirstPara) {
                            const boldText = node.querySelector('b, strong');
                            const boldOnly = boldText && text.trim() === getChildrenText(boldText).trim();
                            
                            if (boldOnly) {
                                return text.trim();
                            }
                            
                            if (boldText) {
                                return getChildrenText(node);
                            }
                            
                            return `\n${indent}\n${indent}${text.trim()}`;
                        }
                        
                        return `\n${indent}\n${indent}${text.trim()}`;
                    }
                }
                
                return `\n${text.trim()}\n\n`;
            }

            case 'div':
                return getChildrenText(node);

            case 'table': {
                const rows = [];
                const thead = node.querySelector('thead');
                const tbody = node.querySelector('tbody');
                const allRows = node.querySelectorAll('tr');
                
                let headerRow = null;
                let dataRows = [];
                
                // 处理表头
                if (thead) {
                    headerRow = thead.querySelector('tr');
                } else if (allRows.length > 0) {
                    const firstRow = allRows[0];
                    const hasTh = firstRow.querySelector('th');
                    if (hasTh) {
                        headerRow = firstRow;
                        dataRows = Array.from(allRows).slice(1);
                    }
                }
                
                if (headerRow) {
                    const headers = Array.from(headerRow.querySelectorAll('th, td')).map(cell => {
                        const text = getChildrenText(cell).trim();
                        if (!text.startsWith('**') || !text.endsWith('**')) {
                            return `**${text}**`;
                        }
                        return text;
                    });
                    if (headers.length > 0) {
                        rows.push('| ' + headers.join(' | ') + ' |');
                        rows.push('| ' + headers.map(() => '---').join(' | ') + ' |');
                    }
                }
                
                // 处理表体
                if (dataRows.length === 0) {
                    const source = tbody || node;
                    dataRows = Array.from(source.querySelectorAll('tr'));
                    if (headerRow && !thead) {
                        dataRows = dataRows.slice(1);
                    }
                }
                
                dataRows.forEach(tr => {
                    const cells = Array.from(tr.querySelectorAll('td, th')).map(cell => 
                        getChildrenText(cell).trim()
                    );
                    if (cells.length > 0) {
                        rows.push('| ' + cells.join(' | ') + ' |');
                    }
                });
                
                return rows.length > 0 ? '\n\n' + rows.join('\n') + '\n\n' : '';
            }

            case 'thead':
            case 'tbody':
                return getChildrenText(node);

            case 'tr':
                return getChildrenText(node);

            case 'th':
            case 'td':
                return getChildrenText(node);

            default:
                return getChildrenText(node);
        }
    }

    /**
     * 统一的后处理函数：清理和格式化 Markdown
     * @param {string} markdown - 原始 Markdown 文本
     * @returns {string} - 处理后的 Markdown 文本
     */
    function postProcessMarkdown(markdown) {
        if (!markdown) return '';
        
        let cleaned = markdown;
        
        // 清理多余的空行（保留代码块后的单个空行）
        cleaned = cleaned.replace(/\n{4,}/g, '\n\n');
        
        // 清理行尾空格
        cleaned = cleaned.replace(/[ \t]+$/gm, '');
        
        return cleaned.trim();
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
            
            // 使用 nodeToText 将 HTML 转换为 Markdown
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
