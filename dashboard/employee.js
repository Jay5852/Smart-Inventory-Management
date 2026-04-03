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
    await fetchMyCheckedOutTools();
}

async function fetchMyCheckedOutTools() {
    try {
        const res = await fetch(`${baseUrl}/api/inventory`);
        const data = await res.json();

        // Filter inventory for items currently checked out to this employee
        const myTools = data.components.filter(c => c.status === 'OUT' && c.assigned_to === currentEmployee.name);

        const tbody = document.getElementById('my-tools-tbody');
        tbody.innerHTML = '';

        if (myTools.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" class="text-center">You have no tools checked out.</td></tr>';
            return;
        }

        myTools.forEach(tool => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${tool.name}</strong></td>
                <td style="color:var(--text-secondary)">${tool.uid}</td>
                <td><span class="status-badge out">Currently WITH YOU</span></td>
            `;
            tbody.appendChild(tr);
        });

    } catch (e) {
        showToast('Error loading your tools', 'alert');
        console.error(e);
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
