/**
 * HTML to Markdown 转换工具
 * 将 Gemini 聊天界面的 HTML 内容转换为 Markdown 格式
 */
(function() {
    'use strict';

    /**
     * 统一的后处理函数：清理和格式化 Markdown
     * @param {string} markdown - 原始 Markdown 文本
     * @returns {string} - 处理后的 Markdown 文本
     */
    function postProcessMarkdown(markdown) {
        if (!markdown) return '';
        
        // 步骤1: 确保代码块格式正确（移除 Plaintext 语言标签）
        let cleaned = markdown.replace(/```plaintext\n/g, '```\n');
        cleaned = cleaned.replace(/```text\n/g, '```\n');
        
        // 步骤2: 清理行尾空格
        cleaned = cleaned.replace(/[ \t]+$/gm, '');
        
        // 步骤3: 确保代码块前后有适当的空行
        // 代码块后应该有一个空行（特别是在列表项中）
        // 匹配代码块：``` + 可选语言 + 换行 + 代码内容 + 换行 + ```
        cleaned = cleaned.replace(/(```[^\n]*\n[\s\S]*?\n```)(\n*)([^\n\s])/g, (match, codeBlock, newlines, nextChar) => {
            // 如果代码块后没有空行或只有一个换行，添加一个空行
            if (newlines.length <= 1) {
                return codeBlock + '\n\n' + nextChar;
            }
            return match;
        });
        
        // 步骤4: 清理多余的空行（保留代码块后的单个空行）
        // 将4个以上的连续换行符替换为2个（保留代码块前后的空行）
        cleaned = cleaned.replace(/\n{4,}/g, '\n\n');
        
        return cleaned.trim();
    }

    /**
     * 核心逻辑：深度 DOM 转 Markdown 解析器
     * @param {Node} node - DOM 节点
     * @returns {string} - Markdown 文本
     */
    function nodeToText(node) {
        if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
        if (node.nodeType !== Node.ELEMENT_NODE) return '';

        const tagName = node.tagName.toLowerCase();
        const getChildrenText = (n) => Array.from(n.childNodes).map(nodeToText).join('');

        switch (tagName) {
            // Gemini 特有的 code-block 元素
            case 'code-block': {
                // 检查是否在列表项中，并计算嵌套层级
                const li = node.closest('li');
                const isInListItem = li !== null;
                
                // 计算嵌套层级（计算有多少个 ul/ol 祖先，每个代表一个嵌套层级）
                let depth = 0;
                if (isInListItem) {
                    let parent = li.parentElement;
                    while (parent) {
                        const tagName = parent.tagName.toLowerCase();
                        if (tagName === 'ul' || tagName === 'ol') {
                            depth++;
                        }
                        parent = parent.parentElement;
                    }
                }
                
                // 根据嵌套层级计算缩进：每个层级4个空格
                // 一级列表项的代码块（depth=1）：4个空格，二级嵌套项的代码块（depth=2）：8个空格
                const indent = isInListItem ? '    '.repeat(depth) : '';
                
                // 获取语言标识 - 使用多种选择器确保能找到语言标识
                let langSpan = node.querySelector('.code-block-decoration.header-formatted span');
                if (!langSpan) {
                    langSpan = node.querySelector('.header-formatted span');
                }
                if (!langSpan) {
                    // 尝试查找 code-block-decoration 下的第一个 span
                    const decoration = node.querySelector('.code-block-decoration');
                    if (decoration) {
                        langSpan = decoration.querySelector('span');
                    }
                }
                
                let lang = '';
                if (langSpan) {
                    const rawLang = (langSpan.textContent || '').trim();
                    const lowerLang = rawLang.toLowerCase();
                    
                    // 语言处理规则：
                    // 1. 排除 plaintext、text 等通用标签
                    // 2. "代码段" 转换为 python (小写)
                    // 3. 其他语言保留原始大小写（PowerShell, Python, DOS 等）
                    if (lowerLang === 'plaintext' || lowerLang === 'text' || lowerLang === '') {
                        lang = '';
                    } else if (rawLang === '代码段' || lowerLang === '代码段') {
                        lang = 'python'; // "代码段" 转换为 python (小写)
                    } else {
                        lang = rawLang; // 保留原始大小写（PowerShell, Python, DOS 等）
                    }
                }
                
                // 调试输出
                console.log('[HTML to Markdown] 代码块语言提取:', {
                    found: !!langSpan,
                    rawLang: langSpan ? langSpan.textContent : null,
                    finalLang: lang,
                    depth: depth
                });
                
                // 获取代码内容（在 code-container 中）
                const codeElement = node.querySelector('code.code-container, code[data-test-id="code-content"]');
                if (codeElement) {
                    const codeText = (codeElement.textContent || '').trim();
                    // 构建代码块：如果有语言，格式为 ```lang，否则为 ```
                    let result;
                    if (isInListItem) {
                        const indentedCode = codeText.split('\n').map(line => indent + line).join('\n');
                        // 列表项中的代码块：前后都有空行（根据嵌套层级缩进）
                        // 代码块前：空行 + 缩进
                        // 代码块：缩进 + ```lang + 代码内容 + ``` + 缩进
                        // 代码块后：空行 + 缩进
                        result = `\n${indent}\n${indent}\`\`\`${lang}\n${indentedCode}\n${indent}\`\`\`\n${indent}\n`;
                    } else {
                        result = `\n\`\`\`${lang}\n${codeText}\n\`\`\`\n\n`;
                    }
                    
                    // 调试输出：显示生成的代码块格式
                    console.log('[HTML to Markdown] 生成的代码块:', {
                        lang: lang || '(无语言)',
                        isInListItem,
                        depth: depth,
                        indent: indent.length,
                        preview: result.substring(0, 100) + '...'
                    });
                    
                    return result;
                }
                return '';
            }
            
            case 'pre': {
                const code = node.querySelector('code');
                
                if (code) {
                    // 只提取有效的语言标识符，如果没有则留空
                    const langMatch = code.className.match(/language-(\w+)/);
                    let lang = '';
                    if (langMatch) {
                        const rawLang = langMatch[1];
                        // 移除 Plaintext 和 text 语言标签，但保留其他语言
                        const lowerLang = rawLang.toLowerCase();
                        if (lowerLang !== 'plaintext' && lowerLang !== 'text') {
                            lang = lowerLang;
                        }
                    }
                    const codeText = (code.textContent || '').trim();
                    // 构建代码块：如果有语言，格式为 ```lang，否则为 ```
                    const langPart = lang ? lang : '';
                    return `\n\`\`\`${langPart}\n${codeText}\n\`\`\`\n\n`;
                }
                const codeText = node.textContent.trim();
                return `\n\`\`\`\n${codeText}\n\`\`\`\n\n`;
            }

            case 'code':
                // 如果 code 在 code-block 中，直接返回文本内容（不处理，由 code-block 统一处理）
                if (node.closest('code-block')) {
                    return node.textContent;
                }
                
                // 如果 code 在 pre 中，也直接返回文本内容（由 pre 统一处理）
                if (node.parentElement?.tagName.toLowerCase() === 'pre') {
                    return node.textContent;
                }
                
                // 行内代码：不添加前后空格
                return `\`${node.textContent.trim()}\``;

            case 'br': 
                return '\n';
            
            case 'hr':
                return '\n---\n\n';
            
            case 'strong': 
            case 'b': 
                return `**${getChildrenText(node).trim()}**`;
            
            case 'em': 
            case 'i': {
                // 斜体文本：保留内部格式（包括行内代码的空格）
                const content = getChildrenText(node);
                // 只清理首尾空白，保留内部格式和空格
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
                // h4 降级为 h3（根据期望输出规则）
                if (level === 4) {
                    level = 3;
                }
                return `\n${'#'.repeat(level)} ${getChildrenText(node).trim()}\n\n`;
            }
            
            // 忽略 response-element 包装器
            case 'response-element':
                return getChildrenText(node);
            
            case 'ol': {
                // 检查是否在列表项中（嵌套列表）
                const isNested = node.closest('li') !== null;
                // 如果嵌套，缩进4个空格（一级嵌套）
                const indent = isNested ? '    ' : '';
                
                const items = [];
                Array.from(node.childNodes).forEach((child, i) => {
                    if (child.nodeType === 1 && child.tagName.toLowerCase() === 'li') {
                        const content = getChildrenText(child);
                        // 清理前后空白，但保留内部格式（包括加粗、斜体、代码等）
                        const cleaned = content.trim().replace(/^\s+/, '');
                        items.push(`${indent}${i + 1}. ${cleaned}`);
                    }
                });
                return `\n${items.join('\n')}\n\n`;
            }
            
            case 'ul': {
                // 检查是否在列表项中（嵌套列表）
                const isNested = node.closest('li') !== null;
                // 如果嵌套，缩进4个空格（一级嵌套）
                const indent = isNested ? '    ' : '';
                
                const items = [];
                Array.from(node.childNodes).forEach(child => {
                    if (child.nodeType === 1 && child.tagName.toLowerCase() === 'li') {
                        const content = getChildrenText(child);
                        // 清理前后空白，但保留内部格式
                        const cleaned = content.trim().replace(/^\s+/, '');
                        items.push(`${indent}- ${cleaned}`);
                    }
                });
                return `\n${items.join('\n')}\n\n`;
            }
            
            case 'li': {
                // 计算嵌套层级（计算有多少个 ul/ol 祖先，每个代表一个嵌套层级）
                let depth = 0;
                let parent = node.parentElement;
                while (parent) {
                    const tagName = parent.tagName.toLowerCase();
                    if (tagName === 'ul' || tagName === 'ol') {
                        depth++;
                    }
                    parent = parent.parentElement;
                }
                
                // 根据嵌套层级计算缩进：每个层级4个空格
                // 一级列表项（depth=1）：4个空格，二级嵌套项（depth=2）：8个空格
                // 但是段落内容需要额外的4个空格缩进，所以是 depth * 4
                const indent = '    '.repeat(depth);
                
                // 处理列表项内容，保留所有内部格式（加粗、斜体、代码等）
                // 特殊处理：如果列表项中有代码块，需要在第一个加粗文本后添加语言标识
                const codeBlock = node.querySelector('code-block, response-element code-block');
                let langToAppend = '';
                if (codeBlock) {
                    const langSpan = codeBlock.querySelector('.code-block-decoration.header-formatted span, .header-formatted span');
                    if (langSpan) {
                        const rawLang = (langSpan.textContent || '').trim();
                        const lowerLang = rawLang.toLowerCase();
                        if (lowerLang !== 'plaintext' && lowerLang !== 'text' && lowerLang !== '') {
                            langToAppend = rawLang; // 保留原始大小写，如 "Python", "JavaScript"
                        }
                    }
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
                                // 第一个段落只有加粗文本，后面需要空行（4个空格）
                                content += paraText + `\n${indent}\n`;
                                isFirstPara = false;
                                continue;
                            } else if (boldText) {
                                // 第一个段落有加粗文本和其他内容
                                // 获取加粗文本内容
                                const boldContent = getChildrenText(boldText);
                                
                                // 获取段落中加粗文本后的内容
                                let afterBoldText = '';
                                let foundBold = false;
                                Array.from(child.childNodes).forEach(node => {
                                    if (node === boldText) {
                                        foundBold = true;
                                    } else if (foundBold) {
                                        afterBoldText += node.nodeType === Node.TEXT_NODE 
                                            ? node.textContent 
                                            : nodeToText(node);
                                    }
                                });
                                afterBoldText = afterBoldText.trim();
                                
                                // 构建结果：加粗文本
                                let result = `**${boldContent}**`;
                                
                                // 如果加粗文本后有其他内容，需要换行、空行并缩进
                                if (afterBoldText) {
                                    result += `\n${indent}\n${indent}${afterBoldText}`;
                                } else {
                                    // 即使没有其他内容，也需要空行
                                    result += `\n${indent}\n`;
                                }
                                
                                content += result;
                                isFirstPara = false;
                                continue;
                            } else {
                                // 第一个段落没有加粗文本，需要缩进
                                const paraText = getChildrenText(child).trim();
                                if (paraText) {
                                    content += `\n${indent}\n${indent}${paraText}`;
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
                        
                        // 处理其他段落：检查前面是否有代码块
                        if (childTag === 'p') {
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
                            
                            // 所有非第一个段落都需要缩进
                            const paraText = getChildrenText(child).trim();
                            if (paraText) {
                                if (hasCodeBlockBefore) {
                                    // 代码块后的段落：前后都有空行和缩进
                                    content += `\n${indent}\n${indent}${paraText}`;
                                } else {
                                    // 普通段落：前后都有空行和缩进
                                    content += `\n${indent}\n${indent}${paraText}`;
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
                            // 文本节点也需要缩进（如果不是第一个）
                            if (!isFirstPara) {
                                content += `\n${indent}\n${indent}${text}`;
                            } else {
                                content += text;
                            }
                        }
                    }
                }
                
                // 清理前后空白，但保留内部结构
                return content.replace(/^\s+/, '').replace(/\s+$/, '');
            }
            
            case 'blockquote':
                return `\n> ${getChildrenText(node).trim().replace(/\n/g, '\n> ')}\n\n`;
            
            case 'p': {
                const text = getChildrenText(node);
                if (!text || !text.trim()) return '';
                
                const isInListItem = node.closest('li') !== null;
                if (isInListItem) {
                    // 计算嵌套层级（计算有多少个 ul/ol 祖先，每个代表一个嵌套层级）
                    let depth = 0;
                    let parent = node.closest('li');
                    if (parent) {
                        parent = parent.parentElement;
                        while (parent) {
                            const tagName = parent.tagName.toLowerCase();
                            if (tagName === 'ul' || tagName === 'ol') {
                                depth++;
                            }
                            parent = parent.parentElement;
                        }
                    }
                    
                    // 根据嵌套层级计算缩进：每个层级4个空格
                    // 一级列表项的段落（depth=1）：4个空格，二级嵌套项的段落（depth=2）：8个空格
                    const indent = '    '.repeat(depth);
                    
                    // 检查这个段落是否是列表项中的第一个段落
                    const li = node.closest('li');
                    if (li) {
                        const firstPara = li.querySelector('p');
                        const isFirstPara = firstPara === node;
                        
                        // 检查这个段落前面是否有代码块
                        let prevSibling = node.previousSibling;
                        let hasCodeBlockBefore = false;
                        
                        // 向前查找，跳过文本节点和注释节点
                        while (prevSibling) {
                            if (prevSibling.nodeType === Node.ELEMENT_NODE) {
                                const tagName = prevSibling.tagName.toLowerCase();
                                if (tagName === 'code-block') {
                                    hasCodeBlockBefore = true;
                                    break;
                                }
                                if (tagName === 'response-element') {
                                    // 检查 response-element 中是否有 code-block
                                    if (prevSibling.querySelector('code-block')) {
                                        hasCodeBlockBefore = true;
                                        break;
                                    }
                                }
                            }
                            prevSibling = prevSibling.previousSibling;
                        }
                        
                        if (hasCodeBlockBefore) {
                            // 代码块后的段落，需要缩进，前后有空行
                            return `\n${indent}\n${indent}${text.trim()}`;
                        }
                        
                        // 第一个段落：检查是否有加粗文本
                        if (isFirstPara) {
                            const boldText = node.querySelector('b, strong');
                            const boldOnly = boldText && text.trim() === getChildrenText(boldText).trim();
                            
                            // 如果段落中只有加粗文本，直接返回（空行在 li 中处理）
                            if (boldOnly) {
                                return text.trim();
                            }
                            
                            // 如果段落中有加粗文本和其他内容，需要保留段落结构
                            // 让 li 的处理逻辑来处理这种情况，这里返回原始文本（保留换行）
                            if (boldText) {
                                // li 的处理逻辑会直接访问 child.childNodes，不会调用段落处理
                                // 但为了安全，我们返回原始文本结构，不进行任何处理
                                // 这样即使段落处理被调用，也不会干扰 li 的处理
                                return getChildrenText(node);
                            }
                            
                            // 第一个段落没有加粗文本，需要缩进
                            return `\n${indent}\n${indent}${text.trim()}`;
                        }
                        
                        // 普通段落（列表项中的非第一个段落，且不在代码块后），需要缩进
                        if (!hasCodeBlockBefore) {
                            return `\n${indent}\n${indent}${text.trim()}`;
                        }
                        
                        // 其他情况直接返回
                        return text.trim();
                    }
                }
                // 普通段落前后各一个空行
                return `\n${text.trim()}\n\n`;
            }
            
            case 'div': {
                // div 标签直接返回子内容，不添加额外换行
                return getChildrenText(node);
            }
            
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
                    // 如果没有 thead，第一个 tr 作为表头（如果包含 th 标签）
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
                        // 如果表头内容不是加粗格式，则添加加粗
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
                    // 如果有 tbody，从 tbody 获取行；否则从 table 获取（排除已作为表头的行）
                    const source = tbody || node;
                    dataRows = Array.from(source.querySelectorAll('tr'));
                    if (headerRow && !thead) {
                        // 如果第一个 tr 被用作表头，排除它
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
                
                return rows.length > 0 ? '\n' + rows.join('\n') + '\n\n' : '';
            }
            
            case 'thead':
            case 'tbody':
                // 这些标签由 table 处理，直接返回子内容
                return getChildrenText(node);
            
            case 'tr':
                // tr 标签由 table 处理，直接返回子内容
                return getChildrenText(node);
            
            case 'th':
            case 'td':
                // 这些标签由 tr 处理，直接返回子内容
                return getChildrenText(node);
            
            default:
                return getChildrenText(node);
        }
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
            
            // 调试：输出原始 HTML
            const originalHTML = clone.innerHTML;
            console.log('[HTML to Markdown] ========== 原始 HTML ==========');
            console.log(originalHTML);
            
            // 使用 nodeToText 将 HTML 转换为 Markdown
            let text = nodeToText(clone);
            
            if (!text || !text.trim()) {
                return null;
            }
            
            const processed = text.trim();
            
            // 调试：输出处理后的文本
            console.log('[HTML to Markdown] ========== 处理后的文本 ==========');
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

