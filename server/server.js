const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');
const crypto = require('crypto');
const db = require('./db');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(bodyParser.json());

const ROLE_LEVEL = {
    operator: 1,
    manager: 2,
    admin: 3
};

const activeSessions = new Map();

function normalizeRole(role) {
    const clean = String(role || '').toLowerCase();
    return ROLE_LEVEL[clean] ? clean : 'operator';
}

function issueToken(user) {
    const token = crypto.randomBytes(24).toString('hex');
    activeSessions.set(token, {
        username: user.username,
        role: normalizeRole(user.role),
        displayName: user.display_name || user.username,
        createdAt: Date.now()
    });
    return token;
}

function getClientIp(req) {
    return req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
}

function getAuthContext(req) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : req.headers['x-auth-token'];
    if (!token) {
        return null;
    }
    const session = activeSessions.get(token);
    if (!session) {
        return null;
    }
    return { ...session, token };
}

function requireRole(minRole, options = {}) {
    const required = normalizeRole(minRole);
    const allowPrototypeFallback = options.allowPrototypeFallback !== false;

    return (req, res, next) => {
        const auth = getAuthContext(req);
        req.auth = auth;

        if (!auth) {
            if (allowPrototypeFallback) {
                req.auth = {
                    username: 'prototype-admin',
                    role: 'admin',
                    displayName: 'Prototype Admin'
                };
                return next();
            }
            return res.status(401).json({ error: 'Authentication required' });
        }

        if (ROLE_LEVEL[auth.role] < ROLE_LEVEL[required]) {
            return res.status(403).json({ error: `Requires ${required} role or higher` });
        }

        return next();
    };
}

function writeAuditLog(entry) {
    const payload = {
        actor_username: entry.actorUsername || 'system',
        actor_role: normalizeRole(entry.actorRole || 'operator'),
        action: entry.action || 'unknown_action',
        entity_type: entry.entityType || null,
        entity_id: entry.entityId || null,
        status: entry.status || 'success',
        details: entry.details ? JSON.stringify(entry.details) : null,
        ip_address: entry.ipAddress || null
    };

    db.run(`INSERT INTO audit_logs
        (actor_username, actor_role, action, entity_type, entity_id, status, details, ip_address)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
        payload.actor_username,
        payload.actor_role,
        payload.action,
        payload.entity_type,
        payload.entity_id,
        payload.status,
        payload.details,
        payload.ip_address
    ], (err) => {
        if (err) {
            console.error('Failed to write audit log:', err.message);
        }
    });
}

function auditFromRequest(req, event) {
    writeAuditLog({
        actorUsername: req.auth?.username || 'anonymous',
        actorRole: req.auth?.role || 'operator',
        ipAddress: getClientIp(req),
        ...event
    });
}

function normalizeUid(uid) {
    return String(uid || '').trim().toUpperCase();
}

function getUidPresence(uid, callback) {
    db.get(`SELECT uid FROM employees WHERE uid = ?`, [uid], (empErr, empRow) => {
        if (empErr) {
            callback(empErr);
            return;
        }

        db.get(`SELECT uid FROM components WHERE uid = ?`, [uid], (compErr, compRow) => {
            if (compErr) {
                callback(compErr);
                return;
            }

            callback(null, {
                inEmployees: Boolean(empRow),
                inComponents: Boolean(compRow)
            });
        });
    });
}

// Serve home landing first, then static assets and dashboard pages
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../dashboard/home.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, '../dashboard/index.html'));
});

app.use(express.static(path.join(__dirname, '../dashboard')));

// ==========================================
// ADMIN AUTHENTICATION
// ==========================================
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }

    db.get(`SELECT username, password, role, display_name, is_active
            FROM users WHERE username = ?`, [username], (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }

        if (!user || !user.is_active || user.password !== password) {
            writeAuditLog({
                actorUsername: username,
                actorRole: 'operator',
                action: 'auth.login',
                entityType: 'session',
                entityId: username,
                status: 'failed',
                details: { reason: 'invalid_credentials' },
                ipAddress: getClientIp(req)
            });
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = issueToken(user);

        writeAuditLog({
            actorUsername: user.username,
            actorRole: user.role,
            action: 'auth.login',
            entityType: 'session',
            entityId: token.slice(0, 12),
            status: 'success',
            details: { displayName: user.display_name || user.username },
            ipAddress: getClientIp(req)
        });

        return res.json({
            token,
            role: normalizeRole(user.role),
            username: user.username,
            displayName: user.display_name || user.username
        });
    });
});

app.get('/api/auth/me', requireRole('operator'), (req, res) => {
    res.json({
        username: req.auth.username,
        role: req.auth.role,
        displayName: req.auth.displayName || req.auth.username
    });
});

// ==========================================
// HARDWARE ENROLLMENT (From ESP32 Gate Reader)
// ==========================================
app.post('/api/enroll', (req, res) => {
    const uid = normalizeUid(req.body?.uid);
    const type = String(req.body?.type || '').trim().toLowerCase();
    if (!uid || !type) return res.status(400).json({ error: "Missing uid or type" });

    getUidPresence(uid, (presenceErr, presence) => {
        if (presenceErr) {
            return res.status(500).json({ error: presenceErr.message });
        }

        if (type === 'employee' && presence.inComponents) {
            return res.status(409).json({
                error: `UID ${uid} already exists as a component. One UID cannot be both employee and component.`
            });
        }

        if (type === 'component' && presence.inEmployees) {
            return res.status(409).json({
                error: `UID ${uid} already exists as an employee. One UID cannot be both employee and component.`
            });
        }

        if (type === 'employee') {
            db.run(`INSERT OR IGNORE INTO employees (uid, name) VALUES (?, ?)` ,
                [uid, 'New Employee (Edit via Dashboard)'], function (err) {
                    if (err) return res.status(500).json({ error: err.message });

                    const created = this.changes > 0;
                    if (created) {
                        broadcastUpdate({ type: 'alert', message: `🆕 New Employee Card enrolled from Gate: ${uid}`, severity: 'info' });
                        broadcastUpdate({ type: 'inventory_update' });
                        return res.status(201).json({ message: "Employee enrolled", uid, created: true });
                    }

                    return res.status(200).json({ message: "Employee already enrolled", uid, created: false });
                });
        } else if (type === 'component') {
            db.run(`INSERT OR IGNORE INTO components (uid, name, status) VALUES (?, ?, 'IN')`,
                [uid, 'New Component (Edit via Dashboard)'], function (err) {
                    if (err) return res.status(500).json({ error: err.message });

                    const created = this.changes > 0;
                    if (created) {
                        broadcastUpdate({ type: 'alert', message: `🆕 New Component Tag enrolled from Gate: ${uid}`, severity: 'info' });
                        broadcastUpdate({ type: 'inventory_update' });
                        return res.status(201).json({ message: "Component enrolled", uid, created: true });
                    }

                    return res.status(200).json({ message: "Component already enrolled", uid, created: false });
                });
        } else {
            res.status(400).json({ error: "Invalid type. Use 'employee' or 'component'." });
        }
    });
});

// ==========================================
// WIFI CONFIG (OTA Provisioning for ESP32)
// ==========================================
let wifiProfiles = [];

function loadWifiProfilesFromDb() {
    db.all(`SELECT ssid, password
            FROM wifi_profiles
            ORDER BY sort_order ASC, id ASC`, [], (err, rows) => {
        if (err) {
            console.error('Failed to load WiFi profiles from database:', err.message);
            return;
        }

        wifiProfiles = Array.isArray(rows)
            ? rows.map(row => ({ ssid: row.ssid || '', password: row.password || '' })).filter(profile => profile.ssid.length > 0)
            : [];
    });
}

function persistWifiProfiles(profiles, callback) {
    db.serialize(() => {
        db.run('DELETE FROM wifi_profiles', (deleteErr) => {
            if (deleteErr) {
                callback(deleteErr);
                return;
            }

            if (!profiles.length) {
                callback(null);
                return;
            }

            const stmt = db.prepare(`INSERT INTO wifi_profiles (ssid, password, sort_order, updated_at)
                                     VALUES (?, ?, ?, CURRENT_TIMESTAMP)`);

            profiles.forEach((profile, index) => {
                stmt.run(profile.ssid, profile.password || '', index);
            });

            stmt.finalize((finalizeErr) => {
                callback(finalizeErr || null);
            });
        });
    });
}

setTimeout(loadWifiProfilesFromDb, 500);

function normalizeWifiProfiles(body) {
    if (Array.isArray(body.profiles)) {
        return body.profiles
            .map(profile => ({
                ssid: String(profile.ssid || '').trim(),
                password: String(profile.password || '')
            }))
            .filter(profile => profile.ssid.length > 0)
            .slice(0, 5);
    }

    const ssid = String(body.ssid || '').trim();
    if (!ssid) {
        return [];
    }

    return [{ ssid, password: String(body.password || '') }];
}

app.get('/api/wifi-config', (req, res) => {
    if (wifiProfiles.length > 0) {
        return res.json({ profiles: wifiProfiles, count: wifiProfiles.length });
    }

    db.all(`SELECT ssid, password FROM wifi_profiles ORDER BY sort_order ASC, id ASC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        const profiles = Array.isArray(rows)
            ? rows.map(row => ({ ssid: row.ssid || '', password: row.password || '' })).filter(profile => profile.ssid.length > 0)
            : [];

        wifiProfiles = profiles;

        if (profiles.length === 0) {
            return res.status(404).json({ error: "No WiFi profiles set yet. Set them from the Dashboard." });
        }

        res.json({ profiles, count: profiles.length });
    });
});

app.post('/api/wifi-config', requireRole('manager'), (req, res) => {
    const profiles = normalizeWifiProfiles(req.body || {});

    if (profiles.length === 0) {
        return res.status(400).json({ error: "At least one SSID is required" });
    }

    persistWifiProfiles(profiles, (persistErr) => {
        if (persistErr) {
            return res.status(500).json({ error: persistErr.message });
        }

        wifiProfiles = profiles;

        auditFromRequest(req, {
            action: 'wifi.update_profiles',
            entityType: 'wifi_config',
            entityId: 'global',
            details: { count: wifiProfiles.length }
        });

        broadcastUpdate({
            type: 'alert',
            message: `📡 WiFi profiles updated (${wifiProfiles.length}). Devices will fetch on next sync.`,
            severity: 'info'
        });

        broadcastUpdate({ type: 'wifi_config_updated', profiles: wifiProfiles, count: wifiProfiles.length });

        res.json({
            message: "WiFi profiles saved. ESP32 devices will pick them up automatically.",
            profiles: wifiProfiles,
            count: wifiProfiles.length
        });
    });
});

// ==========================================
// CONFIG & STATE (In-Memory for simplicity)
// ==========================================
let geofenceConfig = {
    lat: 18.5204,
    lng: 73.8567,
    radius: 500, // meters
    name: "Authorized Work Zone"
};

const activeTrackers = {}; // State for GPS smoothing + health info

// WebSocket connections
wss.on('connection', (ws) => {
    console.log('Dashboard client connected via WebSocket');
    ws.send(JSON.stringify({ type: 'status', message: 'Connected to Live Tracking' }));
    // Send current geofence config to new clients
    ws.send(JSON.stringify({ type: 'geofence_config', ...geofenceConfig }));
});

function broadcastUpdate(data) {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

// ==========================================
// HELPER: Calculate distance between two GPS points (Haversine)
// ==========================================
function haversineDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000; // Earth's radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distance in meters
}

// ==========================================
// API ROUTES
// ==========================================

// 1. RFID GATE SCANNER (Check in / Check out)
app.post('/api/transactions/scan', (req, res) => {
    const componentUid = normalizeUid(req.body?.componentUid);
    const employeeUid = normalizeUid(req.body?.employeeUid);
    console.log(`[SCAN] Scan API called. componentUid=${componentUid}, employeeUid=${employeeUid}, time=${new Date().toISOString()}`);

    if (!componentUid || !employeeUid) {
        return res.status(400).json({ error: "Missing UIDs" });
    }

    console.log(`Gate Scan Received: ID1=${componentUid}, ID2=${employeeUid}`);

    // ORDER AGNOSTIC LOOKUP (one component tag + one employee card required)
    db.all(`SELECT uid, name, status, assigned_to, tracker_id FROM components WHERE uid = ? OR uid = ?`, [componentUid, employeeUid], (compErr, compRows) => {
        if (compErr) return res.status(500).json({ error: compErr.message });

        db.all(`SELECT uid, name FROM employees WHERE uid = ? OR uid = ?`, [componentUid, employeeUid], (empErr, empRows) => {
            if (empErr) return res.status(500).json({ error: empErr.message });

            if (!Array.isArray(compRows) || compRows.length === 0) {
                // No component found — check if both UIDs are employees
                const empNames = (empRows || []).map(e => e.name).join(', ');
                const hint = empRows && empRows.length >= 2
                    ? `Both scanned cards (${componentUid}, ${employeeUid}) are employee cards (${empNames}) — no component tag was scanned. Please scan one Component tag + one Employee card.`
                    : `No component tag found among scanned UIDs: ${componentUid}, ${employeeUid}. Please scan a registered component tag.`;
                return res.status(404).json({ error: hint });
            }

            if (!Array.isArray(empRows) || empRows.length === 0) {
                // No employee found — check if both UIDs are components
                const compNames = (compRows || []).map(c => c.name).join(', ');
                const hint = compRows && compRows.length >= 2
                    ? `Both scanned tags (${componentUid}, ${employeeUid}) are components (${compNames}) — no employee card was scanned. Please scan one Component tag + one Employee card.`
                    : `No employee card found among scanned UIDs: ${componentUid}, ${employeeUid}. Please scan a registered employee card.`;
                return res.status(404).json({ error: hint });
            }

            if (compRows.length > 1 || empRows.length > 1) {
                return res.status(409).json({
                    error: 'Ambiguous scan: scan exactly one employee card and one component tag.'
                });
            }

            const comp = compRows[0];
            const emp = empRows[0];
            const isCheckingOut = comp.status === 'IN';
            const newStatus = isCheckingOut ? 'OUT' : 'IN';
            const assignedTo = isCheckingOut ? emp.name : null;

            if (isCheckingOut) {
                const trackingMessage = comp.tracker_id
                    ? `✅ Successful Check-out: ${emp.name} took ${comp.name}. GPS tracking started.`
                    : `✅ Successful Check-out: ${emp.name} took ${comp.name}. No tracker linked to this component yet.`;

                console.log(`✅ Automatic Checkout: ${emp.name} is taking ${comp.name}`);
                broadcastUpdate({
                    type: 'alert',
                    message: trackingMessage,
                    severity: 'info'
                });
            }

            auditFromRequest(req, {
                action: isCheckingOut ? 'transaction.checkout' : 'transaction.checkin',
                entityType: 'component',
                entityId: comp.uid,
                details: {
                    component_uid: comp.uid,
                    employee_uid: emp.uid,
                    tracker_id: comp.tracker_id || null
                }
            });

            db.run(`UPDATE components SET status = ?, assigned_to = ?, approved_for_uid = NULL WHERE uid = ?`,
                [newStatus, assignedTo, comp.uid], function (updateErr) {
                    if (updateErr) return res.status(500).json({ error: "Database error" });

                    db.run(`INSERT INTO transactions (component_uid, employee_uid, action) VALUES (?, ?, ?)`,
                        [comp.uid, emp.uid, newStatus]);

                    broadcastUpdate({
                        type: 'inventory_update',
                        component: comp.name,
                        employee: emp.name,
                        action: newStatus
                    });

                    res.status(200).json({
                        message: `Successfully checked ${newStatus}`,
                        componentUid: comp.uid,
                        employeeUid: emp.uid,
                        componentName: comp.name,
                        employeeName: emp.name,
                        trackerId: comp.tracker_id || null,
                        trackingActive: isCheckingOut && Boolean(comp.tracker_id)
                    });
                });
        });
    });
});

// 2. GPS TRACKER UPDATES (with geofence check)
app.post('/api/tracking', (req, res) => {
    const { trackerId, lat, lng, firmwareVersion, accuracyMeters, hdop, speedKmh, headingDegrees } = req.body;

    if (!trackerId || !lat || !lng) {
        return res.status(400).json({ error: "Missing GPS data" });
    }

    console.log(`Raw GPS Update -> Tracker: ${trackerId} | Lat: ${lat}, Lng: ${lng}`);

    // --- EXPERIMENTAL: GPS PRECISION FILTER (EMA Smoothing) ---
    // The NEO-6M naturally jumps around. We apply an Exponential Moving Average
    // to smooth the path and make the map look highly precise.
    let finalLat = parseFloat(lat);
    let finalLng = parseFloat(lng);

    if (!activeTrackers[trackerId]) {
        activeTrackers[trackerId] = { lat: finalLat, lng: finalLng };
    } else {
        const alpha = 0.4; // Smoothing factor (lower = smoother but more lag)
        finalLat = (alpha * finalLat) + ((1 - alpha) * activeTrackers[trackerId].lat);
        finalLng = (alpha * finalLng) + ((1 - alpha) * activeTrackers[trackerId].lng);

        // Update state
        activeTrackers[trackerId].lat = finalLat;
        activeTrackers[trackerId].lng = finalLng;
    }

    activeTrackers[trackerId].lastSeen = new Date().toISOString();
    activeTrackers[trackerId].firmwareVersion = firmwareVersion || activeTrackers[trackerId].firmwareVersion || 'unknown';
    const parsedAccuracy = Number(accuracyMeters);
    const parsedHdop = Number(hdop);
    const parsedSpeed = Number(speedKmh);
    const parsedHeading = Number(headingDegrees);
    activeTrackers[trackerId].accuracyMeters = Number.isFinite(parsedAccuracy) && parsedAccuracy > 0 ? parsedAccuracy : activeTrackers[trackerId].accuracyMeters || null;
    activeTrackers[trackerId].hdop = Number.isFinite(parsedHdop) && parsedHdop > 0 ? parsedHdop : activeTrackers[trackerId].hdop || null;
    activeTrackers[trackerId].speedKmh = Number.isFinite(parsedSpeed) && parsedSpeed >= 0 ? parsedSpeed : activeTrackers[trackerId].speedKmh || null;
    activeTrackers[trackerId].headingDegrees = Number.isFinite(parsedHeading) && parsedHeading >= 0 ? parsedHeading : activeTrackers[trackerId].headingDegrees || null;

    console.log(`Smoothed GPS   -> Lat: ${finalLat.toFixed(6)}, Lng: ${finalLng.toFixed(6)}`);

    // Log to DB (using the smoothed coordinates for cleaner history)
    db.run(`INSERT INTO gps_logs (tracker_id, lat, lng) VALUES (?, ?, ?)`, [trackerId, finalLat, finalLng], (err) => {
        if (err) console.error("Could not save GPS log:", err);
    });

    // Calculate distance from geofence center using smoothed data
    const distFromZone = haversineDistance(finalLat, finalLng, geofenceConfig.lat, geofenceConfig.lng);
    const isOutsideGeofence = distFromZone > geofenceConfig.radius;

    if (isOutsideGeofence) {
        console.log(`⚠️ GEOFENCE ALERT: ${trackerId} is ${Math.round(distFromZone)}m from work zone!`);
    }

    broadcastUpdate({
        type: 'gps_update',
        trackerId,
        lat: finalLat,
        lng: finalLng,
        firmwareVersion: activeTrackers[trackerId].firmwareVersion,
        accuracyMeters: activeTrackers[trackerId].accuracyMeters,
        hdop: activeTrackers[trackerId].hdop,
        speedKmh: activeTrackers[trackerId].speedKmh,
        headingDegrees: activeTrackers[trackerId].headingDegrees,
        lastSeen: activeTrackers[trackerId].lastSeen,
        distanceFromZone: Math.round(distFromZone),
        isOutsideGeofence,
        timestamp: new Date().toISOString()
    });

    res.status(200).json({ message: "Location received", distanceFromZone: Math.round(distFromZone), isOutsideGeofence });
});

// 2b. DEVICE HEALTH (Tracker health + firmware visibility)
app.get('/api/devices/health', requireRole('manager'), (req, res) => {
    db.all(`SELECT id, uid, tracker_id, name, status, assigned_to FROM components WHERE tracker_id IS NOT NULL AND tracker_id != '' ORDER BY name ASC`, [], (err, components) => {
        if (err) return res.status(500).json({ error: err.message });

        if (!components || components.length === 0) {
            return res.json({ devices: [] });
        }

        const results = [];
        let remaining = components.length;

        components.forEach((component) => {
            db.get(`SELECT lat, lng, timestamp FROM gps_logs WHERE tracker_id = ? ORDER BY timestamp DESC LIMIT 1`, [component.tracker_id], (gpsErr, gpsRow) => {
                const runtime = activeTrackers[component.tracker_id] || {};
                const lastSeen = runtime.lastSeen || gpsRow?.timestamp || null;
                const lastSeenMs = lastSeen ? new Date(lastSeen).getTime() : 0;
                const ageMs = lastSeenMs ? (Date.now() - lastSeenMs) : Infinity;
                const isOnline = ageMs < 120000;
                const health = isOnline ? 'online' : (lastSeen ? 'stale' : 'offline');

                results.push({
                    componentUid: component.uid,
                    componentName: component.name,
                    trackerId: component.tracker_id,
                    assignedTo: component.assigned_to,
                    status: component.status,
                    firmwareVersion: runtime.firmwareVersion || 'unknown',
                    lastSeen,
                    lastLatitude: runtime.lat ?? gpsRow?.lat ?? null,
                    lastLongitude: runtime.lng ?? gpsRow?.lng ?? null,
                    locationUpdatedAt: gpsRow?.timestamp || null,
                    signalStatus: health,
                    ageSeconds: isFinite(ageMs) ? Math.round(ageMs / 1000) : null
                });

                remaining -= 1;
                if (remaining === 0) {
                    results.sort((a, b) => a.componentName.localeCompare(b.componentName));
                    res.json({ devices: results });
                }
            });
        });
    });
});

// 3. GET INVENTORY STATUS
app.get('/api/inventory', (req, res) => {
    db.all(`SELECT * FROM components`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ components: rows });
    });
});

// 3a. ADD COMPONENT
app.post('/api/components', requireRole('manager'), (req, res) => {
    const uid = normalizeUid(req.body?.uid);
    const tracker_id = String(req.body?.tracker_id || '').trim();
    const name = String(req.body?.name || '').trim();
    if (!uid || !name) return res.status(400).json({ error: "Missing uid or name" });

    getUidPresence(uid, (presenceErr, presence) => {
        if (presenceErr) return res.status(500).json({ error: presenceErr.message });
        if (presence.inEmployees) {
            return res.status(409).json({
                error: `UID ${uid} is already used by an employee card. Use a unique RFID UID for component tags.`
            });
        }

        db.run(`INSERT INTO components (uid, tracker_id, name) VALUES (?, ?, ?)`, [uid, tracker_id || null, name], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            auditFromRequest(req, {
                action: 'component.create',
                entityType: 'component',
                entityId: uid,
                details: { name, tracker_id: tracker_id || null }
            });
            broadcastUpdate({ type: 'inventory_update', action: 'component_added', component: name, componentUid: uid });
            res.status(201).json({ message: "Component added successfully" });
        });
    });
});

// 3b. REMOVE COMPONENT
app.delete('/api/components/:uid', requireRole('manager'), (req, res) => {
    db.run(`DELETE FROM components WHERE uid = ?`, [req.params.uid], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        auditFromRequest(req, {
            action: 'component.delete',
            entityType: 'component',
            entityId: req.params.uid
        });
        broadcastUpdate({ type: 'inventory_update', action: 'component_deleted', componentUid: req.params.uid });
        res.json({ message: "Component removed successfully" });
    });
});

// 4. GET EMPLOYEES
app.get('/api/employees', (req, res) => {
    db.all(`SELECT * FROM employees`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ employees: rows });
    });
});

// 4a. ADD EMPLOYEE
app.post('/api/employees', requireRole('manager'), (req, res) => {
    const uid = normalizeUid(req.body?.uid);
    const name = String(req.body?.name || '').trim();
    if (!uid || !name) return res.status(400).json({ error: "Missing uid or name" });

    getUidPresence(uid, (presenceErr, presence) => {
        if (presenceErr) return res.status(500).json({ error: presenceErr.message });
        if (presence.inComponents) {
            return res.status(409).json({
                error: `UID ${uid} is already used by a component tag. Use a unique RFID UID for employee cards.`
            });
        }

        db.run(`INSERT INTO employees (uid, name) VALUES (?, ?)`, [uid, name], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            auditFromRequest(req, {
                action: 'employee.create',
                entityType: 'employee',
                entityId: uid,
                details: { name }
            });
            broadcastUpdate({ type: 'inventory_update', action: 'employee_added', employee: name, employeeUid: uid });
            res.status(201).json({ message: "Employee added successfully" });
        });
    });
});

// 4b. REMOVE EMPLOYEE
app.delete('/api/employees/:uid', requireRole('manager'), (req, res) => {
    db.run(`DELETE FROM employees WHERE uid = ?`, [req.params.uid], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        auditFromRequest(req, {
            action: 'employee.delete',
            entityType: 'employee',
            entityId: req.params.uid
        });
        broadcastUpdate({ type: 'inventory_update', action: 'employee_deleted', employeeUid: req.params.uid });
        res.json({ message: "Employee removed successfully" });
    });
});

// 5. GET GPS HISTORY (for trail and playback)
app.get('/api/tracking/history', (req, res) => {
    const { trackerId, date } = req.query;
    let query = `SELECT * FROM gps_logs`;
    let params = [];

    if (trackerId && date) {
        query += ` WHERE tracker_id = ? AND DATE(timestamp) = ?`;
        params = [trackerId, date];
    } else if (trackerId) {
        query += ` WHERE tracker_id = ?`;
        params = [trackerId];
    }

    query += ` ORDER BY timestamp ASC`;

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ locations: rows });
    });
});

// 6. GET / SET GEOFENCE CONFIG
app.get('/api/geofence', (req, res) => {
    res.json(geofenceConfig);
});

app.post('/api/geofence', requireRole('manager'), (req, res) => {
    const { lat, lng, radius, name } = req.body;
    if (lat) geofenceConfig.lat = lat;
    if (lng) geofenceConfig.lng = lng;
    if (radius) geofenceConfig.radius = radius;
    if (name) geofenceConfig.name = name;

    console.log(`Geofence updated: ${JSON.stringify(geofenceConfig)}`);

    auditFromRequest(req, {
        action: 'geofence.update',
        entityType: 'geofence',
        entityId: 'default_zone',
        details: geofenceConfig
    });

    broadcastUpdate({ type: 'geofence_config', ...geofenceConfig });
    res.json({ message: "Geofence updated", config: geofenceConfig });
});

// 7. GET TRANSACTION HISTORY
app.get('/api/transactions', (req, res) => {
    const { date, employeeUid } = req.query;

    let query = `SELECT t.*, e.name as employee_name, c.name as component_name 
                 FROM transactions t 
                 LEFT JOIN employees e ON t.employee_uid = e.uid 
                 LEFT JOIN components c ON t.component_uid = c.uid`;
    let params = [];
    let conditions = [];

    if (date) {
        // Match local date string starting with YYYY-MM-DD
        conditions.push(`t.timestamp LIKE ?`);
        params.push(`${date}%`);
    }
    if (employeeUid) {
        conditions.push(`t.employee_uid = ?`);
        params.push(employeeUid);
    }

    if (conditions.length > 0) {
        query += ` WHERE ` + conditions.join(' AND ');
    }

    query += ` ORDER BY t.timestamp DESC LIMIT 200`;

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ transactions: rows });
    });
});

// 7b. AUDIT LOGS (RBAC foundation endpoint)
app.get('/api/audit-logs', requireRole('manager'), (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);
    const offset = Math.max(parseInt(req.query.offset || '0', 10), 0);
    const action = req.query.action ? String(req.query.action) : null;

    let query = `SELECT * FROM audit_logs`;
    const params = [];

    if (action) {
        query += ` WHERE action = ?`;
        params.push(action);
    }

    query += ` ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ logs: rows, limit, offset, count: rows.length });
    });
});

// 8. LOCATION ANALYTICS (Time at location clusters)
app.get('/api/tracking/analytics', (req, res) => {
    const trackerId = req.query.trackerId || 'COMP-ROUTER-001';

    db.all(`SELECT * FROM gps_logs WHERE tracker_id = ? ORDER BY timestamp ASC`, [trackerId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        // Cluster nearby points (within 50 meters)
        const clusters = [];
        let currentCluster = null;

        rows.forEach((point) => {
            if (!currentCluster) {
                currentCluster = { lat: point.lat, lng: point.lng, startTime: point.timestamp, endTime: point.timestamp, count: 1 };
            } else {
                const dist = haversineDistance(currentCluster.lat, currentCluster.lng, point.lat, point.lng);
                if (dist < 50) {
                    currentCluster.endTime = point.timestamp;
                    currentCluster.count++;
                } else {
                    clusters.push({ ...currentCluster });
                    currentCluster = { lat: point.lat, lng: point.lng, startTime: point.timestamp, endTime: point.timestamp, count: 1 };
                }
            }
        });
        if (currentCluster) clusters.push(currentCluster);

        // Calculate duration for each cluster
        const analytics = clusters.map(c => {
            const start = new Date(c.startTime);
            const end = new Date(c.endTime);
            const durationMin = Math.round((end - start) / 60000);
            const distFromZone = haversineDistance(c.lat, c.lng, geofenceConfig.lat, geofenceConfig.lng);
            return {
                lat: c.lat,
                lng: c.lng,
                duration: durationMin,
                readings: c.count,
                startTime: c.startTime,
                endTime: c.endTime,
                distanceFromZone: Math.round(distFromZone),
                isAuthorized: distFromZone <= geofenceConfig.radius
            };
        });

        res.json({ analytics });
    });
});

// 8b. ASSET TIMELINE / REPORTS
app.get('/api/reports/asset-timeline', requireRole('manager'), (req, res) => {
    const componentUid = String(req.query.componentUid || '').trim();
    const trackerId = String(req.query.trackerId || '').trim();

    const finishWithTimeline = (component, tracker, callback) => {
        const events = [];

        const addEvents = (type, rows, mapFn) => {
            rows.forEach(row => {
                const mapped = mapFn(row);
                if (mapped) events.push(mapped);
            });
        };

        const runQueries = () => {
            db.all(`SELECT t.timestamp, t.action, t.employee_uid, e.name as employee_name, t.component_uid
                    FROM transactions t
                    LEFT JOIN employees e ON t.employee_uid = e.uid
                    WHERE t.component_uid = ?
                    ORDER BY t.timestamp DESC`, [component.uid], (txErr, transactions) => {
                if (txErr) return callback(txErr);

                addEvents('transaction', transactions, (row) => ({
                    type: 'transaction',
                    timestamp: row.timestamp,
                    title: row.action === 'OUT' ? 'Checked Out' : 'Checked In',
                    subtitle: `${row.employee_name || row.employee_uid || 'Unknown'} • ${row.component_uid}`,
                    severity: row.action === 'OUT' ? 'warning' : 'success',
                    sourceId: row.component_uid,
                    meta: { employeeUid: row.employee_uid }
                }));

                db.all(`SELECT r.timestamp, r.status, r.employee_uid, e.name as employee_name, r.component_uid
                        FROM requests r
                        LEFT JOIN employees e ON r.employee_uid = e.uid
                        WHERE r.component_uid = ?
                        ORDER BY r.timestamp DESC`, [component.uid], (reqErr, requests) => {
                    if (reqErr) return callback(reqErr);

                    addEvents('request', requests, (row) => ({
                        type: 'request',
                        timestamp: row.timestamp,
                        title: `Request ${String(row.status || '').toUpperCase()}`,
                        subtitle: `${row.employee_name || row.employee_uid || 'Unknown'} • ${row.component_uid}`,
                        severity: row.status === 'approved' ? 'success' : (row.status === 'rejected' ? 'danger' : 'warning'),
                        sourceId: row.component_uid,
                        meta: { employeeUid: row.employee_uid, status: row.status }
                    }));

                    if (tracker && tracker.tracker_id) {
                        db.all(`SELECT tracker_id, lat, lng, timestamp
                                FROM gps_logs
                                WHERE tracker_id = ?
                                ORDER BY timestamp DESC
                                LIMIT 300`, [tracker.tracker_id], (gpsErr, gpsRows) => {
                            if (gpsErr) return callback(gpsErr);

                            addEvents('gps', gpsRows, (row) => ({
                                type: 'gps',
                                timestamp: row.timestamp,
                                title: 'GPS Update',
                                subtitle: `${row.lat.toFixed(5)}, ${row.lng.toFixed(5)} • ${row.tracker_id}`,
                                severity: 'info',
                                sourceId: row.tracker_id,
                                meta: { lat: row.lat, lng: row.lng }
                            }));

                            db.all(`SELECT timestamp, actor_username, actor_role, action, entity_type, entity_id, status, details
                                    FROM audit_logs
                                    WHERE entity_type = 'component' AND entity_id = ?
                                    ORDER BY timestamp DESC`, [component.uid], (auditErr, audits) => {
                                if (auditErr) return callback(auditErr);

                                addEvents('audit', audits, (row) => ({
                                    type: 'audit',
                                    timestamp: row.timestamp,
                                    title: row.action,
                                    subtitle: `${row.actor_username || 'system'} • ${row.actor_role || 'operator'}`,
                                    severity: row.status === 'success' ? 'success' : 'danger',
                                    sourceId: row.entity_id,
                                    meta: row.details ? { details: row.details } : {}
                                }));

                                events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

                                const summary = {
                                    totalEvents: events.length,
                                    transactions: transactions.length,
                                    requests: requests.length,
                                    gpsPoints: tracker && tracker.tracker_id ? gpsRows.length : 0,
                                    audits: audits.length,
                                    componentStatus: component.status,
                                    assignedTo: component.assigned_to || null,
                                    trackerId: tracker ? tracker.tracker_id : null
                                };

                                callback(null, {
                                    component: {
                                        uid: component.uid,
                                        name: component.name,
                                        status: component.status,
                                        assignedTo: component.assigned_to || null,
                                        trackerId: tracker ? tracker.tracker_id : null
                                    },
                                    summary,
                                    events
                                });
                            });
                        });
                    } else {
                        db.all(`SELECT timestamp, actor_username, actor_role, action, entity_type, entity_id, status, details
                                FROM audit_logs
                                WHERE entity_type = 'component' AND entity_id = ?
                                ORDER BY timestamp DESC`, [component.uid], (auditErr, audits) => {
                            if (auditErr) return callback(auditErr);

                            addEvents('audit', audits, (row) => ({
                                type: 'audit',
                                timestamp: row.timestamp,
                                title: row.action,
                                subtitle: `${row.actor_username || 'system'} • ${row.actor_role || 'operator'}`,
                                severity: row.status === 'success' ? 'success' : 'danger',
                                sourceId: row.entity_id,
                                meta: row.details ? { details: row.details } : {}
                            }));

                            events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

                            callback(null, {
                                component: {
                                    uid: component.uid,
                                    name: component.name,
                                    status: component.status,
                                    assignedTo: component.assigned_to || null,
                                    trackerId: null
                                },
                                summary: {
                                    totalEvents: events.length,
                                    transactions: transactions.length,
                                    requests: requests.length,
                                    gpsPoints: 0,
                                    audits: audits.length,
                                    componentStatus: component.status,
                                    assignedTo: component.assigned_to || null,
                                    trackerId: null
                                },
                                events
                            });
                        });
                    }
                });
            });
        };

        runQueries();
    };

    if (!componentUid && !trackerId) {
        return res.status(400).json({ error: 'Provide componentUid or trackerId' });
    }

    if (componentUid) {
        db.get(`SELECT * FROM components WHERE uid = ?`, [componentUid], (err, component) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!component) return res.status(404).json({ error: 'Component not found' });

            let tracker = null;
            if (component.tracker_id) {
                tracker = { tracker_id: component.tracker_id };
            }

            finishWithTimeline(component, tracker, (timelineErr, payload) => {
                if (timelineErr) return res.status(500).json({ error: timelineErr.message });
                res.json(payload);
            });
        });
        return;
    }

    db.get(`SELECT * FROM components WHERE tracker_id = ?`, [trackerId], (err, component) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!component) return res.status(404).json({ error: 'No component mapped to this trackerId' });

        finishWithTimeline(component, { tracker_id: trackerId }, (timelineErr, payload) => {
            if (timelineErr) return res.status(500).json({ error: timelineErr.message });
            res.json(payload);
        });
    });
});

// ==========================================
// ADMIN APPROVAL WORKFLOW API
// ==========================================

// Get all requests
app.get('/api/requests', (req, res) => {
    db.all(`SELECT r.*, e.name as employee_name, c.name as component_name 
            FROM requests r
            JOIN employees e ON r.employee_uid = e.uid
            JOIN components c ON r.component_uid = c.uid
            ORDER BY r.timestamp DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ requests: rows });
    });
});

// Employee Creates Request
app.post('/api/requests', (req, res) => {
    const { employeeUid, componentUid } = req.body;
    if (!employeeUid || !componentUid) return res.status(400).json({ error: "Missing UIDs" });

    // Check if component is actually IN inventory
    db.get(`SELECT status FROM components WHERE uid = ?`, [componentUid], (err, comp) => {
        if (err || !comp) return res.status(404).json({ error: "Component not found" });
        if (comp.status === 'OUT') return res.status(400).json({ error: "Component already out in the field" });

        db.run(`INSERT INTO requests (employee_uid, component_uid, status) VALUES (?, ?, 'pending')`,
            [employeeUid, componentUid], function (err) {
                if (err) return res.status(500).json({ error: err.message });

                broadcastUpdate({ type: 'new_request' });
                res.status(201).json({ message: "Request sent for Admin approval" });
            });
    });
});

// Admin Approves Request
app.post('/api/requests/:id/approve', requireRole('manager'), (req, res) => {
    const reqId = req.params.id;

    db.get(`SELECT * FROM requests WHERE id = ?`, [reqId], (err, request) => {
        if (err || !request) return res.status(404).json({ error: "Request not found" });

        // Update Component to be approved for this employee
        db.run(`UPDATE components SET approved_for_uid = ? WHERE uid = ?`,
            [request.employee_uid, request.component_uid], (err) => {
                if (err) return res.status(500).json({ error: err.message });

                // Update Request Status
                db.run(`UPDATE requests SET status = 'approved' WHERE id = ?`, [reqId], () => {
                    auditFromRequest(req, {
                        action: 'request.approve',
                        entityType: 'request',
                        entityId: String(reqId),
                        details: {
                            employee_uid: request.employee_uid,
                            component_uid: request.component_uid
                        }
                    });
                    broadcastUpdate({ type: 'request_update' });
                    res.json({ message: "Approved successfully. Employee can now check out the item." });
                });
            });
    });
});

// Admin Rejects Request
app.post('/api/requests/:id/reject', requireRole('manager'), (req, res) => {
    db.run(`UPDATE requests SET status = 'rejected' WHERE id = ?`, [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        auditFromRequest(req, {
            action: 'request.reject',
            entityType: 'request',
            entityId: String(req.params.id)
        });
        broadcastUpdate({ type: 'request_update' });
        res.json({ message: "Request rejected." });
    });
});

// START SERVER
const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`=========================================`);
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Dashboard available at http://localhost:${PORT}/`);
    console.log(`=========================================`);

    // Log current database state for verification
    setTimeout(() => {
        db.all(`SELECT uid, name FROM employees`, [], (err, rows) => {
            if (!err && rows) {
                console.log(`\n📋 Registered Employees (${rows.length}):`);
                rows.forEach(r => console.log(`   - ${r.uid} → ${r.name}`));
            }
        });
        db.all(`SELECT uid, name, tracker_id, status, assigned_to FROM components`, [], (err, rows) => {
            if (!err && rows) {
                console.log(`📦 Registered Components (${rows.length}):`);
                rows.forEach(r => console.log(`   - ${r.uid} → ${r.name} [${r.status}] tracker=${r.tracker_id || 'none'} assigned=${r.assigned_to || 'none'}`));
                console.log('');
            }
        });
    }, 1000);
});
