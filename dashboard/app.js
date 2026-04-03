// ==========================================
// STATE
// ==========================================
let miniMap, fullMap, historyMap;
let miniMarker, fullMarker, playbackMarker;
let miniWorkZone, fullWorkZone, historyWorkZone;
let locationTrail = []; // Array of [lat, lng] for breadcrumbs
let trailPolyline = null;
let fullTrailPolyline = null;
let historyPolyline = null;
let playbackInterval = null;
let geofenceViolationActive = false;
const baseUrl = (window.location.hostname === "localhost" && window.location.port === "3000") ? "" : "http://localhost:3000";
let commandInterval;

const UI_TABLE_MESSAGES = {
    inventoryEmpty: 'No assets found. Add a component to get started.',
    inventoryError: 'Unable to load inventory right now.',
    transactionsEmpty: 'No transactions yet.',
    transactionsError: 'Unable to load transactions right now.',
    logsEmpty: 'No logs found for selected filters.',
    logsError: 'Unable to load transaction logs right now.'
};

function setTableLoading(tbodyId, cols = 4) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    tbody.innerHTML = `<tr class="table-loading-row"><td colspan="${cols}"><div class="table-loading">Loading data...</div></td></tr>`;
}

function setTableEmpty(tbodyId, message, cols = 4) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="${cols}" class="text-center empty-cell">${message}</td></tr>`;
}

function setFeedLoading() {
    const feed = document.getElementById('activity-feed');
    if (!feed) return;
    feed.innerHTML = '<li class="empty-state loading-state">Loading latest RFID activity...</li>';
}

// ==========================================
// INIT
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
    setFeedLoading();
    setTableLoading('inventory-tbody', 6);
    setTableLoading('transactions-tbody', 4);
    setTableLoading('logs-tbody', 4);

    initMaps();
    fetchInventory();
    fetchTransactions();
    loadLogsData(); // Init Full Logs tab
    connectWebSocket();
    loadWifiProfiles();

    // Default history date to today
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('history-date').value = today;

    // Load employees into filter dropdown
    fetchEmployeesForFilter();
    fetchStaff(); // Init Staff Management tab

    const commandTitle = document.getElementById('command-tab-title');
    if (commandTitle) commandTitle.innerText = 'Admin Overview';
});

async function fetchEmployeesForFilter() {
    try {
        const res = await fetch(`${baseUrl}/api/employees`);
        const data = await res.json();
        const select = document.getElementById('log-filter-emp');
        data.employees.forEach(emp => {
            const opt = document.createElement('option');
            opt.value = emp.uid;
            opt.innerText = emp.name;
            select.appendChild(opt);
        });
    } catch (e) { }
}

// ==========================================
// MAP SETUP
// ==========================================
function createCustomIcon(color = '#3b82f6') {
    return L.divIcon({
        className: 'custom-div-icon',
        html: `<div style="background-color:${color};width:16px;height:16px;border-radius:50%;box-shadow:0 0 10px ${color},0 0 0 4px ${color}44;"></div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10]
    });
}

function createWorkZone(map, center, radius) {
    return L.circle(center, {
        color: '#10b981',
        fillColor: '#10b981',
        fillOpacity: 0.08,
        weight: 2,
        dashArray: '8 4',
        radius: radius
    }).addTo(map).bindPopup('Authorized Work Zone');
}

function setupMap(elementId) {
    const defaultCenter = [18.5204, 73.8567];
    const m = L.map(elementId).setView(defaultCenter, 14);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO'
    }).addTo(m);
    return m;
}

function initMaps() {
    const defaultCenter = [18.5204, 73.8567];

    // Mini Map (Overview Tab)
    miniMap = setupMap('mini-map');
    miniMarker = L.marker(defaultCenter, { icon: createCustomIcon() }).addTo(miniMap)
        .bindPopup("Tracking: Cisco Router<br>Waiting for GPS...");
    miniWorkZone = createWorkZone(miniMap, defaultCenter, 500);

    // Full Map (Live Tracking Tab)
    fullMap = setupMap('full-map');
    fullMarker = L.marker(defaultCenter, { icon: createCustomIcon() }).addTo(fullMap)
        .bindPopup("Tracking: Cisco Router<br>Waiting for GPS...");
    fullWorkZone = createWorkZone(fullMap, defaultCenter, 500);

    // History Map (History Tab)
    historyMap = setupMap('history-map');
    historyWorkZone = createWorkZone(historyMap, defaultCenter, 500);

    // Map Click Listener for Geofence Selection
    fullMap.on('click', function (e) {
        if (!isSelectingOnMap) return;

        // Update input fields
        document.getElementById('geo-lat').value = e.latlng.lat.toFixed(5);
        document.getElementById('geo-lng').value = e.latlng.lng.toFixed(5);

        // Preview the new circle location before saving
        fullWorkZone.setLatLng(e.latlng);
        fullMap.panTo(e.latlng);

        // Turn off selection mode
        toggleMapSelection();
        showToast('📍 Location selected! Click "Update Work Zone" to save it.', 'info');
    });

    // Fix map rendering when tab becomes visible
    setTimeout(() => {
        miniMap.invalidateSize();
        fullMap.invalidateSize();
        historyMap.invalidateSize();
    }, 200);
}

// ==========================================
// WEBSOCKET
// ==========================================
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const isPrimaryServer = window.location.hostname === "localhost" && window.location.port === "3000";
    const wsUrl = isPrimaryServer ? `${protocol}//${window.location.host}` : "ws://localhost:3000";
    const ws = new WebSocket(wsUrl);

    const statusDot = document.querySelector('.status-indicator .dot');
    const statusText = document.getElementById('server-status');
    const commandLive = document.getElementById('command-live-state');

    ws.onopen = () => {
        statusDot.classList.add('active');
        statusText.innerText = 'Connected Live';
        if (commandLive) commandLive.innerText = 'Live sync connected';
        showToast('Connected to Server', 'info');
    };

    ws.onclose = () => {
        statusDot.classList.remove('active');
        statusText.innerText = 'Reconnecting...';
        if (commandLive) commandLive.innerText = 'Reconnecting to live stream...';
        setTimeout(connectWebSocket, 3000);
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === 'inventory_update') {
            logActivity(data);
            refreshLiveAdminData();
        }
        else if (data.type === 'gps_update') {
            updateLiveLocation(data);
        }
        else if (data.type === 'geofence_config') {
            updateGeofenceUI(data);
        }
        else if (data.type === 'wifi_config_updated') {
            loadWifiProfiles();
            showToast(`WiFi profiles updated (${data.count || 0}).`, 'info');
        }
        else if (data.type === 'new_request' || data.type === 'request_update') {
            loadRequestsDataSafely();
            if (data.type === 'new_request') showToast('New equipment checkout request received!', 'alert');
        }
    };
}

async function refreshLiveAdminData() {
    await Promise.all([
        fetchInventory(),
        fetchTransactions(),
        fetchStaff(),
        fetchEmployeesForFilter(),
        loadRequestsDataSafely()
    ]);
}

async function loadRequestsDataSafely() {
    const approvalsTbody = document.getElementById('approvals-tbody');
    const historyTbody = document.getElementById('approvals-history-tbody');
    const approvalBadge = document.getElementById('approval-badge');

    if (!approvalsTbody || !historyTbody || !approvalBadge) {
        return;
    }

    await loadRequestsData();
}

// ==========================================
// LIVE GPS TRACKING (Phase 2 Core)
// ==========================================
function updateLiveLocation(data) {
    const { lat, lng, distanceFromZone, isOutsideGeofence, timestamp } = data;
    const newLatLng = [lat, lng];

    // Update markers on both maps
    miniMarker.setLatLng(newLatLng);
    fullMarker.setLatLng(newLatLng);
    miniMap.panTo(newLatLng);
    fullMap.panTo(newLatLng);

    // Update popups
    const popupContent = `Tracking: Cisco Router<br>Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}<br>Distance: ${distanceFromZone}m from zone`;
    miniMarker.setPopupContent(popupContent);
    fullMarker.setPopupContent(popupContent);

    // ---- BREADCRUMB TRAIL ----
    locationTrail.push(newLatLng);

    // Draw trail on mini map
    if (trailPolyline) miniMap.removeLayer(trailPolyline);
    trailPolyline = L.polyline(locationTrail, {
        color: '#3b82f6',
        weight: 3,
        opacity: 0.7,
        dashArray: '6 4'
    }).addTo(miniMap);

    // Draw trail on full map
    if (fullTrailPolyline) fullMap.removeLayer(fullTrailPolyline);
    fullTrailPolyline = L.polyline(locationTrail, {
        color: '#3b82f6',
        weight: 3,
        opacity: 0.7,
        dashArray: '6 4'
    }).addTo(fullMap);

    // Add breadcrumb dot on full map
    L.circleMarker(newLatLng, {
        radius: 3,
        fillColor: '#3b82f6',
        color: '#3b82f6',
        fillOpacity: 0.5
    }).addTo(fullMap);

    // ---- GEOFENCE CHECK ----
    if (isOutsideGeofence) {
        // Turn work zones red
        miniWorkZone.setStyle({ color: '#ef4444', fillColor: '#ef4444' });
        fullWorkZone.setStyle({ color: '#ef4444', fillColor: '#ef4444' });

        // Show alert banner
        const banner = document.getElementById('geofence-alert-banner');
        banner.classList.remove('hidden');
        document.getElementById('geofence-alert-text').innerText =
            `Component is ${distanceFromZone}m away from the authorized zone!`;

        if (!geofenceViolationActive) {
            showToast(`⚠️ ALERT: Component is ${distanceFromZone}m outside the work zone!`, 'alert');
            geofenceViolationActive = true;
        }
    } else {
        miniWorkZone.setStyle({ color: '#10b981', fillColor: '#10b981' });
        fullWorkZone.setStyle({ color: '#10b981', fillColor: '#10b981' });
        document.getElementById('geofence-alert-banner').classList.add('hidden');
        geofenceViolationActive = false;
    }

    // ---- UPDATE INFO BAR ----
    document.getElementById('track-distance').innerText = `${distanceFromZone} m`;
    document.getElementById('track-distance').style.color = isOutsideGeofence ? '#ef4444' : '#10b981';
    document.getElementById('track-last-update').innerText = new Date(timestamp).toLocaleTimeString();
    document.getElementById('track-coords').innerText = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    document.getElementById('track-status').innerText = isOutsideGeofence ? '🔴 OUTSIDE ZONE' : '🟢 Inside Zone';

    // Update overview stat
    const distText = distanceFromZone >= 1000 ? `${(distanceFromZone / 1000).toFixed(1)} km` : `${distanceFromZone} m`;
    document.getElementById('stat-distance').innerText = distText;
    document.getElementById('stat-distance').style.color = isOutsideGeofence ? '#ef4444' : '#10b981';
}

// ==========================================
// GEOFENCE CONTROLS & MAP SELECTION
// ==========================================
let isSelectingOnMap = false;

function toggleMapSelection() {
    isSelectingOnMap = !isSelectingOnMap;
    const btn = document.getElementById('btn-select-map');

    if (isSelectingOnMap) {
        btn.classList.add('active-state');
        btn.innerHTML = '❌ Cancel Selection';
        document.getElementById('full-map').style.cursor = 'crosshair';
        showToast('Click anywhere on the map to set the new Work Zone center', 'info');
    } else {
        btn.classList.remove('active-state');
        btn.innerHTML = '📍 Select on Map';
        document.getElementById('full-map').style.cursor = '';
    }
}

// ==========================================
// LOCATION SEARCH (Geocoding)
// ==========================================
async function searchLocation() {
    const query = document.getElementById('geo-search').value;
    if (!query) return;

    showToast('Searching...', 'info');
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
        const data = await res.json();

        if (data.length > 0) {
            const lat = parseFloat(data[0].lat);
            const lng = parseFloat(data[0].lon);

            document.getElementById('geo-lat').value = lat.toFixed(5);
            document.getElementById('geo-lng').value = lng.toFixed(5);

            fullWorkZone.setLatLng([lat, lng]);
            fullMap.panTo([lat, lng]);

            showToast(`Found: ${data[0].display_name.split(',')[0]}`, 'info');
        } else {
            showToast('Location not found', 'alert');
        }
    } catch (e) {
        showToast('Error searching location', 'alert');
    }
}

function updateGeofenceUI(config) {
    document.getElementById('geo-lat').value = config.lat;
    document.getElementById('geo-lng').value = config.lng;
    document.getElementById('geo-radius').value = config.radius;

    const center = [config.lat, config.lng];
    miniWorkZone.setLatLng(center).setRadius(config.radius);
    fullWorkZone.setLatLng(center).setRadius(config.radius);
    historyWorkZone.setLatLng(center).setRadius(config.radius);
}

async function updateGeofence() {
    const lat = parseFloat(document.getElementById('geo-lat').value);
    const lng = parseFloat(document.getElementById('geo-lng').value);
    const radius = parseInt(document.getElementById('geo-radius').value);

    try {
        const res = await fetch(`${baseUrl}/api/geofence`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat, lng, radius })
        });
        const data = await res.json();
        showToast(`Work zone updated: ${radius}m radius`, 'info');
    } catch (e) {
        showToast('Failed to update geofence', 'alert');
    }
}

// ==========================================
// HISTORY & PLAYBACK
// ==========================================
let historyData = [];

async function loadHistory() {
    const date = document.getElementById('history-date').value;
    if (!date) {
        showToast('Please select a date', 'alert');
        return;
    }

    try {
        const res = await fetch(`${baseUrl}/api/tracking/history?trackerId=COMP-SPLICER-001&date=${date}`);
        const data = await res.json();
        historyData = data.locations;

        if (historyData.length === 0) {
            showToast('No GPS data found for this date', 'alert');
            return;
        }

        // Clear old trail
        if (historyPolyline) historyMap.removeLayer(historyPolyline);
        historyMap.eachLayer(layer => {
            if (layer instanceof L.CircleMarker || (layer instanceof L.Marker && layer !== historyWorkZone)) {
                historyMap.removeLayer(layer);
            }
        });

        // Draw complete trail
        const points = historyData.map(p => [p.lat, p.lng]);
        historyPolyline = L.polyline(points, {
            color: '#8b5cf6',
            weight: 3,
            opacity: 0.8
        }).addTo(historyMap);

        // Add start and end markers
        const startIcon = createCustomIcon('#10b981'); // Green = Start
        const endIcon = createCustomIcon('#ef4444'); // Red = End

        L.marker(points[0], { icon: startIcon }).addTo(historyMap).bindPopup('Start: ' + historyData[0].timestamp);
        L.marker(points[points.length - 1], { icon: endIcon }).addTo(historyMap).bindPopup('End: ' + historyData[historyData.length - 1].timestamp);

        // Add intermediate dots
        points.forEach((p, i) => {
            if (i > 0 && i < points.length - 1) {
                L.circleMarker(p, {
                    radius: 2,
                    fillColor: '#8b5cf6',
                    color: '#8b5cf6',
                    fillOpacity: 0.6
                }).addTo(historyMap);
            }
        });

        // Fit map to trail
        historyMap.fitBounds(historyPolyline.getBounds().pad(0.2));

        showToast(`Loaded ${historyData.length} GPS points for ${date}`, 'info');

        // Load analytics
        loadAnalytics();

    } catch (e) {
        console.error(e);
        showToast('Error loading history', 'alert');
    }
}

// Playback animation
function playbackTrail() {
    if (historyData.length === 0) {
        showToast('Load a trail first', 'alert');
        return;
    }

    stopPlayback();

    // Create playback marker
    playbackMarker = L.marker([historyData[0].lat, historyData[0].lng], {
        icon: createCustomIcon('#f59e0b')
    }).addTo(historyMap).bindPopup('Playback');

    let index = 0;
    playbackInterval = setInterval(() => {
        if (index >= historyData.length) {
            stopPlayback();
            showToast('Playback complete', 'info');
            return;
        }

        const point = historyData[index];
        playbackMarker.setLatLng([point.lat, point.lng]);
        playbackMarker.setPopupContent(`Time: ${new Date(point.timestamp).toLocaleTimeString()}<br>Point ${index + 1}/${historyData.length}`);
        historyMap.panTo([point.lat, point.lng]);
        index++;
    }, 500); // Move every 500ms

    showToast('▶ Playback started', 'info');
}

function stopPlayback() {
    if (playbackInterval) {
        clearInterval(playbackInterval);
        playbackInterval = null;
    }
    if (playbackMarker) {
        historyMap.removeLayer(playbackMarker);
        playbackMarker = null;
    }
}

// ==========================================
// LOCATION ANALYTICS
// ==========================================
async function loadAnalytics() {
    try {
        const res = await fetch(`${baseUrl}/api/tracking/analytics?trackerId=COMP-SPLICER-001`);
        const data = await res.json();
        const tbody = document.getElementById('analytics-tbody');
        tbody.innerHTML = '';

        if (data.analytics.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center">No location data yet</td></tr>';
            return;
        }

        data.analytics.forEach((loc, i) => {
            const tr = document.createElement('tr');
            const statusBadge = loc.isAuthorized ?
                '<span class="status-badge in">Authorized</span>' :
                '<span class="status-badge out">Unauthorized</span>';
            const durationText = loc.duration < 1 ? '< 1 min' : `${loc.duration} min`;
            const distText = loc.distanceFromZone >= 1000 ?
                `${(loc.distanceFromZone / 1000).toFixed(1)} km` : `${loc.distanceFromZone} m`;

            tr.innerHTML = `
                <td>Location ${i + 1} <span style="color:var(--text-secondary)">(${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)})</span></td>
                <td><strong>${durationText}</strong> (${loc.readings} readings)</td>
                <td>${distText}</td>
                <td>${statusBadge}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        console.error(e);
    }
}

// ==========================================
// INVENTORY & TRANSACTIONS
// ==========================================
async function fetchInventory() {
    setTableLoading('inventory-tbody', 6);
    try {
        const response = await fetch(`${baseUrl}/api/inventory`);
        const data = await response.json();

        let total = data.components.length;
        let outCount = 0, inCount = 0;
        const tbody = document.getElementById('inventory-tbody');
        tbody.innerHTML = '';

        if (data.components.length === 0) {
            setTableEmpty('inventory-tbody', UI_TABLE_MESSAGES.inventoryEmpty, 6);
            document.getElementById('stat-total').innerText = 0;
            document.getElementById('stat-out').innerText = 0;
            document.getElementById('stat-in').innerText = 0;
            return;
        }

        data.components.forEach(comp => {
            if (comp.status === 'OUT') outCount++;
            else inCount++;
            const badgeClass = comp.status === 'IN' ? 'in' : 'out';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${comp.name}</strong></td>
                <td style="color:var(--text-secondary)">${comp.uid}</td>
                <td style="color:var(--text-secondary)">${comp.tracker_id || 'N/A'}</td>
                <td><span class="status-badge ${badgeClass}">${comp.status}</span></td>
                <td>${comp.assigned_to || '-'}</td>
                <td>
                    <button class="btn-secondary" style="background:var(--danger); color:white; border:none; padding:4px 8px;" onclick="deleteComponent('${comp.uid}')">🗑️</button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        document.getElementById('stat-total').innerText = total;
        document.getElementById('stat-out').innerText = outCount;
        document.getElementById('stat-in').innerText = inCount;
        
        // Calculate Anomalies (Mock for Project Demonstration: 1 anomaly if any items out)
        const anomaliesEl = document.getElementById('stat-anomalies');
        if (anomaliesEl) anomaliesEl.innerText = outCount > 0 ? 1 : 0;
    } catch (e) {
        console.error("Error fetching inventory", e);
        setTableEmpty('inventory-tbody', UI_TABLE_MESSAGES.inventoryError, 6);
    }
}

async function addComponent() {
    const name = document.getElementById('add-comp-name').value;
    const uid = document.getElementById('add-comp-uid').value;
    const tracker = document.getElementById('add-comp-tracker').value;

    if (!name || !uid) { showToast('Name and UID are required!', 'alert'); return; }

    try {
        const res = await fetch(`${baseUrl}/api/components`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid, name, tracker_id: tracker })
        });
        if (res.ok) {
            showToast('Component Registered!', 'info');
            document.getElementById('add-comp-name').value = '';
            document.getElementById('add-comp-uid').value = '';
            document.getElementById('add-comp-tracker').value = '';
            fetchInventory();
        } else {
            showToast('Failed to register component', 'alert');
        }
    } catch (e) { console.error(e); }
}

async function deleteComponent(uid) {
    if (!confirm(`Are you sure you want to delete component ${uid}?`)) return;
    try {
        await fetch(`${baseUrl}/api/components/${uid}`, { method: 'DELETE' });
        showToast('Component Deleted', 'info');
        fetchInventory();
    } catch (e) { console.error(e); }
}

// ==========================================
// STAFF MANAGEMENT
// ==========================================
async function fetchStaff() {
    try {
        const res = await fetch(`${baseUrl}/api/employees`);
        const data = await res.json();
        const tbody = document.getElementById('staff-tbody');
        tbody.innerHTML = '';

        if (data.employees.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" class="text-center">No staff found</td></tr>';
            return;
        }

        data.employees.forEach(emp => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${emp.name}</strong></td>
                <td style="color:var(--text-secondary)">${emp.uid}</td>
                <td>
                    <button class="btn-secondary" style="background:var(--danger); color:white; border:none; padding:4px 8px;" onclick="deleteEmployee('${emp.uid}')">🗑️</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        console.error("Error fetching staff", e);
    }
}

async function addEmployee() {
    const name = document.getElementById('add-emp-name').value;
    const uid = document.getElementById('add-emp-uid').value;

    if (!name || !uid) { showToast('Name and UID are required!', 'alert'); return; }

    try {
        const res = await fetch(`${baseUrl}/api/employees`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid, name })
        });
        if (res.ok) {
            showToast('Employee Registered!', 'info');
            document.getElementById('add-emp-name').value = '';
            document.getElementById('add-emp-uid').value = '';
            fetchStaff();
            fetchEmployeesForFilter(); // Update dropdowns
        } else {
            showToast('Failed to register employee', 'alert');
        }
    } catch (e) { console.error(e); }
}

async function deleteEmployee(uid) {
    if (!confirm(`Are you sure you want to delete employee ${uid}?`)) return;
    try {
        await fetch(`${baseUrl}/api/employees/${uid}`, { method: 'DELETE' });
        showToast('Employee Deleted', 'info');
        fetchStaff();
        fetchEmployeesForFilter();
    } catch (e) { console.error(e); }
}

async function fetchTransactions() {
    setTableLoading('transactions-tbody', 4);
    try {
        const res = await fetch(`${baseUrl}/api/transactions`);
        const data = await res.json();
        const tbody = document.getElementById('transactions-tbody');
        tbody.innerHTML = '';

        if (data.transactions.length === 0) {
            setTableEmpty('transactions-tbody', UI_TABLE_MESSAGES.transactionsEmpty, 4);
            return;
        }

        data.transactions.forEach(t => {
            const tr = document.createElement('tr');
            const badgeClass = t.action === 'OUT' ? 'out' : 'in';
            tr.innerHTML = `
                <td>${t.component_name || t.component_uid}</td>
                <td>${t.employee_name || t.employee_uid}</td>
                <td><span class="status-badge ${badgeClass}">${t.action}</span></td>
                <td style="color:var(--text-secondary)">${new Date(t.timestamp).toLocaleString()}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        console.error("Error fetching transactions", e);
        setTableEmpty('transactions-tbody', UI_TABLE_MESSAGES.transactionsError, 4);
    }
}

// ==========================================
// ACTIVITY FEED
// ==========================================
function logActivity(data) {
    const list = document.getElementById('activity-feed');
    const emptyState = list.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    const li = document.createElement('li');
    const isCheckOut = data.action === 'OUT';
    const isCheckIn = data.action === 'IN';
    const isAdminUpdate = !isCheckOut && !isCheckIn;
    const iconClass = isCheckOut ? 'out' : (isCheckIn ? 'in' : 'info');
    const iconSvg = isCheckOut ?
        `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>` :
        (isCheckIn ?
            `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>` :
            `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`);
    const time = new Date().toLocaleTimeString();

    let headline = '';
    let subtitle = '';

    if (isCheckOut || isCheckIn) {
        headline = `${data.employee || 'User'} Checked <strong>${data.action}</strong>`;
        subtitle = `${data.component || 'Component'} • ${time}`;
    } else if (data.action === 'component_added') {
        headline = `Component added`;
        subtitle = `${data.component || data.componentUid || 'Unknown component'} • ${time}`;
    } else if (data.action === 'component_deleted') {
        headline = `Component removed`;
        subtitle = `${data.componentUid || 'Unknown component'} • ${time}`;
    } else if (data.action === 'employee_added') {
        headline = `Employee added`;
        subtitle = `${data.employee || data.employeeUid || 'Unknown employee'} • ${time}`;
    } else if (data.action === 'employee_deleted') {
        headline = `Employee removed`;
        subtitle = `${data.employeeUid || 'Unknown employee'} • ${time}`;
    } else {
        headline = `Dashboard updated`;
        subtitle = `${time}`;
    }

    li.innerHTML = `
        <div class="feed-icon ${iconClass}">${iconSvg}</div>
        <div class="feed-details">
            <h4>${headline}</h4>
            <p>${subtitle}</p>
        </div>
    `;
    list.insertBefore(li, list.firstChild);

    if (isCheckOut) {
        showToast(`${data.employee} took ${data.component} to the field.`, 'info');
    } else if (isCheckIn) {
        showToast(`${data.employee} returned ${data.component}.`, 'info');
    } else if (isAdminUpdate) {
        showToast('Admin updated inventory.', 'info');
    }
}

// ==========================================
// ADMIN APPROVAL SYSTEM
// ==========================================
async function loadRequestsData() {
    try {
        const res = await fetch(`${baseUrl}/api/requests`);
        const data = await res.json();

        const pendingTbody = document.getElementById('approvals-tbody');
        const historyTbody = document.getElementById('approvals-history-tbody');
        pendingTbody.innerHTML = '';
        historyTbody.innerHTML = '';

        const pending = data.requests.filter(r => r.status === 'pending');
        const history = data.requests.filter(r => r.status !== 'pending');

        // Update notification badge
        const badge = document.getElementById('approval-badge');
        if (pending.length > 0) {
            badge.style.display = 'inline-block';
            badge.innerText = pending.length;
        } else {
            badge.style.display = 'none';
        }

        // Render Pending
        if (pending.length === 0) {
            pendingTbody.innerHTML = '<tr><td colspan="4" class="text-center">No pending requests</td></tr>';
        } else {
            pending.forEach(req => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${req.employee_name}</strong><br><small style="color:var(--text-secondary)">UID: ${req.employee_uid}</small></td>
                    <td><strong>${req.component_name}</strong><br><small style="color:var(--text-secondary)">ID: ${req.component_uid}</small></td>
                    <td>${new Date(req.timestamp).toLocaleString()}</td>
                    <td style="display:flex; gap:8px;">
                        <button class="btn-primary" style="padding:6px 12px; font-size:0.85rem;" onclick="handleRequest(${req.id}, 'approve')">✅ Approve</button>
                        <button class="btn-secondary" style="padding:6px 12px; font-size:0.85rem;" onclick="handleRequest(${req.id}, 'reject')">❌ Reject</button>
                    </td>
                `;
                pendingTbody.appendChild(tr);
            });
        }

        // Render History
        if (history.length === 0) {
            historyTbody.innerHTML = '<tr><td colspan="3" class="text-center">No history</td></tr>';
        } else {
            history.forEach(req => {
                const statusColor = req.status === 'approved' ? 'success' : 'danger';
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${req.employee_name}</td>
                    <td>${req.component_name}</td>
                    <td><span class="status-badge" style="background:var(--${statusColor}); color:white;">${req.status.toUpperCase()}</span></td>
                `;
                historyTbody.appendChild(tr);
            });
        }
    } catch (e) {
        console.error("Error loading requests", e);
    }
}

async function handleRequest(reqId, action) {
    try {
        const res = await fetch(`${baseUrl}/api/requests/${reqId}/${action}`, { method: 'POST' });
        const data = await res.json();

        if (res.ok) {
            showToast(`Request ${action}d successfully.`, 'info');
            loadRequestsData(); // Refresh list
        } else {
            showToast(data.error || 'Operation failed', 'alert');
        }
    } catch (e) {
        showToast('Network error', 'alert');
    }
}

// ==========================================
// TRANSACTION LOGS PAGE
// ==========================================
async function loadLogsData() {
    setTableLoading('logs-tbody', 4);
    try {
        const dateFilter = document.getElementById('log-filter-date').value;
        const empFilter = document.getElementById('log-filter-emp').value;

        // Build query URL
        let url = `${baseUrl}/api/transactions?`;
        if (dateFilter) url += `date=${dateFilter}&`;
        if (empFilter) url += `employeeUid=${empFilter}`;

        const res = await fetch(url);
        const data = await res.json();

        const tbody = document.getElementById('logs-tbody');
        tbody.innerHTML = '';

        if (data.transactions.length === 0) {
            setTableEmpty('logs-tbody', UI_TABLE_MESSAGES.logsEmpty, 4);
            return;
        }

        data.transactions.forEach(t => {
            const tr = document.createElement('tr');
            const badgeClass = t.action === 'OUT' ? 'out' : 'in';
            tr.innerHTML = `
                <td style="color:var(--text-secondary)">${new Date(t.timestamp).toLocaleString()}</td>
                <td><span class="status-badge ${badgeClass}">${t.action}</span></td>
                <td><strong>${t.component_name || t.component_uid}</strong></td>
                <td>${t.employee_name || t.employee_uid}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        console.error("Error loading full logs", e);
        setTableEmpty('logs-tbody', UI_TABLE_MESSAGES.logsError, 4);
    }
}

function clearLogFilters() {
    document.getElementById('log-filter-date').value = '';
    document.getElementById('log-filter-emp').value = '';
    loadLogsData();
}

// ==========================================
// TAB SWITCHING
// ==========================================
function switchTab(tabName, el) {
    // Hide all tab content
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('nav a').forEach(a => a.classList.remove('active'));

    // Show selected tab
    document.getElementById(`tab-${tabName}`).classList.add('active');
    if (el) el.classList.add('active');

    const titleMap = {
        overview: 'Admin Overview',
        tracking: 'Live GPS Tracking',
        history: 'History & Playback',
        logs: 'Transaction Logs',
        inventory: 'Inventory Control',
        staff: 'Staff Management',
        network: 'Network Settings'
    };
    const commandTitle = document.getElementById('command-tab-title');
    if (commandTitle) {
        commandTitle.innerText = titleMap[tabName] || 'Operations Console';
    }

    // Fix Leaflet map rendering for newly visible tabs
    setTimeout(() => {
        if (tabName === 'overview') miniMap.invalidateSize();
        if (tabName === 'tracking') fullMap.invalidateSize();
        if (tabName === 'history') historyMap.invalidateSize();
    }, 100);
}

// ==========================================
// TOASTS & AUTH
// ==========================================
function showToast(message, type) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const iconMap = { alert: '⚠️', info: 'ℹ️', success: '✅' };
    const icon = iconMap[type] || 'ℹ️';
    toast.innerHTML = `
        <span class="toast-icon">${icon}</span>
        <div class="toast-content">${message}</div>
        <button class="toast-close" aria-label="Close notification">✕</button>
    `;
    container.appendChild(toast);

    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', () => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 220);
    });

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ==========================================
// NETWORK SETTINGS (OTA WiFi Provisioning)
// ==========================================
async function saveWifiConfig() {
    const rows = Array.from(document.querySelectorAll('.wifi-profile-row'));
    const profiles = rows.map(row => ({
        ssid: row.querySelector('.wifi-ssid').value.trim(),
        password: row.querySelector('.wifi-password').value
    })).filter(profile => profile.ssid.length > 0);

    if (profiles.length === 0) {
        showToast('Please enter at least one WiFi SSID', 'alert');
        return;
    }

    try {
        const res = await fetch(`${baseUrl}/api/wifi-config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profiles })
        });

        const responseText = await res.text();
        let data = {};
        try {
            data = responseText ? JSON.parse(responseText) : {};
        } catch (parseError) {
            data = { error: responseText };
        }

        if (res.ok) {
            showToast(`Saved ${profiles.length} WiFi profile(s). Devices will fetch on next sync.`, 'info');
            await loadWifiProfiles();
        } else {
            showToast(data.error || 'Failed to save WiFi config', 'alert');
        }
    } catch (err) {
        showToast('Server error: ' + err.message, 'alert');
    }
}

function addWifiProfileRow(ssid = '', password = '') {
    const container = document.getElementById('wifi-profiles-container');
    if (!container) return;

    const row = document.createElement('div');
    row.className = 'wifi-profile-row';
    row.style.cssText = 'display:flex; gap:10px; align-items:flex-end; flex-wrap:wrap; padding:12px; border:1px solid var(--border); border-radius:10px; background:rgba(0,0,0,0.02);';
    row.innerHTML = `
        <div style="flex:2; min-width:220px;">
            <label style="display:block; margin-bottom:5px; font-size:0.85rem; color:var(--text-secondary);">WiFi Network Name (SSID)</label>
            <input type="text" class="wifi-ssid" value="${ssid.replace(/"/g, '&quot;')}" placeholder="e.g. MyCompanyWiFi" style="width:100%; padding:10px; background:var(--card-bg-soft); border:1px solid var(--border); color:var(--text-primary); border-radius:6px;">
        </div>
        <div style="flex:2; min-width:220px;">
            <label style="display:block; margin-bottom:5px; font-size:0.85rem; color:var(--text-secondary);">WiFi Password</label>
            <input type="password" class="wifi-password" value="${password.replace(/"/g, '&quot;')}" placeholder="Password" style="width:100%; padding:10px; background:var(--card-bg-soft); border:1px solid var(--border); color:var(--text-primary); border-radius:6px;">
        </div>
        <button class="btn-secondary" type="button" onclick="removeWifiProfileRow(this)" style="padding:10px 16px; height:41px;">Remove</button>
    `;

    container.appendChild(row);
}

function removeWifiProfileRow(button) {
    const row = button.closest('.wifi-profile-row');
    const container = document.getElementById('wifi-profiles-container');
    if (!row || !container) return;

    if (container.querySelectorAll('.wifi-profile-row').length <= 1) {
        row.querySelector('.wifi-ssid').value = '';
        row.querySelector('.wifi-password').value = '';
        return;
    }

    row.remove();
}

async function loadWifiProfiles() {
    const container = document.getElementById('wifi-profiles-container');
    if (!container) return;

    try {
        const res = await fetch(`${baseUrl}/api/wifi-config`);
        const data = await res.json();
        container.innerHTML = '';

        if (Array.isArray(data.profiles) && data.profiles.length > 0) {
            data.profiles.forEach(profile => addWifiProfileRow(profile.ssid || '', profile.password || ''));
        } else {
            addWifiProfileRow();
        }
    } catch (err) {
        container.innerHTML = '';
        addWifiProfileRow();
        console.error('Failed to load WiFi profiles', err);
    }
}

function logout() {
    window.location.href = '/login.html';
}

function exportTableToCSV(tbodyId, filename) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    const rows = tbody.querySelectorAll('tr');
    let csv = [];
    const table = tbody.closest('table');
    if (table) {
        const headers = Array.from(table.querySelectorAll('thead th')).map(th => `"${th.innerText.replace(/"/g, '""')}"`);
        csv.push(headers.join(','));
    }

    rows.forEach(row => {
        const cols = row.querySelectorAll('td, th');
        const rowData = Array.from(cols).map(col => {
            let text = col.innerText.replace(/"/g, '""');
            return `"${text}"`;
        });
        csv.push(rowData.join(','));
    });

    const csvFile = new Blob([csv.join('\n')], { type: "text/csv" });
    const downloadLink = document.createElement("a");
    downloadLink.download = filename;
    downloadLink.href = window.URL.createObjectURL(csvFile);
    downloadLink.style.display = "none";
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
}
