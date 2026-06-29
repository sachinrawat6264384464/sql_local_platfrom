// SQL Pro Web - Client-side logic

// State Management
const state = {
    connected: false,
    host: 'localhost',
    port: '5433',
    user: 'postgres',
    database: 'postgres',
    databases: [],
    tables: [],
    activeTable: null,
    activeTab: 'grid',
    activeSideTab: 'explorer',
    currentTableColumns: [], // Schema of the active table (from sidebar click)
    lastQueryResults: null,  // { columns, rows } from the last run query
    chartInstance: null
};

// DOM Elements
const connectionForm = document.getElementById('connection-form');
const btnConnect = document.getElementById('btn-connect');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const dbSelect = document.getElementById('db-select');
const tablesList = document.getElementById('tables-list');
const btnRefreshTables = document.getElementById('btn-refresh-tables');
const queryEditor = document.getElementById('query-editor');
const editorLineNumbers = document.getElementById('editor-line-numbers');
const btnRun = document.getElementById('btn-run');
const btnClear = document.getElementById('btn-clear');
const btnBookmark = document.getElementById('btn-bookmark');
const queryMeta = document.getElementById('query-meta');
const resultsContainer = document.getElementById('results-container');
const toastContainer = document.getElementById('toast-container');
const tabBtnEr = document.getElementById('tab-btn-er');
const tabBtnChart = document.getElementById('tab-btn-chart');

// Dropdowns and Buttons
const btnExportToggle = document.getElementById('btn-export-toggle');
const exportDropdown = document.getElementById('export-dropdown');
const exportMenu = document.getElementById('export-menu');
const btnInsertRow = document.getElementById('btn-insert-row');
const btnCreateTableModal = document.getElementById('btn-create-table-modal');

// API Base URL
const API_BASE = '';

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
    checkConnectionStatus();
    setupEventListeners();
    loadHistory();
    loadBookmarks();
    updateLineNumbers(); // Initialize lines display
});

// Event Listeners Setup
function setupEventListeners() {
    // Form Connection
    connectionForm.addEventListener('submit', handleConnect);

    // Database Switch Dropdown
    dbSelect.addEventListener('change', handleDatabaseSwitch);

    // Refresh Tables Button
    btnRefreshTables.addEventListener('click', loadTables);

    // Clear Editor Button
    btnClear.addEventListener('click', () => {
        queryEditor.value = '';
        updateLineNumbers();
        queryEditor.focus();
    });

    // Bookmark/Save Query Button
    btnBookmark.addEventListener('click', handleSaveQuery);

    // Run Query Button
    btnRun.disabled = true; // start disabled until connected
    btnRun.addEventListener('click', handleExecuteQuery);

    // SQL Editor Line Numbers and scrolling syncer
    queryEditor.addEventListener('input', () => {
        updateLineNumbers();
        // Clear highlights on editing
        document.querySelectorAll('.line-numbers span').forEach(span => {
            span.classList.remove('error-line');
        });
    });

    queryEditor.addEventListener('scroll', () => {
        editorLineNumbers.scrollTop = queryEditor.scrollTop;
    });

    // Ctrl+Enter keyboard shortcut for Run Query
    queryEditor.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            if (!btnRun.disabled) {
                handleExecuteQuery();
            }
        }
    });

    // Results Tab Switchers
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.getAttribute('data-tab');
            switchTab(tabId);
        });
    });

    // Sidebar Tab Switchers
    document.querySelectorAll('.sidebar-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const sideTabId = btn.getAttribute('data-side-tab');
            switchSideTab(sideTabId);
        });
    });

    // Export Dropdown Trigger
    btnExportToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        exportMenu.classList.toggle('active');
    });

    document.addEventListener('click', () => {
        exportMenu.classList.remove('active');
    });

    // Export Items Handlers
    document.getElementById('export-csv').addEventListener('click', handleExportCSV);
    document.getElementById('export-json').addEventListener('click', handleExportJSON);
    document.getElementById('export-sql').addEventListener('click', handleExportSQL);

    // Insert Row Modal Handlers
    btnInsertRow.addEventListener('click', openInsertRowModal);
    document.getElementById('btn-close-insert-row').addEventListener('click', () => closeModal('modal-insert-row'));
    document.getElementById('btn-cancel-insert-row').addEventListener('click', () => closeModal('modal-insert-row'));
    document.getElementById('insert-row-form').addEventListener('submit', handleInsertRowSubmit);

    // Create Table Modal Handlers
    btnCreateTableModal.addEventListener('click', openCreateTableModal);
    document.getElementById('btn-close-create-table').addEventListener('click', () => closeModal('modal-create-table'));
    document.getElementById('btn-cancel-create-table').addEventListener('click', () => closeModal('modal-create-table'));
    document.getElementById('btn-add-builder-column').addEventListener('click', addBuilderColumnRow);
    document.getElementById('btn-submit-create-table').addEventListener('click', handleCreateTableSubmit);

    // Chart Select Configuration Handlers
    document.getElementById('chart-type').addEventListener('change', renderChartVisualization);
    document.getElementById('chart-x-axis').addEventListener('change', renderChartVisualization);
    document.getElementById('chart-y-axis').addEventListener('change', renderChartVisualization);

    // Chatbot Handlers
    const chatForm = document.getElementById('chat-input-form');
    if (chatForm) chatForm.addEventListener('submit', handleChatSubmit);
    
    const configBtn = document.getElementById('btn-chat-config');
    if (configBtn) configBtn.addEventListener('click', () => {
        const pane = document.getElementById('chat-settings-pane');
        pane.style.display = pane.style.display === 'none' ? 'block' : 'none';
    });

    const saveKeyBtn = document.getElementById('btn-save-api-key');
    if (saveKeyBtn) saveKeyBtn.addEventListener('click', handleSaveAPIKey);

    // AI Features Event Listeners
    const btnNl2sqlRun = document.getElementById('btn-nl2sql-run');
    const nl2sqlInput = document.getElementById('nl2sql-input');
    if (btnNl2sqlRun && nl2sqlInput) {
        btnNl2sqlRun.addEventListener('click', handleNL2SQL);
        nl2sqlInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleNL2SQL();
            }
        });
    }

    const btnAiOptimize = document.getElementById('btn-ai-optimize');
    if (btnAiOptimize) btnAiOptimize.addEventListener('click', handleAIQueryOptimize);

    // Optimize Modal Actions
    const btnCloseAiOpt = document.getElementById('btn-close-ai-optimize');
    const btnCancelAiOpt = document.getElementById('btn-cancel-ai-optimize');
    if (btnCloseAiOpt) btnCloseAiOpt.addEventListener('click', () => closeModal('modal-ai-optimize'));
    if (btnCancelAiOpt) btnCancelAiOpt.addEventListener('click', () => closeModal('modal-ai-optimize'));

    const btnApplyOptimized = document.getElementById('btn-apply-optimized-query');
    if (btnApplyOptimized) {
        btnApplyOptimized.addEventListener('click', () => {
            const modal = document.getElementById('modal-ai-optimize');
            const optimizedSql = modal.dataset.optimizedSql;
            if (optimizedSql) {
                queryEditor.value = optimizedSql;
                updateLineNumbers();
                closeModal('modal-ai-optimize');
                showToast('Optimized query applied to editor!', 'success');
            }
        });
    }

    // Floating toggle button & close button
    const widgetToggle = document.getElementById('chat-widget-toggle');
    const widgetWindow = document.getElementById('chat-widget-window');
    const widgetClose = document.getElementById('btn-chat-close');
    const chatContainer = document.querySelector('.floating-chat-container');

    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let initialBottom = 0;
    let initialRight = 0;
    let initialRect = null;
    let hasMoved = false;

    if (widgetToggle && widgetWindow && chatContainer) {
        // Dragging event handlers for mouse on toggle button
        widgetToggle.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return; // Only left click drag
            startDrag(e, e.clientX, e.clientY);
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            e.preventDefault();
        });

        // Dragging event handlers for touch devices on toggle button
        widgetToggle.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) {
                startDrag(e, e.touches[0].clientX, e.touches[0].clientY);
                document.addEventListener('touchmove', onTouchMove);
                document.addEventListener('touchend', onTouchEnd);
            }
        });

        // Dragging event handlers for mouse on chat header bar (when chat window is open)
        const chatHeader = widgetWindow.querySelector('.chat-header-bar');
        if (chatHeader) {
            chatHeader.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return; // Only left click drag
                // Don't drag if user is clicking a button or setting inside header
                if (e.target.closest('button') || e.target.closest('input')) {
                    return;
                }
                startDrag(e, e.clientX, e.clientY);
                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
                e.preventDefault();
            });

            chatHeader.addEventListener('touchstart', (e) => {
                if (e.touches.length === 1) {
                    if (e.target.closest('button') || e.target.closest('input')) {
                        return;
                    }
                    startDrag(e, e.touches[0].clientX, e.touches[0].clientY);
                    document.addEventListener('touchmove', onTouchMove);
                    document.addEventListener('touchend', onTouchEnd);
                }
            });
        }

        function startDrag(e, clientX, clientY) {
            isDragging = true;
            hasMoved = false;
            
            initialRect = chatContainer.getBoundingClientRect();
            // Calculate starting bottom and right coordinates relative to the viewport
            initialBottom = window.innerHeight - initialRect.bottom;
            initialRight = window.innerWidth - initialRect.right;
            
            dragStartX = clientX;
            dragStartY = clientY;
        }

        function onMouseMove(e) {
            dragMove(e.clientX, e.clientY);
        }

        function onTouchMove(e) {
            if (e.touches.length === 1) {
                dragMove(e.touches[0].clientX, e.touches[0].clientY);
            }
        }

        function dragMove(clientX, clientY) {
            if (!isDragging || !initialRect) return;
            
            const deltaX = clientX - dragStartX;
            const deltaY = clientY - dragStartY;
            
            if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) {
                hasMoved = true;
            }
            
            // Calculate starting state and prospective position
            let newLeft = initialRect.left + deltaX;
            let newBottom = initialBottom - deltaY;
            
            // Viewport constraints
            const chatWidth = 380; // Width of the open chat window
            const minLeft = 10;
            const minBottom = 10;
            const maxBottom = window.innerHeight - initialRect.height - 10;
            
            // Constrain bottom
            if (newBottom < minBottom) newBottom = minBottom;
            if (newBottom > maxBottom) newBottom = maxBottom;
            
            // Determine if the widget resides on the left half or right half of the screen
            const isLeftHalf = newLeft < (window.innerWidth / 2);
            
            chatContainer.style.top = 'auto';
            chatContainer.style.bottom = `${newBottom}px`;
            
            if (isLeftHalf) {
                // Left half of screen: Anchor to left, grow to the right
                const maxLeft = window.innerWidth - chatWidth - 10;
                if (newLeft < minLeft) newLeft = minLeft;
                if (newLeft > maxLeft) newLeft = maxLeft;
                
                chatContainer.style.right = 'auto';
                chatContainer.style.left = `${newLeft}px`;
                chatContainer.style.alignItems = 'flex-start';
            } else {
                // Right half of screen: Anchor to right, grow to the left
                let newRight = window.innerWidth - (newLeft + initialRect.width);
                const minRight = 10;
                const maxRight = window.innerWidth - chatWidth - 10;
                
                if (newRight < minRight) newRight = minRight;
                if (newRight > maxRight) newRight = maxRight;
                
                chatContainer.style.left = 'auto';
                chatContainer.style.right = `${newRight}px`;
                chatContainer.style.alignItems = 'flex-end';
            }
        }

        function onMouseUp() {
            isDragging = false;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        }

        function onTouchEnd() {
            isDragging = false;
            document.removeEventListener('touchmove', onTouchMove);
            document.removeEventListener('touchend', onTouchEnd);
        }

        // Click handler to open/close chat drawer
        widgetToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            if (hasMoved) {
                // If it was dragged, don't open the chat window
                return;
            }
            
            widgetWindow.classList.toggle('active');
            if (widgetWindow.classList.contains('active')) {
                const container = document.getElementById('chat-messages');
                if (container) container.scrollTop = container.scrollHeight;
            }
        });
    }

    if (widgetClose && widgetWindow) {
        widgetClose.addEventListener('click', (e) => {
            e.stopPropagation();
            widgetWindow.classList.remove('active');
        });
    }
}

// Update Line Numbers dynamically
function updateLineNumbers() {
    const lines = queryEditor.value.split('\n');
    const lineCount = Math.max(1, lines.length);
    
    let numbersHtml = '';
    for (let i = 1; i <= lineCount; i++) {
        numbersHtml += `<span id="line-num-${i}">${i}</span>`;
    }
    
    editorLineNumbers.innerHTML = numbersHtml;
    editorLineNumbers.scrollTop = queryEditor.scrollTop;
}

// Highlight SQL Error Line
function highlightErrorLine(errorMessage) {
    // Regex matching "LINE X:" (case-insensitive)
    const match = errorMessage.match(/LINE\s+(\d+)\s*:/i);
    
    // Clear previous highlights
    document.querySelectorAll('.line-numbers span').forEach(span => {
        span.classList.remove('error-line');
        span.removeAttribute('title');
    });

    if (match) {
        const lineNum = parseInt(match[1]);
        const targetSpan = document.getElementById(`line-num-${lineNum}`);
        if (targetSpan) {
            targetSpan.classList.add('error-line');
            targetSpan.title = `Syntax error occurred on line ${lineNum}`;
            showToast(`Syntax error on Line ${lineNum}`, 'error');
        }
    }
}

// Sidebar Tab Switcher Logic
function switchSideTab(sideTabId) {
    state.activeSideTab = sideTabId;

    document.querySelectorAll('.sidebar-tab-btn').forEach(btn => {
        if (btn.getAttribute('data-side-tab') === sideTabId) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    document.querySelectorAll('.side-tab-content').forEach(content => {
        if (content.id === `side-content-${sideTabId}`) {
            content.classList.add('active');
        } else {
            content.classList.remove('active');
        }
    });
}

// Tab Switcher Logic
function switchTab(tabId) {
    if ((tabId === 'er' || tabId === 'chart') && !state.connected) return;

    state.activeTab = tabId;

    // Toggle active state on buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        if (btn.getAttribute('data-tab') === tabId) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Toggle active state on tab contents
    document.querySelectorAll('.tab-content').forEach(content => {
        if (content.id === `tab-content-${tabId}`) {
            content.classList.add('active');
        } else {
            content.classList.remove('active');
        }
    });

    // Action routers
    if (tabId === 'er') {
        loadAndRenderERDiagram();
    } else if (tabId === 'chart') {
        renderChartVisualization();
    }
}

// Show Toast Notification
function showToast(message, type = 'info', duration = 3000) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let iconClass = 'fa-circle-info';
    if (type === 'success') iconClass = 'fa-circle-check';
    if (type === 'error') iconClass = 'fa-circle-exclamation';

    toast.innerHTML = `
        <i class="fa-solid ${iconClass}"></i>
        <span>${message}</span>
    `;

    toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) reverse';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// Update Connection UI Controls State
function setUIState(connected) {
    state.connected = connected;
    
    if (connected) {
        statusDot.className = 'status-dot connected';
        statusText.textContent = `Connected (${state.database})`;
        btnConnect.innerHTML = '<i class="fa-solid fa-plug-circle-xmark"></i> Disconnect';
        btnConnect.classList.remove('btn-connect');
        btnConnect.classList.add('btn-secondary');
        
        // Enable controls
        dbSelect.disabled = false;
        btnRefreshTables.disabled = false;
        queryEditor.disabled = false;
        btnRun.disabled = false;
        tabBtnEr.disabled = false;
        btnBookmark.disabled = false;
        btnCreateTableModal.disabled = false;
        
        // Enable AI Elements
        const nl2sqlInput = document.getElementById('nl2sql-input');
        const btnNl2sqlRun = document.getElementById('btn-nl2sql-run');
        const btnAiOptimize = document.getElementById('btn-ai-optimize');
        if (nl2sqlInput) nl2sqlInput.disabled = false;
        if (btnNl2sqlRun) btnNl2sqlRun.disabled = false;
        if (btnAiOptimize) btnAiOptimize.disabled = false;
        
        // Chatbot Controls
        const widgetToggle = document.getElementById('chat-widget-toggle');
        if (widgetToggle) widgetToggle.disabled = false;
        document.getElementById('chat-input').disabled = false;
        document.getElementById('btn-chat-send').disabled = false;
        startRAGStatusPolling();
    } else {
        statusDot.className = 'status-dot disconnected';
        statusText.textContent = 'Disconnected';
        btnConnect.innerHTML = '<i class="fa-solid fa-plug"></i> Connect';
        btnConnect.classList.add('btn-connect');
        btnConnect.classList.remove('btn-secondary');
        
        // Disable controls
        dbSelect.disabled = true;
        dbSelect.innerHTML = '<option value="">(Select Database)</option>';
        btnRefreshTables.disabled = true;
        tablesList.innerHTML = '<li class="empty-list-msg">Connect to see tables</li>';
        const countBadge = document.getElementById('tables-count-badge');
        if (countBadge) { countBadge.style.display = 'none'; countBadge.textContent = ''; }
        queryEditor.disabled = true;
        btnRun.disabled = true;
        tabBtnEr.disabled = true;
        tabBtnChart.disabled = true;
        btnBookmark.disabled = true;
        btnCreateTableModal.disabled = true;
        
        // Disable AI Elements
        const nl2sqlInput = document.getElementById('nl2sql-input');
        const btnNl2sqlRun = document.getElementById('btn-nl2sql-run');
        const btnAiOptimize = document.getElementById('btn-ai-optimize');
        if (nl2sqlInput) { nl2sqlInput.disabled = true; nl2sqlInput.value = ''; }
        if (btnNl2sqlRun) btnNl2sqlRun.disabled = true;
        if (btnAiOptimize) btnAiOptimize.disabled = true;
        
        // Chatbot Controls
        const widgetToggle = document.getElementById('chat-widget-toggle');
        if (widgetToggle) widgetToggle.disabled = true;
        document.getElementById('chat-input').disabled = true;
        document.getElementById('btn-chat-send').disabled = true;
        const widgetWindow = document.getElementById('chat-widget-window');
        if (widgetWindow) widgetWindow.classList.remove('active');
        stopRAGStatusPolling();
        
        // Hide tables elements
        btnInsertRow.style.display = 'none';
        exportDropdown.style.display = 'none';
        
        // Clear results
        switchTab('grid');
        document.getElementById('tab-content-grid').innerHTML = `
            <div class="results-placeholder">
                <i class="fa-solid fa-terminal placeholder-icon"></i>
                <p>Execute a query or click a table in the sidebar to see results here</p>
            </div>
        `;
        queryMeta.textContent = '';
        state.lastQueryResults = null;
    }
}

// Check if Backend already has an active connection session
async function checkConnectionStatus() {
    try {
        const res = await fetch(`${API_BASE}/api/status`);
        const data = await res.json();
        
        if (data.connected) {
            state.host = data.config.host;
            state.port = data.config.port;
            state.user = data.config.user;
            state.database = data.config.database;

            // Pre-fill fields
            document.getElementById('host').value = state.host;
            document.getElementById('port').value = state.port;
            document.getElementById('user').value = state.user;
            document.getElementById('database').value = state.database;

            setUIState(true);
            await loadDatabases();
            await loadTables();
            showToast('Reconnected to existing session', 'success');
        } else {
            setUIState(false);
        }
    } catch (err) {
        showToast('Backend server connection error', 'error');
        setUIState(false);
    }
}

// Handle Connect Form Submit
async function handleConnect(e) {
    e.preventDefault();

    if (state.connected) {
        setUIState(false);
        showToast('Disconnected from server', 'info');
        return;
    }

    const host = document.getElementById('host').value;
    const port = document.getElementById('port').value;
    const user = document.getElementById('user').value;
    const password = document.getElementById('password').value;
    const database = document.getElementById('database').value;

    btnConnect.disabled = true;
    btnConnect.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Connecting...';

    try {
        const res = await fetch(`${API_BASE}/api/connect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ host, port, user, password, database })
        });
        
        const data = await res.json();

        if (res.ok) {
            state.host = host;
            state.port = port;
            state.user = user;
            state.database = data.database;
            
            setUIState(true);
            showToast(data.message, 'success');
            
            await loadDatabases();
            await loadTables();
        } else {
            showToast(data.error || 'Connection failed', 'error');
            setUIState(false);
        }
    } catch (err) {
        showToast('Network error while connecting', 'error');
        setUIState(false);
    } finally {
        btnConnect.disabled = false;
    }
}

// Fetch and Populate Databases dropdown
async function loadDatabases() {
    try {
        const res = await fetch(`${API_BASE}/api/databases`);
        const data = await res.json();

        if (res.ok) {
            state.databases = data.databases;
            
            dbSelect.innerHTML = '';
            data.databases.forEach(db => {
                const opt = document.createElement('option');
                opt.value = db;
                opt.textContent = db;
                if (db === state.database) {
                    opt.selected = true;
                }
                dbSelect.appendChild(opt);
            });
        }
    } catch (err) {
        showToast('Failed to load databases list', 'error');
    }
}

// Handle switching database dropdown
async function handleDatabaseSwitch() {
    const selectedDb = dbSelect.value;
    if (!selectedDb || selectedDb === state.database) return;

    dbSelect.disabled = true;
    showToast(`Switching to database "${selectedDb}"...`, 'info');

    try {
        const res = await fetch(`${API_BASE}/api/switch-database`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ database: selectedDb })
        });
        const data = await res.json();

        if (res.status === 401) {
            showToast('Connection lost. Please reconnect using the connect panel.', 'error');
            setUIState(false);
            return;
        }

        if (res.ok) {
            state.database = data.database;
            statusText.textContent = `Connected (${state.database})`;
            showToast(data.message, 'success');
            await loadTables();
            
            if (state.activeTab === 'er') {
                loadAndRenderERDiagram();
            }
        } else {
            showToast(data.error || 'Failed to switch database', 'error');
            dbSelect.value = state.database;
        }
    } catch (err) {
        showToast('Network error during database switch', 'error');
        dbSelect.value = state.database;
    } finally {
        dbSelect.disabled = false;
    }
}

// Fetch and Populate Tables list
async function loadTables() {
    tablesList.innerHTML = '<li class="empty-list-msg"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</li>';
    const countBadge = document.getElementById('tables-count-badge');
    if (countBadge) { countBadge.style.display = 'none'; countBadge.textContent = ''; }
    
    try {
        const res = await fetch(`${API_BASE}/api/tables`);
        const data = await res.json();

        if (res.status === 401) {
            tablesList.innerHTML = '<li class="empty-list-msg">Connection lost. Reconnect.</li>';
            setUIState(false);
            return;
        }

        if (res.ok) {
            state.tables = data.tables;
            tablesList.innerHTML = '';

            if (data.tables.length === 0) {
                tablesList.innerHTML = '<li class="empty-list-msg">No tables found</li>';
                return;
            }

            // Update the count badge
            if (countBadge) {
                countBadge.textContent = data.tables.length;
                countBadge.style.display = 'inline-flex';
            }

            data.tables.forEach(tableName => {
                const li = document.createElement('li');
                li.className = 'table-list-item';
                li.innerHTML = `
                    <span class="table-name-wrapper" title="Click to load table '${tableName}'"><i class="fa-solid fa-table"></i> ${tableName}</span>
                    <button class="btn-table-action btn-generate-mock" title="Generate 20 Mock Rows via AI" data-table="${tableName}">
                        <i class="fa-solid fa-wand-magic-sparkles"></i>
                    </button>
                `;
                
                li.querySelector('.table-name-wrapper').addEventListener('click', () => {
                    switchTab('grid');
                    handleTableSelect(tableName);
                });
                
                li.querySelector('.btn-generate-mock').addEventListener('click', (e) => {
                    e.stopPropagation();
                    handleGenerateMockData(tableName);
                });
                
                tablesList.appendChild(li);
            });
        } else {
            tablesList.innerHTML = `<li class="empty-list-msg error-msg">${data.error || 'Failed to load tables'}</li>`;
        }
    } catch (err) {
        tablesList.innerHTML = '<li class="empty-list-msg error-msg">Network error</li>';
    }
}

// Handle clicking on a table name in the sidebar
async function handleTableSelect(tableName) {
    state.activeTable = tableName;
    queryEditor.value = `SELECT * FROM "${tableName}";`;
    updateLineNumbers(); // Refresh line count
    
    const gridContainer = document.getElementById('tab-content-grid');
    gridContainer.innerHTML = `
        <div class="results-placeholder">
            <i class="fa-solid fa-spinner fa-spin placeholder-icon"></i>
            <p>Fetching table data for "${tableName}"...</p>
        </div>
    `;
    queryMeta.textContent = 'Loading...';

    // Hide actions until loaded
    btnInsertRow.style.display = 'none';
    exportDropdown.style.display = 'none';
    tabBtnChart.disabled = true;

    try {
        const res = await fetch(`${API_BASE}/api/table-data/${tableName}`);
        const data = await res.json();

        if (res.ok) {
            state.currentTableColumns = data.columns;
            state.lastQueryResults = {
                columns: data.columns.map(c => c.column_name),
                rows: data.rows,
                tableName: tableName
            };

            queryMeta.textContent = `Table: ${tableName} | Rows: ${data.rowCount}`;
            renderTableGrid(data.columns, data.rows);
            
            // Show actions
            btnInsertRow.style.display = 'inline-flex';
            exportDropdown.style.display = 'inline-block';
            
            // Analyze for charts capability
            enableChartIfPossible(state.lastQueryResults.columns, data.rows);
        } else {
            showToast(data.error || 'Failed to load table', 'error');
            renderErrorBox(data.error || 'Table load failed');
        }
    } catch (err) {
        showToast('Network error loading table', 'error');
        renderErrorBox('Failed to establish connection with server.');
    }
}

// Render query results or table content into spreadsheet-like grid
function renderTableGrid(columns, rows) {
    const gridContainer = document.getElementById('tab-content-grid');

    if (columns.length === 0) {
        gridContainer.innerHTML = `
            <div class="success-box">
                <div class="error-title" style="color: var(--accent-green)">
                    <i class="fa-solid fa-circle-check"></i> Query executed successfully.
                </div>
                <p>No columns returned.</p>
            </div>
        `;
        return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'data-table-wrapper';

    const table = document.createElement('table');
    table.className = 'data-table';

    // Build Headers
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    columns.forEach(col => {
        const th = document.createElement('th');
        th.textContent = col.column_name || col.name || col;
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Build Body
    const tbody = document.createElement('tbody');
    if (rows.length === 0) {
        const emptyRow = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = columns.length;
        td.className = 'empty-list-msg';
        td.textContent = 'No records in this table';
        emptyRow.appendChild(td);
        tbody.appendChild(emptyRow);
    } else {
        rows.forEach(row => {
            const tr = document.createElement('tr');
            columns.forEach(col => {
                const td = document.createElement('td');
                const colKey = col.column_name || col.name || col;
                const value = row[colKey];
                
                if (value === null || value === undefined) {
                    td.textContent = 'null';
                    td.className = 'null-value';
                } else if (typeof value === 'object') {
                    td.textContent = JSON.stringify(value);
                } else {
                    td.textContent = value;
                }
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
    }
    table.appendChild(tbody);
    wrapper.appendChild(table);

    gridContainer.innerHTML = '';
    gridContainer.appendChild(wrapper);
}

// Render error box inside results container on query failure
function renderErrorBox(errorText) {
    const gridContainer = document.getElementById('tab-content-grid');
    gridContainer.innerHTML = `
        <div class="error-box">
            <div class="error-title">
                <i class="fa-solid fa-triangle-exclamation"></i> SQL Error / Execution Failed
            </div>
            <p>${errorText}</p>
        </div>
    `;
    queryMeta.textContent = 'Failed';
}

// Handle executing a query
async function handleExecuteQuery() {
    const sql = queryEditor.value;
    if (!sql || sql.trim() === '') {
        showToast('Query is empty', 'info');
        return;
    }

    btnRun.disabled = true;
    btnRun.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Running...';
    
    switchTab('grid');
    btnInsertRow.style.display = 'none'; // Query might not be a table
    exportDropdown.style.display = 'none';
    tabBtnChart.disabled = true;

    const gridContainer = document.getElementById('tab-content-grid');
    gridContainer.innerHTML = `
        <div class="results-placeholder">
            <i class="fa-solid fa-spinner fa-spin placeholder-icon"></i>
            <p>Running query...</p>
        </div>
    `;
    queryMeta.textContent = 'Running...';

    try {
        const res = await fetch(`${API_BASE}/api/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql })
        });
        const data = await res.json();

        if (res.ok) {
            const result = data.results[0];
            const duration = data.duration;
            
            showToast('Query executed successfully!', 'success');
            queryMeta.textContent = `Time: ${duration} | Affected: ${result.rowCount} rows`;

            // Add query to history
            addQueryToHistory(sql);

            if (result.rows && result.rows.length > 0) {
                const headers = result.fields.length > 0 
                    ? result.fields.map(f => f.name) 
                    : Object.keys(result.rows[0]);
                
                // Store results for exporting & charting
                state.lastQueryResults = {
                    columns: headers,
                    rows: result.rows,
                    tableName: 'query_result'
                };
                
                renderTableGrid(headers, result.rows);
                exportDropdown.style.display = 'inline-block';
                
                // Enable chart helper
                enableChartIfPossible(headers, result.rows);
            } else {
                state.lastQueryResults = null;
                gridContainer.innerHTML = `
                    <div class="success-box">
                        <div class="error-title" style="color: var(--accent-green)">
                            <i class="fa-solid fa-circle-check"></i> Query executed successfully.
                        </div>
                        <p style="margin-top: 10px;">Status: <strong>${result.command}</strong></p>
                        <p>Affected rows: <strong>${result.rowCount}</strong></p>
                    </div>
                `;
            }

            if (result.command && (
                result.command.startsWith('CREATE') || 
                result.command.startsWith('DROP') || 
                result.command.startsWith('ALTER')
            )) {
                await loadTables();
            }
        } else {
            showToast('Query execution failed', 'error');
            renderErrorBox(data.error || 'Execution failed.');
            highlightErrorLine(data.error || ''); // Parse and highlight error line!
        }
    } catch (err) {
        showToast('Network error executing query', 'error');
        renderErrorBox('Failed to connect to backend server.');
    } finally {
        btnRun.disabled = false;
        btnRun.innerHTML = '<i class="fa-solid fa-play"></i> Run Query <span class="kbd-shortcut">Ctrl+Enter</span>';
    }
}

// Fetch relationships and compile/render Mermaid ER Diagram
async function loadAndRenderERDiagram() {
    const erCanvas = document.getElementById('er-canvas');
    erCanvas.innerHTML = `
        <div class="results-placeholder">
            <i class="fa-solid fa-spinner fa-spin placeholder-icon"></i>
            <p>Loading database relationships...</p>
        </div>
    `;
    queryMeta.textContent = 'Loading schema...';

    try {
        const res = await fetch(`${API_BASE}/api/relationships`);
        const data = await res.json();

        if (!res.ok) {
            showToast(data.error || 'Failed to load relationships', 'error');
            erCanvas.innerHTML = `
                <div class="error-box" style="margin: 0;">
                    <div class="error-title"><i class="fa-solid fa-triangle-exclamation"></i> Schema Load Failed</div>
                    <p>${data.error || 'Database error'}</p>
                </div>
            `;
            return;
        }

        const tables = data.tables || {};
        const relationships = data.relationships || [];

        if (Object.keys(tables).length === 0) {
            erCanvas.innerHTML = `
                <div class="results-placeholder">
                    <i class="fa-solid fa-circle-info placeholder-icon" style="opacity:0.3;"></i>
                    <p>No tables exist in this database yet. Create tables to see the ER diagram.</p>
                </div>
            `;
            queryMeta.textContent = 'Empty Database';
            return;
        }

        let mermaidCode = 'erDiagram\n';

        for (const [tableName, columns] of Object.entries(tables)) {
            mermaidCode += `    ${tableName} {\n`;
            columns.forEach(col => {
                let sanitizedType = col.type
                    .replace(/\s+/g, '-')
                    .replace(/[^a-zA-Z0-9-]/g, '');
                
                let keyLabel = '';
                const lowerColName = col.name.toLowerCase();
                if (lowerColName.includes('id') && lowerColName.includes(tableName.toLowerCase().replace(/s$/, ''))) {
                    keyLabel = 'PK';
                }
                
                mermaidCode += `        ${sanitizedType} ${col.name} ${keyLabel}\n`;
            });
            mermaidCode += `    }\n`;
        }

        const drawnRelations = new Set();
        relationships.forEach(rel => {
            const relKey = `${rel.target_table}-${rel.source_table}`;
            if (!drawnRelations.has(relKey)) {
                mermaidCode += `    ${rel.target_table} ||--o{ ${rel.source_table} : "has"\n`;
                drawnRelations.add(relKey);
            }
        });

        queryMeta.textContent = `ER Diagram | Tables: ${Object.keys(tables).length} | Relations: ${relationships.length}`;
        
        // Save tables and relationships in state so they are accessible by highlighting logic
        state.erTables = tables;
        state.erRelationships = relationships;
        state.activeErTable = null;

        mermaid.initialize({
            startOnLoad: false,
            theme: 'dark',
            securityLevel: 'loose',
            er: {
                useMaxWidth: true
            }
        });

        erCanvas.removeAttribute('data-processed');
        const { svg } = await mermaid.render('er-diagram-svg-render', mermaidCode);
        erCanvas.innerHTML = svg;

        // Hook up Zoom and Pan helper after rendering
        const svgEl = erCanvas.querySelector('svg');
        if (svgEl) {
            setupZoomAndPan(document.getElementById('er-canvas-container'), svgEl);
            setupTableHighlights(svgEl, tables, relationships);
        }

    } catch (err) {
        console.error('Mermaid render error:', err);
        erCanvas.innerHTML = `
            <div class="error-box" style="margin: 0;">
                <div class="error-title"><i class="fa-solid fa-triangle-exclamation"></i> ER Diagram Rendering Error</div>
                <p>Could not build visual map. Detail: ${err.message || err}</p>
            </div>
        `;
        queryMeta.textContent = 'Diagram Error';
    }
}

// ============================================================
// CLEAN PAN + ZOOM ENGINE FOR ER DIAGRAM
// CSS-fit mode on load, transform mode on pan/zoom
// ============================================================
function setupZoomAndPan(container, svg) {
    svg.style.display = 'block';
    svg.style.transformOrigin = '0 0';
    svg.style.cursor = 'grab';
    svg.style.maxWidth = 'none';

    let mode = 'fit';   // 'fit' (CSS) or 'pan' (transform)
    let scale = 1, tx = 0, ty = 0;
    let isDragging = false, lastMouseX = 0, lastMouseY = 0;

    // ---- FIT MODE: let CSS scale SVG to fill container width ----
    function goFitMode(animated) {
        mode = 'fit';
        if (animated) {
            svg.style.transition = 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)';
            setTimeout(() => { svg.style.transition = 'none'; }, 400);
        } else {
            svg.style.transition = 'none';
        }
        svg.style.transform = '';
        svg.style.width = '100%';
        svg.style.height = 'auto';
    }

    // ---- SWITCH TO TRANSFORM MODE (called on first drag / zoom) ----
    function goTransformMode() {
        if (mode === 'pan') return; // already in pan mode
        mode = 'pan';
        // Capture current CSS-rendered dimensions to init transform state
        const svgRect = svg.getBoundingClientRect();
        const cRect = container.getBoundingClientRect();
        const vb = svg.viewBox && svg.viewBox.baseVal;
        const svgW = vb && vb.width > 0 ? vb.width : svgRect.width;
        const svgH = vb && vb.height > 0 ? vb.height : svgRect.height;
        
        scale = svgRect.width / svgW; // CSS-applied scale
        tx = svgRect.left - cRect.left;
        ty = svgRect.top - cRect.top;
        
        // Force the SVG to render at its natural viewBox size, so scale math is 1:1
        svg.style.width = svgW + 'px';
        svg.style.height = svgH + 'px';
        svg.style.transition = 'none';
        svg.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    }

    function applyTransform(animated) {
        if (mode !== 'pan') return;
        if (animated) {
            svg.style.transition = 'transform 0.45s cubic-bezier(0.16, 1, 0.3, 1)';
            setTimeout(() => { svg.style.transition = 'none'; }, 450);
        }
        svg.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    }

    // Start in CSS fit mode
    goFitMode(false);

    // Expose to highlight functions
    container.erCenterFull = function() { goFitMode(true); };

    // Focus on a specific SVG group element — using SCREEN SPACE (no viewBox math)
    container.erFocusOnElement = function(groupEl) {
        if (mode === 'fit') goTransformMode();

        const groupRect = groupEl.getBoundingClientRect();
        const cRect = container.getBoundingClientRect();

        // 1. Group center in screen coordinates relative to the container
        const gCX = groupRect.left - cRect.left + groupRect.width / 2;
        const gCY = groupRect.top - cRect.top + groupRect.height / 2;

        // 2. Convert group center to SVG coordinate space using current tx, ty, and scale
        const svgCX = (gCX - tx) / scale;
        const svgCY = (gCY - ty) / scale;

        // 3. Set the target scale (comfortably readable scale, e.g. 1.1)
        scale = 1.1;

        // 4. Center of the container
        const cCX = cRect.width / 2;
        const cCY = cRect.height / 2;

        // 5. Calculate new tx and ty to put the group center at the container center
        tx = cCX - svgCX * scale;
        ty = cCY - svgCY * scale;

        applyTransform(true);
    };


    // ---- DRAG PAN — delta-based, no snap ----
    let dragStartX = 0;
    let dragStartY = 0;

    container.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        goTransformMode(); // switch from CSS to transform on first drag
        isDragging = true;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        state.preventErClickReset = false;
        svg.style.cursor = 'grabbing';
        svg.style.transition = 'none';
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        e.preventDefault();

        // Calculate distance moved from start of drag
        const dist = Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY);
        if (dist > 5) {
            state.preventErClickReset = true; // Dragged enough to count as pan, not click
        }

        tx += e.clientX - lastMouseX;
        ty += e.clientY - lastMouseY;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
        svg.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    });

    window.addEventListener('mouseup', () => {
        isDragging = false;
        svg.style.cursor = 'grab';
    });

    // ---- ZOOM BUTTONS ----
    const tabContainer = document.getElementById('tab-content-er');
    let controls = tabContainer.querySelector('.er-zoom-controls');
    if (!controls) {
        controls = document.createElement('div');
        controls.className = 'er-zoom-controls';
        controls.innerHTML = `
            <button class="zoom-btn" id="er-zoom-in" title="Zoom In"><i class="fa-solid fa-plus"></i></button>
            <button class="zoom-btn" id="er-zoom-out" title="Zoom Out"><i class="fa-solid fa-minus"></i></button>
            <button class="zoom-btn" id="er-zoom-reset" title="Reset View"><i class="fa-solid fa-arrows-to-eye"></i></button>
        `;
        tabContainer.appendChild(controls);

        controls.querySelector('#er-zoom-in').addEventListener('click', (e) => {
            e.stopPropagation();
            if (mode === 'fit') goTransformMode();
            const cRect = container.getBoundingClientRect();
            const cx = cRect.width / 2, cy = cRect.height / 2, f = 1.25;
            tx = cx - (cx - tx) * f;
            ty = cy - (cy - ty) * f;
            scale = Math.min(3, scale * f);
            applyTransform(false);
        });
        controls.querySelector('#er-zoom-out').addEventListener('click', (e) => {
            e.stopPropagation();
            if (mode === 'fit') goTransformMode();
            const cRect = container.getBoundingClientRect();
            const cx = cRect.width / 2, cy = cRect.height / 2, f = 1 / 1.25;
            tx = cx - (cx - tx) * f;
            ty = cy - (cy - ty) * f;
            scale = Math.max(0.02, scale * f);
            applyTransform(false);
        });
        controls.querySelector('#er-zoom-reset').addEventListener('click', (e) => {
            e.stopPropagation();
            goFitMode(true);
            resetErHighlights(svg);
            state.activeErTable = null;
        });
    }
}


// Setup Table click highlighting and relation focusing
function setupTableHighlights(svgEl, tables, relationships) {
    const container = document.getElementById('er-canvas-container');

    // Reset highlights when clicking empty space
    container.addEventListener('click', (e) => {
        if (state.preventErClickReset) {
            state.preventErClickReset = false;
            return;
        }
        if (e.target === container || e.target.tagName === 'svg' || e.target.tagName === 'g' && e.target === svgEl.firstElementChild) {
            if (state.activeErTable) {
                resetErHighlights(svgEl);
                state.activeErTable = null;
                if (container.erCenterFull) container.erCenterFull();
            }
        }
    });

    // Bind click to each table group
    Object.keys(tables).forEach(tableName => {
        const group = getEntityGroupByTableName(svgEl, tableName);
        if (group) {
            group.style.cursor = 'pointer';
            group.addEventListener('click', (e) => {
                if (state.preventErClickReset) {
                    state.preventErClickReset = false;
                    return;
                }
                e.stopPropagation();
                highlightTableAndRelations(svgEl, tableName);
            });
        }
    });
}

// Find SVG <g> group for a table by name
function getEntityGroupByTableName(svgEl, tableName) {
    // Search through all text elements for exact match
    const texts = svgEl.querySelectorAll('text');
    for (const text of texts) {
        if (text.textContent.trim() === tableName) {
            // Walk up to find the entity group (g element with rect children)
            let el = text.parentElement;
            while (el && el !== svgEl) {
                if (el.tagName === 'g') {
                    const hasRect = el.querySelector('rect');
                    if (hasRect) return el;
                }
                el = el.parentElement;
            }
        }
    }
    return null;
}

// Check if a relationship path is connected to a table
function isPathConnectedToTable(path, tableName) {
    const checkEl = (el) => {
        if (!el) return false;
        const id = el.id || '';
        const cls = el.getAttribute('class') || '';
        const combined = `${id} ${cls}`;
        return combined.includes(`-${tableName}`) || combined.includes(`${tableName}-`) ||
               id === tableName || id.startsWith(`entity-${tableName}`);
    };
    return checkEl(path) || checkEl(path.parentElement) || checkEl(path.parentElement?.parentElement);
}

// Highlight clicked table + direct relations, dim everything else
function highlightTableAndRelations(svgEl, activeTable) {
    const container = document.getElementById('er-canvas-container');

    // Toggle off if clicking same table again
    if (state.activeErTable === activeTable) {
        resetErHighlights(svgEl);
        state.activeErTable = null;
        if (container.erCenterFull) container.erCenterFull();
        return;
    }
    state.activeErTable = activeTable;

    // Find directly related tables
    const relatedTables = new Set([activeTable]);
    (state.erRelationships || []).forEach(rel => {
        if (rel.source_table === activeTable) relatedTables.add(rel.target_table);
        if (rel.target_table === activeTable) relatedTables.add(rel.source_table);
    });

    const tablesList = Object.keys(state.erTables || {});

    // 1. Style all table groups
    tablesList.forEach(tableName => {
        const group = getEntityGroupByTableName(svgEl, tableName);
        if (!group) return;

        const rects = group.querySelectorAll('rect');

        if (tableName === activeTable) {
            // Selected table — bring to front (move to end of SVG)
            svgEl.appendChild(group);
            group.style.opacity = '1';
            group.style.filter = 'drop-shadow(0 0 14px rgba(56,189,248,0.9))';
            rects.forEach(r => {
                r.style.stroke = '#38bdf8';
                r.style.strokeWidth = '3px';
            });
        } else if (relatedTables.has(tableName)) {
            // Related — highlighted green
            group.style.opacity = '1';
            group.style.filter = 'drop-shadow(0 0 6px rgba(16,185,129,0.5))';
            rects.forEach(r => {
                r.style.stroke = '#10b981';
                r.style.strokeWidth = '2px';
            });
        } else {
            // Unrelated — dim heavily
            group.style.opacity = '0.08';
            group.style.filter = 'none';
            rects.forEach(r => {
                r.style.stroke = '';
                r.style.strokeWidth = '';
            });
        }
    });

    // 2. Style relationship lines
    const allPaths = svgEl.querySelectorAll('path, line, polyline, marker path');
    allPaths.forEach(path => {
        const connected = isPathConnectedToTable(path, activeTable);
        if (connected) {
            path.style.opacity = '1';
            if (path.tagName !== 'marker') {
                path.style.stroke = '#38bdf8';
                path.style.strokeWidth = '2.5px';
            }
        } else {
            path.style.opacity = '0.04';
        }
    });

    // 3. Zoom & center on the selected table
    const activeGroup = getEntityGroupByTableName(svgEl, activeTable);
    if (activeGroup && container.erFocusOnElement) {
        container.erFocusOnElement(activeGroup);
    }
}

// Reset all ER diagram styling to default
function resetErHighlights(svgEl) {
    const tablesList = Object.keys(state.erTables || {});
    tablesList.forEach(tableName => {
        const group = getEntityGroupByTableName(svgEl, tableName);
        if (!group) return;
        group.style.opacity = '1';
        group.style.filter = 'none';
        group.querySelectorAll('rect').forEach(r => {
            r.style.stroke = '';
            r.style.strokeWidth = '';
        });
    });

    svgEl.querySelectorAll('path, line, polyline, marker path').forEach(path => {
        path.style.opacity = '';
        path.style.stroke = '';
        path.style.strokeWidth = '';
    });
}


/* ==========================================
   FEATURE 1: CHART VISUALIZATION (Chart.js)
   ========================================== */
function enableChartIfPossible(headers, rows) {
    if (rows.length === 0) {
        tabBtnChart.disabled = true;
        return;
    }

    // Heuristically find numeric column keys
    let numericCols = [];
    const firstRow = rows[0];
    
    headers.forEach(header => {
        const val = firstRow[header];
        if (val !== null && val !== undefined && !isNaN(Number(val))) {
            numericCols.push(header);
        }
    });

    if (numericCols.length > 0) {
        tabBtnChart.disabled = false;
    } else {
        tabBtnChart.disabled = true;
    }
}

function renderChartVisualization() {
    if (!state.lastQueryResults || state.lastQueryResults.rows.length === 0) return;

    const headers = state.lastQueryResults.columns;
    const rows = state.lastQueryResults.rows;

    const xSelect = document.getElementById('chart-x-axis');
    const ySelect = document.getElementById('chart-y-axis');
    const typeSelect = document.getElementById('chart-type');

    // Populate dropdown fields if empty
    const currentX = xSelect.value;
    const currentY = ySelect.value;

    xSelect.innerHTML = '';
    ySelect.innerHTML = '';

    headers.forEach(h => {
        const optX = document.createElement('option');
        optX.value = h;
        optX.textContent = h;
        if (h === currentX) optX.selected = true;
        xSelect.appendChild(optX);

        // Check if numerical to put in Y options
        const val = rows[0][h];
        if (val !== null && val !== undefined && !isNaN(Number(val))) {
            const optY = document.createElement('option');
            optY.value = h;
            optY.textContent = h;
            if (h === currentY) optY.selected = true;
            ySelect.appendChild(optY);
        }
    });

    // Default choices if selections don't match or are empty
    if (!xSelect.value && headers.length > 0) xSelect.value = headers[0];
    if (!ySelect.value && ySelect.options.length > 0) ySelect.value = ySelect.options[0].value;

    // Destruct previous chart instance
    if (state.chartInstance) {
        state.chartInstance.destroy();
        state.chartInstance = null;
    }

    const xKey = xSelect.value;
    const yKey = ySelect.value;
    const chartType = typeSelect.value;

    if (!xKey || !yKey) {
        queryMeta.textContent = 'Chart View - No numerical columns';
        return;
    }

    // Map labels and data points
    const labels = rows.map(r => r[xKey] === null ? 'null' : String(r[xKey]));
    const dataPoints = rows.map(r => Number(r[yKey] || 0));

    // Dynamic color configurations
    let bgColors = 'rgba(56, 189, 248, 0.4)';
    let borderColors = '#38bdf8';
    
    if (chartType === 'pie') {
        bgColors = [
            'rgba(56, 189, 248, 0.6)',
            'rgba(16, 185, 129, 0.6)',
            'rgba(249, 115, 22, 0.6)',
            'rgba(239, 68, 68, 0.6)',
            'rgba(139, 92, 246, 0.6)',
            'rgba(236, 72, 153, 0.6)',
            'rgba(234, 179, 8, 0.6)'
        ];
        borderColors = '#161b26';
    }

    const ctx = document.getElementById('chart-canvas').getContext('2d');
    state.chartInstance = new Chart(ctx, {
        type: chartType,
        data: {
            labels: labels,
            datasets: [{
                label: yKey,
                data: dataPoints,
                backgroundColor: bgColors,
                borderColor: borderColors,
                borderWidth: 1.5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: { color: '#f3f4f6', font: { family: 'Inter' } }
                }
            },
            scales: chartType !== 'pie' ? {
                x: {
                    grid: { color: '#2e374a' },
                    ticks: { color: '#9ca3af' }
                },
                y: {
                    grid: { color: '#2e374a' },
                    ticks: { color: '#9ca3af' }
                }
            } : {}
        }
    });

    queryMeta.textContent = `Chart: ${chartType.toUpperCase()} | X: ${xKey} | Y: ${yKey}`;
}

/* ==========================================
   FEATURE 2: SAVED QUERIES & HISTORY
   ========================================== */
function loadHistory() {
    const historyList = document.getElementById('history-list');
    let queries = [];
    try {
        queries = JSON.parse(localStorage.getItem('sql_pro_history') || '[]');
    } catch(e) {}

    if (queries.length === 0) {
        historyList.innerHTML = '<li class="empty-list-msg">No queries run yet</li>';
        return;
    }

    historyList.innerHTML = '';
    queries.forEach((q, idx) => {
        const li = document.createElement('li');
        li.innerHTML = `
            <span class="query-text" title="${q.sql.replace(/"/g, '&quot;')}">${q.sql}</span>
            <div class="item-meta">
                <span>${q.time}</span>
                <button class="delete-btn" data-idx="${idx}" title="Delete item"><i class="fa-solid fa-trash-can"></i></button>
            </div>
        `;
        li.addEventListener('click', (e) => {
            if (e.target.closest('.delete-btn')) {
                e.stopPropagation();
                deleteHistoryItem(idx);
            } else {
                queryEditor.value = q.sql;
                updateLineNumbers();
                queryEditor.focus();
                showToast('Loaded query from history', 'info');
            }
        });
        historyList.appendChild(li);
    });
}

// Add query to history list
function addQueryToHistory(sql) {
    let queries = [];
    try {
        queries = JSON.parse(localStorage.getItem('sql_pro_history') || '[]');
    } catch(e) {}

    if (queries.length > 0 && queries[0].sql === sql) return;

    const timeString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    queries.unshift({ sql, time: timeString });
    
    if (queries.length > 20) queries.pop();

    localStorage.setItem('sql_pro_history', JSON.stringify(queries));
    loadHistory();
}

function deleteHistoryItem(idx) {
    let queries = JSON.parse(localStorage.getItem('sql_pro_history') || '[]');
    queries.splice(idx, 1);
    localStorage.setItem('sql_pro_history', JSON.stringify(queries));
    loadHistory();
}

// Bookmark / Save Query
function loadBookmarks() {
    const bookmarkList = document.getElementById('saved-queries-list');
    let bookmarks = [];
    try {
        bookmarks = JSON.parse(localStorage.getItem('sql_pro_bookmarks') || '[]');
    } catch(e) {}

    if (bookmarks.length === 0) {
        bookmarkList.innerHTML = '<li class="empty-list-msg">No bookmarked queries</li>';
        return;
    }

    bookmarkList.innerHTML = '';
    bookmarks.forEach((b, idx) => {
        const li = document.createElement('li');
        li.innerHTML = `
            <strong>${b.name}</strong>
            <span class="query-text" title="${b.sql.replace(/"/g, '&quot;')}">${b.sql}</span>
            <div class="item-meta">
                <span>Starred</span>
                <button class="delete-btn" data-idx="${idx}" title="Delete bookmark"><i class="fa-solid fa-trash-can"></i></button>
            </div>
        `;
        li.addEventListener('click', (e) => {
            if (e.target.closest('.delete-btn')) {
                e.stopPropagation();
                deleteBookmarkItem(idx);
            } else {
                queryEditor.value = b.sql;
                updateLineNumbers();
                queryEditor.focus();
                showToast(`Loaded bookmarked query "${b.name}"`, 'info');
            }
        });
        bookmarkList.appendChild(li);
    });
}

function handleSaveQuery() {
    const sql = queryEditor.value;
    if (!sql || sql.trim() === '') {
        showToast('Cannot bookmark an empty query', 'info');
        return;
    }

    const name = prompt('Enter a name for this bookmark:', 'My Query');
    if (name === null) return;

    let bookmarks = [];
    try {
        bookmarks = JSON.parse(localStorage.getItem('sql_pro_bookmarks') || '[]');
    } catch(e) {}

    bookmarks.unshift({ name: name || 'Saved SQL', sql });
    localStorage.setItem('sql_pro_bookmarks', JSON.stringify(bookmarks));
    loadBookmarks();
    showToast('Query bookmarked successfully!', 'success');
}

function deleteBookmarkItem(idx) {
    let bookmarks = JSON.parse(localStorage.getItem('sql_pro_bookmarks') || '[]');
    bookmarks.splice(idx, 1);
    localStorage.setItem('sql_pro_bookmarks', JSON.stringify(bookmarks));
    loadBookmarks();
}

/* ==========================================
   FEATURE 3: VISUAL DATA INSERTION FORM
   ========================================== */
function openInsertRowModal() {
    if (!state.activeTable || state.currentTableColumns.length === 0) return;

    const titleEl = document.getElementById('insert-row-table-title');
    titleEl.textContent = state.activeTable;

    const form = document.getElementById('insert-row-form');
    form.innerHTML = '';

    state.currentTableColumns.forEach(col => {
        const label = document.createElement('label');
        label.textContent = col.column_name;

        const inputGroup = document.createElement('div');
        inputGroup.className = 'form-group-wrapper';

        let input;
        
        if (col.data_type.includes('bool')) {
            input = document.createElement('select');
            input.innerHTML = `
                <option value="NULL">NULL</option>
                <option value="true">TRUE</option>
                <option value="false">FALSE</option>
            `;
        } else {
            input = document.createElement('input');
            
            if (col.data_type.includes('int') || col.data_type.includes('dec') || col.data_type.includes('num')) {
                input.type = 'number';
                input.step = col.data_type.includes('dec') || col.data_type.includes('num') ? 'any' : '1';
            } else if (col.data_type.includes('date')) {
                input.type = 'date';
            } else {
                input.type = 'text';
            }
            
            if (col.column_default && col.column_default.includes('nextval')) {
                input.placeholder = '(Auto Serial Primary Key)';
                input.disabled = true;
            } else {
                input.placeholder = col.is_nullable === 'YES' ? '(Optional)' : 'Required';
                if (col.is_nullable === 'NO') {
                    input.required = true;
                }
            }
        }
        
        input.name = col.column_name;
        inputGroup.appendChild(input);

        form.appendChild(label);
        form.appendChild(inputGroup);
    });

    openModal('modal-insert-row');
}

async function handleInsertRowSubmit(e) {
    e.preventDefault();

    const form = document.getElementById('insert-row-form');
    const formData = new FormData(form);

    const cols = [];
    const vals = [];

    state.currentTableColumns.forEach(col => {
        if (col.column_default && col.column_default.includes('nextval')) {
            return;
        }

        const rawVal = formData.get(col.column_name);

        if (rawVal === '' || rawVal === 'NULL') {
            if (col.is_nullable === 'YES') {
                cols.push(`"${col.column_name}"`);
                vals.push('NULL');
            }
        } else {
            cols.push(`"${col.column_name}"`);
            
            if (col.data_type.includes('bool') || col.data_type.includes('int') || col.data_type.includes('dec') || col.data_type.includes('num')) {
                vals.push(rawVal);
            } else {
                const escapedVal = rawVal.replace(/'/g, "''");
                vals.push(`'${escapedVal}'`);
            }
        }
    });

    if (cols.length === 0) {
        showToast('Form is empty', 'info');
        return;
    }

    const insertSql = `INSERT INTO "${state.activeTable}" (${cols.join(', ')}) VALUES (${vals.join(', ')});`;
    
    closeModal('modal-insert-row');
    
    queryEditor.value = insertSql;
    updateLineNumbers();
    await handleExecuteQuery();

    if (state.activeTable) {
        await handleTableSelect(state.activeTable);
    }
}

/* ==========================================
   FEATURE 4: VISUAL TABLE CREATOR (GUI Builder)
   ========================================== */
function openCreateTableModal() {
    document.getElementById('create-table-name').value = '';
    const container = document.getElementById('builder-rows-container');
    container.innerHTML = '';
    
    addBuilderColumnRow();
    addBuilderColumnRow();
    
    openModal('modal-create-table');
}

function addBuilderColumnRow() {
    const container = document.getElementById('builder-rows-container');
    const rowId = 'row-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    
    const row = document.createElement('div');
    row.className = 'builder-row';
    row.id = rowId;

    row.innerHTML = `
        <input type="text" class="col-name-input" placeholder="column_name" required>
        <select class="col-type-select">
            <option value="INT">INTEGER</option>
            <option value="SERIAL">SERIAL (Auto-Increment PK)</option>
            <option value="VARCHAR(255)">VARCHAR(255)</option>
            <option value="TEXT">TEXT</option>
            <option value="DECIMAL(10,2)">DECIMAL(10,2)</option>
            <option value="DATE">DATE</option>
            <option value="BOOLEAN">BOOLEAN</option>
        </select>
        <input type="checkbox" class="col-pk-check" title="Primary Key">
        <input type="checkbox" class="col-nn-check" title="Not Null">
        <input type="checkbox" class="col-uq-check" title="Unique">
        <button type="button" class="btn-delete-row" onclick="deleteBuilderRow('${rowId}')" title="Delete Column">
            <i class="fa-solid fa-trash-can"></i>
        </button>
    `;
    container.appendChild(row);
}

window.deleteBuilderRow = function(rowId) {
    const rowEl = document.getElementById(rowId);
    if (rowEl) rowEl.remove();
};

async function handleCreateTableSubmit() {
    const tableName = document.getElementById('create-table-name').value.trim();
    if (!tableName) {
        showToast('Table name is required', 'error');
        return;
    }

    const rows = document.querySelectorAll('#builder-rows-container .builder-row');
    if (rows.length === 0) {
        showToast('At least one column is required', 'error');
        return;
    }

    const columnDefs = [];
    let hasPK = false;

    for (let r of rows) {
        const colName = r.querySelector('.col-name-input').value.trim();
        let colType = r.querySelector('.col-type-select').value;
        const isPK = r.querySelector('.col-pk-check').checked;
        const isNN = r.querySelector('.col-nn-check').checked;
        const isUQ = r.querySelector('.col-uq-check').checked;

        if (!colName) {
            showToast('Column name cannot be blank', 'error');
            return;
        }

        let def = `"${colName}" `;
        
        if (colType === 'SERIAL') {
            def += 'SERIAL PRIMARY KEY';
            hasPK = true;
        } else {
            def += colType;
            if (isPK && !hasPK) {
                def += ' PRIMARY KEY';
                hasPK = true;
            }
            if (isNN) {
                def += ' NOT NULL';
            }
            if (isUQ) {
                def += ' UNIQUE';
            }
        }

        columnDefs.push(def);
    }

    const createSql = `CREATE TABLE "${tableName}" (\n    ${columnDefs.join(',\n    ')}\n);`;

    closeModal('modal-create-table');

    queryEditor.value = createSql;
    updateLineNumbers();
    await handleExecuteQuery();
    await loadTables();
}

/* ==========================================
   FEATURE 5: EXPORT CSV / JSON / SQL
   ========================================== */
function handleExportCSV() {
    if (!state.lastQueryResults) return;
    const cols = state.lastQueryResults.columns;
    const rows = state.lastQueryResults.rows;

    let csvContent = cols.map(c => `"${c.replace(/"/g, '""')}"`).join(',') + '\n';
    
    rows.forEach(row => {
        csvContent += cols.map(c => {
            const val = row[c];
            if (val === null || val === undefined) return '""';
            return `"${String(val).replace(/"/g, '""')}"`;
        }).join(',') + '\n';
    });

    triggerFileDownload(csvContent, `${state.lastQueryResults.tableName || 'export'}.csv`, 'text/csv');
}

function handleExportJSON() {
    if (!state.lastQueryResults) return;
    const rows = state.lastQueryResults.rows;
    const jsonContent = JSON.stringify(rows, null, 2);
    triggerFileDownload(jsonContent, `${state.lastQueryResults.tableName || 'export'}.json`, 'application/json');
}

function handleExportSQL() {
    if (!state.lastQueryResults) return;
    const cols = state.lastQueryResults.columns;
    const rows = state.lastQueryResults.rows;
    const tableName = state.lastQueryResults.tableName || 'export_table';

    let sqlContent = `-- Exports for table "${tableName}" (${rows.length} rows)\n`;
    
    rows.forEach(row => {
        const columnsList = cols.map(c => `"${c}"`).join(', ');
        const valuesList = cols.map(c => {
            const val = row[c];
            if (val === null || val === undefined) return 'NULL';
            if (typeof val === 'number' || typeof val === 'boolean') return val;
            return `'${String(val).replace(/'/g, "''")}'`;
        }).join(', ');

        sqlContent += `INSERT INTO "${tableName}" (${columnsList}) VALUES (${valuesList});\n`;
    });

    triggerFileDownload(sqlContent, `${tableName}.sql`, 'text/plain');
}

function triggerFileDownload(content, fileName, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(`Successfully downloaded "${fileName}"`, 'success');
}

/* ==========================================
   MODAL MANAGER CONTROLS
   ========================================== */
function openModal(modalId) {
    document.getElementById(modalId).classList.add('active');
}

// Close Modal window helper
function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

/* ==========================================
   FEATURE 6: AI CHATBOT & RAG ENGINE
   ========================================== */
let ragPollingInterval = null;
let lastRagStatus = null;

function startRAGStatusPolling() {
    if (ragPollingInterval) clearInterval(ragPollingInterval);
    
    // Immediate check
    checkRAGStatus();
    
    // Poll every 10 seconds
    ragPollingInterval = setInterval(checkRAGStatus, 10000);
}

function stopRAGStatusPolling() {
    if (ragPollingInterval) {
        clearInterval(ragPollingInterval);
        ragPollingInterval = null;
    }
    lastRagStatus = null;
    updateRAGStatusUI('idle', 'Not Connected', false);
}

async function checkRAGStatus() {
    if (!state.connected) return;
    try {
        const res = await fetch(`${API_BASE}/api/rag/status`);
        const data = await res.json();
        
        if (res.ok) {
            let statusText = 'Not Synced';
            let isConfigured = data.api_configured;
            
            if (data.status === 'indexing') {
                statusText = 'Indexing database...';
            } else if (data.status === 'synced') {
                statusText = 'Database Synced';
            } else if (data.status === 'failed') {
                statusText = 'Sync Failed';
                // Show toast notification ONCE when transition happens to failed
                if (lastRagStatus !== 'failed' && data.error) {
                    showToast(`Sync Failed: ${data.error}`, 'error');
                }
            }
            
            lastRagStatus = data.status;
            updateRAGStatusUI(data.status, statusText, isConfigured, data.error);
        }
    } catch (err) {
        console.error('Error fetching RAG status:', err);
    }
}

function updateRAGStatusUI(status, text, isConfigured, errorMsg = '') {
    const dot = document.getElementById('rag-status-dot');
    const textEl = document.getElementById('rag-status-text');
    
    if (!dot || !textEl) return;
    
    textEl.textContent = `${text} ${isConfigured ? '' : '(No API Key)'}`;
    
    // Add tooltip showing the error details on hover
    if (status === 'failed' && errorMsg) {
        textEl.title = `Error details: ${errorMsg}`;
        dot.title = `Error details: ${errorMsg}`;
    } else {
        textEl.title = '';
        dot.title = '';
    }
    
    dot.className = 'status-dot';
    if (status === 'indexing') {
        dot.classList.add('connected');
    } else if (status === 'synced') {
        dot.classList.add('connected');
    } else if (status === 'failed') {
        dot.classList.add('disconnected');
    } else {
        dot.classList.add('disconnected');
    }
}

async function handleSaveAPIKey() {
    const keyInput = document.getElementById('chat-api-key');
    const key = keyInput.value.trim();
    if (!key) {
        showToast('Please enter an API key', 'error');
        return;
    }
    
    try {
        const res = await fetch(`${API_BASE}/api/rag/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: key })
        });
        const data = await res.json();
        
        if (res.ok) {
            showToast('API Key saved successfully!', 'success');
            keyInput.value = '';
            document.getElementById('chat-settings-pane').style.display = 'none';
            checkRAGStatus();
        } else {
            showToast(data.error || 'Failed to save key', 'error');
        }
    } catch (err) {
        showToast('Network error saving API Key', 'error');
    }
}

async function handleChatSubmit(e) {
    e.preventDefault();
    
    const inputEl = document.getElementById('chat-input');
    const message = inputEl.value.trim();
    if (!message) return;
    
    inputEl.value = '';
    
    // Render user message bubble
    renderChatMessage(message, 'user');
    
    // Append typing indicator loader
    appendTypingIndicator();
    
    try {
        const res = await fetch(`${API_BASE}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: message })
        });
        const data = await res.json();
        
        removeTypingIndicator();
        
        if (res.ok) {
            renderChatMessage(data.response, 'bot');
        } else {
            renderChatMessage(`Error: ${data.error || 'Failed to get answer'}`, 'bot');
        }
    } catch (err) {
        removeTypingIndicator();
        renderChatMessage('Network error: Could not reach backend server.', 'bot');
    }
}

function renderChatMessage(text, sender) {
    const container = document.getElementById('chat-messages');
    if (!container) return;
    
    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-message ${sender}`;
    
    const avatarIcon = sender === 'user' ? 'fa-user' : 'fa-robot';
    
    // Basic Markdown formatting helper (converts backticks code block, bold text, etc.)
    const formattedText = formatMarkdown(text);
    
    msgDiv.innerHTML = `
        <div class="message-avatar"><i class="fa-solid ${avatarIcon}"></i></div>
        <div class="message-content">${formattedText}</div>
    `;
    
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
}

function appendTypingIndicator() {
    const container = document.getElementById('chat-messages');
    if (!container || document.getElementById('typing-loader-wrapper')) return;
    
    const wrapper = document.createElement('div');
    wrapper.className = 'chat-message bot';
    wrapper.id = 'typing-loader-wrapper';
    
    wrapper.innerHTML = `
        <div class="message-avatar"><i class="fa-solid fa-robot"></i></div>
        <div class="message-content">
            <div class="typing-loader">
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
            </div>
        </div>
    `;
    container.appendChild(wrapper);
    container.scrollTop = container.scrollHeight;
}

function removeTypingIndicator() {
    const el = document.getElementById('typing-loader-wrapper');
    if (el) el.remove();
}

function formatMarkdown(text) {
    if (!text) return '';
    
    let html = text
        // Escape HTML
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        // Preformatted code blocks
        .replace(/```([\s\S]*?)```/g, (match, p1) => {
            return `<pre><code>${p1.trim()}</code></pre>`;
        })
        // Inline code
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        // Bold
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        // Italics
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        // Unordered lists
        .replace(/^\s*-\s+(.+)$/gm, '<li>$1</li>')
        // Wrap contiguous list items in ul
        .replace(/(<li>.*<\/li>)/g, '<ul>$1</ul>')
        .replace(/<\/ul>\s*<ul>/g, '') // Merge lists
        // Paragraphs (split by double newlines)
        .split(/\n\n+/).map(p => {
            if (p.startsWith('<ul>') || p.startsWith('<pre>')) return p;
            return `<p>${p.replace(/\n/g, '<br>')}</p>`;
        }).join('');
        
    return html;
}

// ==========================================
// FEATURE 7: AI INTEGRATED DEVELOPER TOOLS
// ==========================================

// Handle Natural Language to SQL
async function handleNL2SQL() {
    const input = document.getElementById('nl2sql-input');
    const btn = document.getElementById('btn-nl2sql-run');
    const prompt = input.value.trim();
    
    if (!prompt) return;
    
    input.disabled = true;
    btn.disabled = true;
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating...';
    
    try {
        const res = await fetch(`${API_BASE}/api/ai/nl2sql`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: prompt,
                database: state.database
            })
        });
        
        const data = await res.json();
        if (res.ok) {
            // Set the generated SQL in editor
            queryEditor.value = data.sql;
            updateLineNumbers();
            
            showToast('SQL generated successfully! Running query...', 'success');
            // Execute the query
            btnRun.click();
        } else {
            showToast(data.error || 'Failed to translate natural language', 'error');
        }
    } catch (err) {
        showToast('Network error during NL2SQL generation', 'error');
        console.error(err);
    } finally {
        input.disabled = false;
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// Handle AI Mock Data Generation
// Helper to show a beautiful custom confirm modal on the page
function showConfirm(message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('modal-confirm');
        const textEl = document.getElementById('confirm-message-text');
        const btnSubmit = document.getElementById('btn-submit-confirm');
        const btnCancel = document.getElementById('btn-cancel-confirm');
        const btnClose = document.getElementById('btn-close-confirm');
        
        textEl.textContent = message;
        openModal('modal-confirm');
        
        const cleanUp = () => {
            closeModal('modal-confirm');
            btnSubmit.removeEventListener('click', onConfirm);
            btnCancel.removeEventListener('click', onCancel);
            btnClose.removeEventListener('click', onCancel);
        };
        
        const onConfirm = () => {
            cleanUp();
            resolve(true);
        };
        
        const onCancel = () => {
            cleanUp();
            resolve(false);
        };
        
        btnSubmit.addEventListener('click', onConfirm);
        btnCancel.addEventListener('click', onCancel);
        btnClose.addEventListener('click', onCancel);
    });
}

// Handle AI Mock Data Generation
async function handleGenerateMockData(tableName) {
    const confirmGen = await showConfirm(`Are you sure you want to generate 20 mock rows via AI for table "${tableName}"? This will only take 1-3 seconds.`);
    if (!confirmGen) return;
    
    showToast(`AI generating 20 mock rows for "${tableName}"...`, 'info');
    
    try {
        const res = await fetch(`${API_BASE}/api/ai/mock-data`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                table: tableName,
                database: state.database
            })
        });
        
        const data = await res.json();
        if (res.ok) {
            showToast(data.message, 'success');
            // Reload the table grid view to show newly added rows if they are currently viewing this table
            if (state.activeTable === tableName) {
                handleTableSelect(tableName);
            }
        } else {
            showToast(data.error || 'Failed to generate mock data', 'error');
        }
    } catch (err) {
        showToast('Network error during mock data generation', 'error');
        console.error(err);
    }
}

// Handle AI Query Optimization Analysis
async function handleAIQueryOptimize() {
    const currentSql = queryEditor.value.trim();
    if (!currentSql) {
        showToast('Please write a SQL query to optimize first.', 'info');
        return;
    }
    
    const btn = document.getElementById('btn-ai-optimize');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Optimizing...';
    
    try {
        const res = await fetch(`${API_BASE}/api/ai/optimize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sql: currentSql,
                database: state.database
            })
        });
        
        const data = await res.json();
        if (res.ok) {
            // Fill optimization modal details
            document.getElementById('opt-original-sql').textContent = currentSql;
            document.getElementById('opt-optimized-sql').textContent = data.optimized_sql;
            
            const explanationContent = document.getElementById('opt-explanation-content');
            explanationContent.innerHTML = formatMarkdown(data.explanation);
            
            const indexesSection = document.getElementById('opt-indexes-section');
            const indexesPre = document.getElementById('opt-suggested-indexes');
            if (data.suggested_indexes_sql && data.suggested_indexes_sql.trim() !== '') {
                indexesPre.textContent = data.suggested_indexes_sql;
                indexesSection.style.display = 'block';
            } else {
                indexesSection.style.display = 'none';
            }
            
            // Store optimized query in modal dataset for apply button
            document.getElementById('modal-ai-optimize').dataset.optimizedSql = data.optimized_sql;
            
            // Open Modal
            openModal('modal-ai-optimize');
        } else {
            showToast(data.error || 'Failed to optimize query', 'error');
        }
    } catch (err) {
        showToast('Network error during query optimization', 'error');
        console.error(err);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}
