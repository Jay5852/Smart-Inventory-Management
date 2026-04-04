let currentEmployee = null;
const baseUrl = (window.location.hostname === "localhost" && window.location.port === "3000") ? "" : "http://localhost:3000";

document.addEventListener("DOMContentLoaded", () => {
    fetchEmployees();
    // Allow Enter key to submit login
    const passField = document.getElementById('emp-password');
    if (passField) {
        passField.addEventListener('keypress', (e) => { if (e.key === 'Enter') login(); });
    }
    const userField = document.getElementById('emp-username');
    if (userField) {
        userField.addEventListener('keypress', (e) => { if (e.key === 'Enter') login(); });
    }
});

let allEmployeesCache = [];

async function fetchEmployees() {
    try {
        const res = await fetch(`${baseUrl}/api/employees`);
        const data = await res.json();
        allEmployeesCache = data.employees || [];
    } catch (e) {
        showToast('Error connecting to server. Is Node running?', 'alert');
    }
}

function login() {
    const usernameInput = document.getElementById('emp-username').value.trim();
    if (!usernameInput) {
        showToast('Please enter your username', 'alert');
        return;
    }

    // Dummy Match: check if typed name matches any employee in DB (case-insensitive)
    const matchedEmp = allEmployeesCache.find(e => e.name.toLowerCase() === usernameInput.toLowerCase());

    if (!matchedEmp) {
        showToast('Employee not found. Check the hint for valid usernames.', 'alert');
        return;
    }

    currentEmployee = {
        uid: matchedEmp.uid,
        name: matchedEmp.name
    };

    // Toggle from login mode to dashboard mode
    document.body.classList.remove('login-mode');
    document.getElementById('login-view').classList.add('hidden');
    document.getElementById('emp-name-display').innerText = currentEmployee.name;
    document.getElementById('emp-name-header').innerText = currentEmployee.name;
    document.getElementById('emp-avatar').innerText = currentEmployee.name.charAt(0).toUpperCase();

    loadDashboard();
}

function logout() {
    currentEmployee = null;
    document.body.classList.add('login-mode');
    document.getElementById('login-view').classList.remove('hidden');
    document.getElementById('emp-username').value = '';
    document.getElementById('emp-password').value = '';
    // Reset to overview tab
    switchTab('overview', document.querySelector('nav a[data-tab="overview"]'));
}

// ==========================================
// DASHBOARD DATA LOADING
// ==========================================
async function loadDashboard() {
    document.getElementById('last-sync-time').innerText = new Date().toLocaleTimeString();
    await Promise.all([
        fetchMyCheckedOutTools(),
        fetchAvailableTools(),
        loadMyRequests()
    ]);
    updateStatCards();
}

let inventoryCache = [];
let myToolsCount = 0;
let availableCount = 0;
let pendingRequestsCount = 0;

function updateStatCards() {
    document.getElementById('emp-stat-total').innerText = inventoryCache.length;
    document.getElementById('emp-stat-available').innerText = availableCount;
    document.getElementById('emp-stat-mytools').innerText = myToolsCount;
    document.getElementById('emp-stat-pending').innerText = pendingRequestsCount;
}

// ==========================================
// AVAILABLE TOOLS (STOREROOM)
// ==========================================
async function fetchAvailableTools() {
    try {
        const res = await fetch(`${baseUrl}/api/inventory`);
        const data = await res.json();
        inventoryCache = data.components || [];

        const availableTools = inventoryCache.filter(c => c.status === 'IN');
        availableCount = availableTools.length;
        const tbody = document.getElementById('available-tools-tbody');
        if (!tbody) return;
        tbody.innerHTML = '';

        if (availableTools.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" class="text-center">No equipment currently available in storeroom.</td></tr>';
            return;
        }

        availableTools.forEach(tool => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${tool.name}</strong></td>
                <td style="color:var(--text-secondary)">${tool.uid}</td>
                <td>
                    <button class="btn-primary" style="padding: 6px 14px; font-size: 0.9em;" onclick="requestComponent('${tool.uid}')">📩 Request</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        console.error(e);
    }
}

// ==========================================
// REQUEST COMPONENT (TRIGGERS EMAIL)
// ==========================================
async function requestComponent(componentUid) {
    try {
        const res = await fetch(`${baseUrl}/api/requests`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ employeeUid: currentEmployee.uid, componentUid })
        });
        const data = await res.json();
        if (res.ok) {
            showToast('✅ Request sent to Admin! Notification email dispatched.', 'info');
            loadDashboard();
        } else {
            showToast(data.error || 'Failed to submit request', 'alert');
        }
    } catch (e) {
        showToast('Network error while requesting', 'alert');
    }
}

// ==========================================
// MY CHECKED OUT TOOLS
// ==========================================
async function fetchMyCheckedOutTools() {
    try {
        const res = await fetch(`${baseUrl}/api/inventory`);
        const data = await res.json();

        const myTools = data.components.filter(c => c.status === 'OUT' && c.assigned_to === currentEmployee.name);
        myToolsCount = myTools.length;

        const tbody = document.getElementById('my-tools-tbody');
        tbody.innerHTML = '';

        if (myTools.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" class="text-center">You have no tools checked out. All equipment is in the storeroom.</td></tr>';
            return;
        }

        myTools.forEach(tool => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${tool.name}</strong></td>
                <td style="color:var(--text-secondary)">${tool.uid}</td>
                <td><span class="status-badge out">In Field — With You</span></td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        showToast('Error loading your tools', 'alert');
        console.error(e);
    }
}

// ==========================================
// MY REQUEST HISTORY
// ==========================================
async function loadMyRequests() {
    if (!currentEmployee) return;
    const tbody = document.getElementById('my-requests-tbody');
    if (!tbody) return;
    
    try {
        const res = await fetch(`${baseUrl}/api/requests`);
        const data = await res.json();

        // Filter requests for this employee only
        const myReqs = (data.requests || []).filter(r => r.employee_uid === currentEmployee.uid);
        pendingRequestsCount = myReqs.filter(r => r.status === 'pending').length;
        tbody.innerHTML = '';

        if (myReqs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" class="text-center">You have not submitted any requests yet.</td></tr>';
            return;
        }

        myReqs.forEach(req => {
            const tr = document.createElement('tr');
            let badgeClass = 'out';
            let badgeText = 'Pending';
            if (req.status === 'approved') { badgeClass = 'in'; badgeText = 'Approved ✓'; }
            if (req.status === 'rejected') { badgeClass = ''; badgeText = 'Rejected ✗'; }

            tr.innerHTML = `
                <td style="color:var(--text-secondary)">${new Date(req.timestamp).toLocaleString()}</td>
                <td><strong>${req.component_name || req.component_uid}</strong></td>
                <td><span class="status-badge ${badgeClass}">${badgeText}</span></td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-center">Error loading requests.</td></tr>';
        console.error(e);
    }
}

// ==========================================
// TOAST NOTIFICATIONS
// ==========================================
function showToast(message, type) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'alert' ? '⚠️' : 'ℹ️';
    toast.innerHTML = `<span>${icon}</span> <div>${message}</div>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ==========================================
// WEBSOCKET (Live Sync)
// ==========================================
const isPrimaryServer = window.location.hostname === "localhost" && window.location.port === "3000";
const wsUrl = isPrimaryServer ? `ws://${window.location.host}` : "ws://localhost:3000";
const ws = new WebSocket(wsUrl);

ws.onopen = () => {
    const dot = document.getElementById('ws-dot');
    const statusText = document.getElementById('ws-status');
    const infoText = document.getElementById('ws-info-text');
    if (dot) dot.classList.add('active');
    if (statusText) statusText.innerText = 'Connected Live';
    if (infoText) { infoText.innerText = 'Connected'; infoText.style.color = 'var(--success)'; }
};

ws.onclose = () => {
    const dot = document.getElementById('ws-dot');
    const statusText = document.getElementById('ws-status');
    const infoText = document.getElementById('ws-info-text');
    if (dot) dot.classList.remove('active');
    if (statusText) statusText.innerText = 'Disconnected';
    if (infoText) { infoText.innerText = 'Offline'; infoText.style.color = 'var(--danger)'; }
};

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'request_update' || data.type === 'inventory_update' || data.type === 'new_request') {
        if (currentEmployee) loadDashboard();
    }
};

// ==========================================
// TAB SWITCHING (Enterprise Layout)
// ==========================================
function switchTab(tabName, el) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('nav a').forEach(a => a.classList.remove('active'));

    const tabEl = document.getElementById(`tab-${tabName}`);
    if (tabEl) tabEl.classList.add('active');
    if (el) el.classList.add('active');

    const titleMap = {
        overview: 'Employee Overview',
        mytools: 'My Assigned Equipment',
        browse: 'Storeroom Requisition',
        myrequests: 'My Request History'
    };
    
    const commandTitle = document.getElementById('command-tab-title');
    if (commandTitle) {
        commandTitle.innerText = titleMap[tabName] || 'Employee Console';
    }
}
