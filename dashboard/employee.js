let currentEmployee = null;
const baseUrl = window.location.host === "" ? "http://localhost:3000" : "";

document.addEventListener("DOMContentLoaded", () => {
    fetchEmployees();
});

async function fetchEmployees() {
    try {
        const res = await fetch(`${baseUrl}/api/employees`);
        const data = await res.json();
        const select = document.getElementById('emp-select');
        select.innerHTML = '<option value="">-- Select your name --</option>';
        data.employees.forEach(emp => {
            const opt = document.createElement('option');
            opt.value = emp.uid;
            opt.innerText = emp.name;
            select.appendChild(opt);
        });
    } catch (e) {
        showToast('Error loading employees', 'alert');
    }
}

function login() {
    const select = document.getElementById('emp-select');
    if (!select.value) {
        showToast('Please select your name', 'alert');
        return;
    }

    currentEmployee = {
        uid: select.value,
        name: select.options[select.selectedIndex].text
    };

    document.getElementById('login-view').classList.add('hidden');
    document.getElementById('portal-view').classList.remove('hidden');
    document.getElementById('emp-name-display').innerText = currentEmployee.name;

    loadDashboard();
}

function logout() {
    currentEmployee = null;
    document.getElementById('login-view').classList.remove('hidden');
    document.getElementById('portal-view').classList.add('hidden');
}

async function loadDashboard() {
    await fetchEquipment();
    await fetchMyRequests();
}

async function fetchEquipment() {
    try {
        const res = await fetch(`${baseUrl}/api/inventory`);
        const data = await res.json();
        const grid = document.getElementById('equipment-grid');
        grid.innerHTML = '';

        data.components.forEach(comp => {
            const isAvailable = comp.status === 'IN';
            const statusClass = isAvailable ? 'status-in' : 'status-out';

            let actionHtml = '';
            if (isAvailable && comp.approved_for_uid !== currentEmployee.uid) {
                actionHtml = `<button class="btn-primary request-btn" onclick="requestItem('${comp.uid}')">Request Item</button>`;
            } else if (comp.approved_for_uid === currentEmployee.uid) {
                actionHtml = `<button class="btn-secondary request-btn" disabled>✅ Approved (Scan at Gate)</button>`;
            } else {
                actionHtml = `<button class="btn-secondary request-btn" disabled>Currently Out</button>`;
            }

            const card = document.createElement('div');
            card.className = 'comp-card';
            card.innerHTML = `
                <h3>${comp.name}</h3>
                <p style="color:var(--text-secondary); font-size: 0.85rem;">ID: ${comp.uid}</p>
                <p style="margin-top:10px; font-weight: 500;" class="${statusClass}">Status: ${comp.status}</p>
                ${actionHtml}
            `;
            grid.appendChild(card);
        });
    } catch (e) {
        showToast('Error loading equipment', 'alert');
    }
}

async function fetchMyRequests() {
    try {
        const res = await fetch(`${baseUrl}/api/requests`);
        const data = await res.json();

        // Filter only requests for this employee that are pending
        const myPending = data.requests.filter(r => r.employee_uid === currentEmployee.uid && r.status === 'pending');

        const tbody = document.getElementById('my-requests-tbody');
        tbody.innerHTML = '';

        if (myPending.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" class="text-center">No pending requests</td></tr>';
            return;
        }

        myPending.forEach(r => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${r.component_name}</strong></td>
                <td><span class="status-badge out">Pending Admin Approval</span></td>
                <td style="color:var(--text-secondary)">${new Date(r.timestamp).toLocaleString()}</td>
            `;
            tbody.appendChild(tr);
        });

    } catch (e) {
        console.error(e);
    }
}

async function requestItem(componentUid) {
    try {
        const res = await fetch(`${baseUrl}/api/requests`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ employeeUid: currentEmployee.uid, componentUid })
        });
        const data = await res.json();

        if (res.ok) {
            showToast('Request sent to Admin!', 'info');
            loadDashboard(); // Refresh
        } else {
            showToast(data.error || 'Failed to request', 'alert');
        }
    } catch (e) {
        showToast('Error sending request', 'alert');
    }
}

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

// Websocket to auto-refresh when admin approves
const wsUrl = window.location.host === "" ? "ws://localhost:3000" : `ws://${window.location.host}`;
const ws = new WebSocket(wsUrl);
ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'request_update' || data.type === 'inventory_update') {
        if (currentEmployee) loadDashboard();
    }
};
