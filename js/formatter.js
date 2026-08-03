// Web Formatter - Client-side only
(function() {
    'use strict';

    let editor;
    let worker;
    let isFormatting = false;
    let fileName = null;
    let currentLanguage = null;
    let autoDetectLanguages = [];
    let lineCount = 0;
    let isNewData = true;

    // Configuration passed from server
    let config = {
        menuId: '/',
        menu: {},
        text: {}
    };

    // Initialize on DOM ready
    document.addEventListener('DOMContentLoaded', init);

    function init() {
        // Get config from global variable set by server
        if (window.webFormatterConfig) {
            config = window.webFormatterConfig;
        }

        // Build autoDetectLanguages array from menu - using name field like in old app
        const keys = Object.keys(config.menu);
        autoDetectLanguages = [];
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            const menuItem = config.menu[key];
            if (menuItem.isAutoDetect) {
                autoDetectLanguages.push(menuItem.name);
            }
        }

        initEditor();
        initWorker();
        initEventListeners();
        initDragDrop();
        
        // Set current language from menu
        const activeMenu = document.querySelector('.main-button__active, .main-button__lang__active');
        if (activeMenu) {
            currentLanguage = activeMenu.getAttribute('href');
        }
    }

    function initEditor() {
        const textarea = document.getElementById('code');
        editor = CodeMirror.fromTextArea(textarea, {
            lineNumbers: true,
            lineWrapping: false,
            placeholder: config.text.editor?.placeholder || 'Paste your code or drag a file here',
            mode: 'javascript',
            theme: 'default',
            tabSize: 4,
            indentUnit: 4,
            smartIndent: true
        });
        
        // Add resizer
        const wrapper = editor.getWrapperElement();
        const resizer = document.createElement('div');
        resizer.className = 'CodeMirror-Resizer';
        wrapper.appendChild(resizer);
        
        // Resizer functionality
        let startY = 0;
        let startHeight = 0;
        
        resizer.addEventListener('mousedown', function(e) {
            e.preventDefault();
            startY = e.clientY;
            startHeight = wrapper.offsetHeight;
            
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
        
        function onMouseMove(e) {
            const delta = e.clientY - startY;
            const newHeight = Math.max(200, startHeight + delta);
            wrapper.style.height = newHeight + 'px';
            editor.refresh();
        }
        
        function onMouseUp() {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        }
    }

    function initWorker() {
        const workerCode = `
            importScripts("https://unpkg.com/prettier@3.3.3/standalone.js");
            importScripts("https://unpkg.com/prettier@3.3.3/plugins/babel.js");
            importScripts("https://unpkg.com/prettier@3.3.3/plugins/typescript.js");
            importScripts("https://unpkg.com/prettier@3.3.3/plugins/html.js");
            importScripts("https://unpkg.com/prettier@3.3.3/plugins/postcss.js");
            importScripts("https://unpkg.com/prettier@3.3.3/plugins/estree.js");

            self.onmessage = async function(event) {
                try {
                    const { text, options } = event.data;
                    
                    const plugins = [
                        prettierPlugins.babel,
                        prettierPlugins.typescript,
                        prettierPlugins.html,
                        prettierPlugins.postcss,
                        prettierPlugins.estree
                    ];

                    const parserMap = {
                        'javascript': 'babel',
                        'typescript': 'typescript',
                        'jsx': 'babel',
                        'tsx': 'typescript',
                        'html': 'html',
                        'xml': 'html',
                        'css': 'css',
                        'scss': 'scss',
                        'sass': 'scss',
                        'less': 'less',
                        'json': 'json'
                    };

                    const parser = parserMap[options.language] || 'babel';

                    const formatOptions = {
                        parser: parser,
                        plugins: plugins,
                        printWidth: options.printWidth || 120,
                        tabWidth: options.tabWidth || 4,
                        useTabs: false,
                        semi: true,
                        singleQuote: false,
                        trailingComma: 'es5',
                        bracketSpacing: true,
                        arrowParens: 'always',
                        endOfLine: 'lf',
                        proseWrap: 'preserve'
                    };

                    const result = await prettier.format(text, formatOptions);
                    
                    self.postMessage({
                        success: true,
                        text: result
                    });
                    
                } catch (error) {
                    self.postMessage({
                        success: false,
                        error: {
                            message: error.message || 'Unknown formatting error',
                            loc: error.loc
                        }
                    });
                }
            };
        `;

        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const workerUrl = URL.createObjectURL(blob);
        
        worker = new Worker(workerUrl);
        worker.onmessage = handleWorkerMessage;
        
        worker.onerror = function(error) {
            console.error('Worker error:', error);
            URL.revokeObjectURL(workerUrl);
        };
    }

    function initEventListeners() {
        // Format button
        const formatBtn = document.querySelector('.primary-button');
        if (formatBtn) {
            formatBtn.addEventListener('click', formatCode);
        }
        
        // Upload button
        const uploadBtn = document.querySelector('.footer-item__browse');
        if (uploadBtn) {
            uploadBtn.addEventListener('click', () => {
                document.getElementById('inFile').click();
            });
        }
        
        // File input
        const fileInput = document.getElementById('inFile');
        if (fileInput) {
            fileInput.addEventListener('change', handleFileSelect);
        }
        
        // Clear button
        const clearBtn = document.querySelector('.footer-item__clear');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                editor.setValue('');
                fileName = null;
                clearDetectedFormat();
                clearErrorHighlight();
            });
        }
        
        // Copy button
        const copyBtn = document.querySelector('.footer-item__copy');
        if (copyBtn) {
            const clipboard = new ClipboardJS(copyBtn, {
                text: function() {
                    return editor.getValue();
                }
            });
            
            clipboard.on('success', function(e) {
                const originalText = copyBtn.textContent;
                copyBtn.textContent = 'Copied!';
                setTimeout(() => {
                    copyBtn.textContent = originalText;
                }, 2000);
                e.clearSelection();
            });
        }
        
        // Download button
        const downloadBtn = document.querySelector('.footer-item__download');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', downloadFile);
        }
        
        // Modal controls
        const modalClose = document.getElementById('modalClose');
        if (modalClose) {
            modalClose.addEventListener('click', closeModal);
        }
        
        const backdrop = document.querySelector('.modal-backdrop');
        if (backdrop) {
            backdrop.addEventListener('click', closeModal);
        }
        
        const modalBtn = document.getElementById('modalBtn');
        if (modalBtn) {
            modalBtn.addEventListener('click', handleModalAction);
        }
        
        const modalInput = document.getElementById('modalInput');
        if (modalInput) {
            modalInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') handleModalAction();
                if (e.key === 'Escape') closeModal();
            });
        }

        // Menu language buttons
        const menuButtons = document.querySelectorAll('.main-button__lang, .main-button__auto');
        menuButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const lang = btn.getAttribute('href');
                window.location.href = lang;
            });
        });

        // Editor paste event
        editor.on('paste', function() {
            clearDetectedFormat();
            clearErrorHighlight();
        });

        // Editor change event
        editor.on('change', function() {
            // ÐÐµ Ð¾Ñ‡Ð¸Ñ‰Ð°ÐµÐ¼ Ð´ÐµÑ‚ÐµÐºÑ†Ð¸ÑŽ ÐµÑÐ»Ð¸ ÑÐµÐ¹Ñ‡Ð°Ñ Ð¸Ð´ÐµÑ‚ Ñ„Ð¾Ñ€Ð¼Ð°Ñ‚Ð¸Ñ€Ð¾Ð²Ð°Ð½Ð¸Ðµ
            if (!isFormatting) {
                clearDetectedFormat();
            }
            
            if (editor.getValue() === '') {
                clearDetectedFormat();
            }
            clearErrorHighlight();
        });

        // Button focus effects
        document.querySelectorAll('button').forEach(btn => {
            btn.addEventListener('mouseleave', function() {
                this.classList.remove('button-focus');
            });
            btn.addEventListener('mousedown', function() {
                this.classList.add('button-focus');
            });
            btn.addEventListener('mouseup', function() {
                this.classList.remove('button-focus');
            });
        });

        document.querySelectorAll('.footer-item').forEach(item => {
            item.addEventListener('mouseleave', function() {
                this.classList.remove('item-focus');
            });
            item.addEventListener('mousedown', function() {
                this.classList.add('item-focus');
            });
            item.addEventListener('mouseup', function() {
                this.classList.remove('item-focus');
            });
        });
    }

    function initDragDrop() {
        const wrapper = editor.getWrapperElement();
        
        wrapper.addEventListener('dragover', (e) => {
            e.preventDefault();
            wrapper.classList.add('drag-over');
        });
        
        wrapper.addEventListener('dragleave', (e) => {
            e.preventDefault();
            wrapper.classList.remove('drag-over');
        });
        
        wrapper.addEventListener('drop', (e) => {
            e.preventDefault();
            wrapper.classList.remove('drag-over');
            
            if (e.dataTransfer.files.length > 0) {
                readFile(e.dataTransfer.files[0]);
            }
        });
    }

    function formatCode() {
        if (isFormatting || !editor.getValue()) return;
        
        isFormatting = true;
        showSpinner(true);
        clearErrorHighlight();
        lineCount = editor.lineCount();
        
        const code = editor.getValue();
        const tabSize = parseInt(document.getElementById('tabSize').value) || 4;
        
        // Always use autodetect for formatting, regardless of current page
        const detectedLang = detectLanguage(code);
        let language = detectedLang;
        
        if (detectedLang) {
            const menuItem = getMenuItemByLanguage(detectedLang);
            if (menuItem) {
                // Always mark as detected on all pages
                markDetectedFormat(menuItem.name);
                
                // Update editor mode
                if (menuItem.mode) {
                    editor.setOption('mode', menuItem.mode);
                }
                
                language = menuItem.language;
            }
        }
        
        // Fallback to current language if detection failed
        if (!language && currentLanguage !== '/') {
            const menuItem = getMenuItemByName(currentLanguage);
            language = menuItem ? menuItem.language : 'javascript';
        }
        
        worker.postMessage({
            text: code,
            options: {
                parser: getParserForLanguage(language),
                language: language,
                tabWidth: tabSize,
                printWidth: 120,
                semi: true,
                singleQuote: false,
                trailingComma: 'es5',
                bracketSpacing: true
            }
        });
    }

    function markDetectedFormat(language) {
        document.querySelectorAll('.main-button__lang').forEach(btn => {
            btn.classList.remove('main-button__detected');
        });
        
        const detectedBtn = document.querySelector(`[href="/${language}"]`);
        if (detectedBtn) {
            // Ð”Ð¾Ð±Ð°Ð²Ð»ÑÐµÐ¼ ÐºÐ»Ð°ÑÑ detected Ñ‚Ð¾Ð»ÑŒÐºÐ¾ ÐµÑÐ»Ð¸ ÐºÐ½Ð¾Ð¿ÐºÐ° Ð½Ðµ Ð°ÐºÑ‚Ð¸Ð²Ð½Ð°
            if (!detectedBtn.classList.contains('main-button__lang__active')) {
                detectedBtn.classList.add('main-button__detected');
            }
        }
    }

    function clearDetectedFormat() {
        document.querySelectorAll('.main-button__lang').forEach(btn => {
            btn.classList.remove('main-button__detected');
        });
    }

    function clearErrorHighlight() {
        const doc = editor.getDoc();
        for (let i = 0; i < editor.lineCount(); i++) {
            editor.removeLineClass(i, 'background', 'line-error');
        }
    }

    function getParserForLanguage(language) {
        const parserMap = {
            'javascript': 'babel',
            'typescript': 'typescript',
            'jsx': 'babel',
            'tsx': 'typescript',
            'html': 'html',
            'xml': 'html',
            'css': 'css',
            'scss': 'scss',
            'sass': 'scss',
            'less': 'less',
            'json': 'json'
        };
        
        return parserMap[language] || 'babel';
    }

    function handleWorkerMessage(e) {
        const { success, text, error } = e.data;
        
        if (success && text) {
            const scrollInfo = editor.getScrollInfo();
            editor.setValue(text);
            
            if (lineCount !== 1) {
                if (isNewData) {
                    editor.scrollTo(0, 0);
                } else {
                    editor.scrollTo(scrollInfo.left, scrollInfo.top);
                }
            }
            isNewData = false;
        } else if (error) {
            handleFormattingError(error);
        }
        
        isFormatting = false;
        showSpinner(false);
    }

    function handleFormattingError(error) {
        console.error('Formatting error:', error);
        
        // Parse error position
        const position = getCursorPositionFromError(error);
        
        if (position && position.line !== null) {
            // Highlight error line
            editor.addLineClass(position.line, 'background', 'line-error');
            
            // Scroll to error line
            jumpToEditorLine(position.line);
        }
    }

    function getCursorPositionFromError(error) {
        if (!error.message) return null;
        
        // Parse error for different formats
        // Example: "SyntaxError: Unexpected token (3:5)"
        const match = /\((\d+):(\d+)\)/.exec(error.message);
        if (match && match.length === 3) {
            return {
                line: parseInt(match[1]) - 1,
                ch: parseInt(match[2]) - 1
            };
        }
        
        // Alternative format: "3:5"
        const match2 = /^(\d+):(\d+)/.exec(error.message);
        if (match2 && match2.length === 3) {
            return {
                line: parseInt(match2[1]) - 1,
                ch: parseInt(match2[2]) - 1
            };
        }
        
        // Try to find line number anywhere in message
        const lineMatch = /line\s+(\d+)/i.exec(error.message);
        if (lineMatch) {
            return {
                line: parseInt(lineMatch[1]) - 1,
                ch: null
            };
        }
        
        return { line: null, ch: null };
    }

    function jumpToEditorLine(lineNumber) {
        const lineTop = editor.charCoords({line: lineNumber, ch: 0}, "local").top;
        const middleHeight = editor.getScrollerElement().offsetHeight / 2;
        editor.scrollTo(0, lineTop - middleHeight - 5);
    }

    function showErrorModal(message, position) {
        const modal = document.getElementById('modalWindow');
        const title = modal.querySelector('.modal-title');
        const btn = document.getElementById('modalBtn');
        const input = document.getElementById('modalInput');
        
        modal.dataset.type = 'error';
        
        title.textContent = config.text.window?.error?.header || 'Formatting Error';
        btn.textContent = config.text.window?.error?.button || 'OK';
        
        // Format error message
        let errorText = message;
        if (position && position.line !== null) {
            errorText = `Line ${position.line + 1}` + (position.ch !== null ? `:${position.ch + 1}` : '') + '\n\n' + message;
        }
        
        input.value = errorText;
        input.setAttribute('readonly', 'readonly');
        input.style.height = 'auto';
        input.style.minHeight = '80px';
        
        modal.style.display = 'block';
        document.querySelector('.modal-backdrop').style.display = 'block';
    }

    function detectLanguage(code) {
        // Use highlight.js for detection
        if (typeof hljs !== 'undefined') {
            const result = hljs.highlightAuto(code, autoDetectLanguages);
            if (result && result.language) {
                return result.language;
            }
        }
        return null;
    }

    function getMenuItemByLanguage(language) {
        // Search by language field, like old app's getMenuItem
        for (let key in config.menu) {
            const menuItem = config.menu[key];
            if (menuItem.language === language) {
                return menuItem;
            }
        }
        return null;
    }

    function getMenuItemByName(name) {
        // Remove leading slash if present
        const cleanName = name.startsWith('/') ? name.substring(1) : name;
        
        for (let key in config.menu) {
            const menuItem = config.menu[key];
            if (menuItem.name === cleanName || menuItem.name === name) {
                return menuItem;
            }
        }
        return null;
    }

    function handleFileSelect(e) {
        const file = e.target.files[0];
        if (file) {
            readFile(file);
        }
        e.target.value = '';
    }

    function readFile(file) {
        fileName = file.name;
        const reader = new FileReader();
        
        reader.onload = (e) => {
            const content = e.target.result;
            
            requestAnimationFrame(() => {
                editor.setValue(content);
                clearAutoDetectedLanguage();
                clearErrorHighlight();
            });
        };
        
        reader.readAsText(file);
    }

    function clearAutoDetectedLanguage() {
        if (currentLanguage === '/') {
            document.querySelectorAll('.main-button__lang').forEach(btn => {
                btn.classList.remove('main-button__lang__active');
            });
        }
    }

    function downloadFile() {
        const code = editor.getValue();
        if (!code) return;
        
        showModal('download');
    }

    function performDownload(filename) {
        const code = editor.getValue();
        const menuItem = getMenuItemByName(currentLanguage === '/' ? detectLanguage(code) : currentLanguage);
        const mime = menuItem ? menuItem.mime : 'text/plain';
        
        const blob = new Blob([code], { type: mime + ';charset=utf-8' });
        saveAs(blob, filename);
    }

    function showModal(type) {
        const modal = document.getElementById('modalWindow');
        const backdrop = document.querySelector('.modal-backdrop');
        const title = modal.querySelector('.modal-title');
        const btn = document.getElementById('modalBtn');
        const input = document.getElementById('modalInput');
        
        modal.dataset.type = type;
        input.value = '';
        input.removeAttribute('readonly');
        input.style.height = '';
        input.style.minHeight = '';
        
        if (type === 'download') {
            title.textContent = config.text.window?.download?.header || 'Enter file name';
            btn.textContent = config.text.window?.download?.button || 'Download';
            
            // Auto-suggest filename
            if (fileName) {
                input.value = fileName;
            } else {
                const detectedLang = detectLanguage(editor.getValue());
                const menuItem = getMenuItemByLanguage(detectedLang);
                const ext = menuItem ? menuItem.extension : 'txt';
                input.value = 'formatted.' + ext;
            }
        }
        
        modal.style.display = 'block';
        backdrop.style.display = 'block';
        input.focus();
        input.select();
    }

    function closeModal() {
        const modal = document.getElementById('modalWindow');
        const backdrop = document.querySelector('.modal-backdrop');
        
        if (modal) {
            modal.style.display = 'none';
        }
        if (backdrop) {
            backdrop.style.display = 'none';
        }
    }

    function handleModalAction() {
        const modal = document.getElementById('modalWindow');
        const input = document.getElementById('modalInput').value;
        
        if (!input) return;
        
        if (modal.dataset.type === 'download') {
            performDownload(input);
            closeModal();
        }
    }

    function showSpinner(show) {
        const btnText = document.querySelector('.primary-button span');
        const spinner = document.querySelector('.primary-button .spinner');
        
        if (show) {
            btnText.style.display = 'none';
            spinner.style.display = 'flex';
        } else {
            btnText.style.display = 'block';
            spinner.style.display = 'none';
        }
    }

})();
