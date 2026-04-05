# Smart Inventory Management System — Master Execution Checklist

This file tracks what is done, what is in progress, and what remains before the project is complete.

## 1) Done
- `docs/hardware_connections.md` created as the master wiring reference.
- `docs/rfid_receiver_hardware.md` created for the gate reader station.
- `docs/gps_transmitter_hardware.md` created for the GPS tracker node.
- `firmware/rfid_reader_station/src/main.cpp` exists with RFID scan flow, display feedback, buzzer, and server upload.
- `firmware/gps_tracker/src/main.cpp` exists with GPS capture, filtering, Wi-Fi upload, and GSM fallback.
- `server/server.js` includes RBAC, audit logging, device health, asset timeline/reporting, Wi-Fi profile persistence, and tracking telemetry enrichment.
- `dashboard/index.html`, `dashboard/app.js`, `dashboard/employee.html`, and `dashboard/employee.js` include premium UI, role-aware actions, audit trail, device health, and asset reporting tabs.
- Live tracking upgrades are integrated: map mode toggle, follow/recenter controls, accuracy ring, speed/heading, and heading-aware marker.
- Backend smoke test `server/health-check.js` passes end to end against a running local server.

## 2) In Progress
- Firmware-on-hardware validation (real RFID scans and real GPS movement/geofence behavior).
- PlatformIO build validation for both firmware projects in the user hardware environment.

## 3) Remaining Work
- Run firmware builds in PlatformIO for both ESP32 projects.
- Validate the full RFID scan flow from device to database to dashboard with physical tags.
- Validate GPS tracking, geofence alerts, map mode, follow controls, and accuracy ring with real coordinates.
- Clean up any approval-related code paths that are no longer used.
- Add final deployment and usage instructions.

## 4) Suggested Next Order
1. Finalize firmware pin maps.
2. Build and test `rfid_reader_station`.
3. Build and test `gps_tracker`.
4. Run physical RFID + tracker validation against the backend/dashboard.
5. Confirm dashboard updates in browser (all tabs + role-gated actions).
6. Remove or archive outdated approval workflow pieces if they are no longer needed.
7. Write final deployment + operations guide.

## 5) Current Stop Point
The project is at a **late integration / pre-release stage**:
- Core software integration is complete and smoke-tested.
- Remaining tasks are hardware-field validation, cleanup, and release documentation.

## 6) End-to-End Validation Flow
- Start the backend from `server/` with `node server.js`.
- Open `http://localhost:3000` and log in as `admin / admin` or `manager / manager`.
- Open the `Network Settings` tab in the dashboard. This is where the gate reader pulls its saved Wi-Fi SSID/password pairs. Save one or more company Wi-Fi profiles there.
- Flash `firmware/rfid_reader_station` to the gate ESP32 and `firmware/gps_tracker` to the tracker ESP32.
- On the gate reader home screen:
  - Confirm the Wi-Fi icon appears in the top-right corner.
  - Confirm the device does not auto-join any random open network on boot when no saved Wi-Fi profile exists.
  - Press `SELECT` once and confirm the main menu opens.
  - Use `UP` / `DOWN` to select `WiFi Connect`, then press `SELECT`.
  - In the Wi-Fi menu, use `Retry Saved WiFi`, `Open Network`, or `Fetch Dashboard WiFi` until the device shows connected.
  - When fetching Wi-Fi from the dashboard, select the open network manually from the list. Do not accept automatic open-network selection.
  - Restart the gate reader and confirm it reconnects automatically to the saved dashboard Wi-Fi profile, not to the previously used open network.
  - From the main menu, select `Admin Access`, scan the admin card, and confirm the admin menu stays open.
- Enroll one employee card and one component tag from the gate reader admin menu, then confirm both appear in the dashboard staff/inventory tabs.
- Run `node server/health-check.js` while the backend is running to verify login, inventory APIs, approvals, and gate-scan logic.
- Test the live gate flow with real cards:
  - Scan employee + component in either order after approval and confirm checkout.
  - Scan the same pair again and confirm check-in.
  - Verify the activity feed, inventory status, and transaction logs update immediately.
- Test the GPS tracker outdoors:
  - Wait for a stable fix with at least 4 satellites.
  - Confirm the serial log no longer treats `HDOP 99.99` as a hard error.
  - Verify live location, distance-from-zone, accuracy, speed, and heading update in the dashboard.
- Move the tracker outside the configured work zone and confirm the geofence alert banner appears.

## 7) Friend-Side Hotspot Bootstrap (Recommended First-Time Setup)
- Use this when the system is moved to a new place and normal Wi-Fi is not stable yet.
- Keep one network path for everything to avoid IP mismatch.

### Network Topology
1. Friend phone hotspot ON (internet source).
2. Friend laptop connected to phone hotspot.
3. Friend laptop Mobile Hotspot ON.
4. Both ESP32 boards connect to laptop hotspot SSID/password.

### Get Correct Server IP from Laptop
Run on friend laptop:

```powershell
ipconfig
```

- Find IPv4 under hotspot adapter (`Local Area Connection*` / `Microsoft Wi-Fi Direct Virtual Adapter`).
- Typical value is `192.168.137.1`.
- Use this IPv4 as backend server IP for both ESP32 firmwares and dashboard config.

### First Boot Procedure
1. Start backend on friend laptop (`server/`):

```powershell
npm run start
```

2. Open dashboard and go to `Network Settings`.
3. Remove old Wi-Fi profiles from previous location.
4. Save only friend laptop hotspot SSID/password profile.
5. On reader menu: `WiFi Connect` → `Fetch Dashboard WiFi` → select friend hotspot.
6. Reboot both ESP32 boards and confirm reconnect to the same hotspot.

### Quick Pass Criteria
- Reader shows Wi-Fi connected icon consistently after reboot.
- RFID scan flow updates inventory/transactions in dashboard.
- Tracker location updates live without routing to old network.
- No unexpected reconnect attempts to previous AP names.

## 8) No-Reflash Endpoint Switching (Home ↔ College)
- The firmware now supports **automatic endpoint selection** and persistent storage.
- On each request, devices try: `last good host` → `gateway host` (if enabled) → `manual host`.
- This means location changes normally work without manual serial/menu updates.

### Reader (RFID Station) Runtime Config
- On device: `Main Menu` → `Server Config` → `Toggle Mode`.
- Keep mode in `GATEWAY` for portable auto behavior.
- USB serial commands are optional overrides only:
  - `SHOW`
  - `MODE GATEWAY`
  - `MODE MANUAL`
  - `HOST <ip-or-host>`
  - `PORT <1-65535>`
  - `HELP`

### Tracker Runtime Config (USB Serial)
- Connect tracker over USB and open serial monitor (`115200`).
- Available optional override commands:
  - `SHOW`
  - `MODE GATEWAY`
  - `MODE MANUAL`
  - `HOST <ip-or-host>`
  - `PORT <1-65535>`
  - `WIFI <ssid>|<password>`
  - `HELP`

### Recommended Portable Workflow
1. Enable laptop hotspot and connect both ESP32 devices.
2. Keep both devices in `MODE GATEWAY` (default recommended).
3. Start backend on laptop.
4. Verify connectivity with one RFID transaction and one GPS update.
5. No manual `HOST/PORT` step is needed during normal place changes.

### When to Use Manual Mode
- Use `MODE MANUAL` only if backend is not reachable through auto fallback (for example, fixed lab server IP or public DNS host).

## 9) Role Authority Matrix (Who does what)

Use these default responsibilities so the team knows exactly who controls which feature.

- **Admin**
  - Full access to all tabs and actions.
  - Can review audit logs and supervise manager/operator activities.
  - Can configure geofence and network settings.

- **Manager**
  - Operational owner for day-to-day system setup.
  - Can add/remove employees and components.
  - Can set/update geofence center and radius.
  - Can update Wi-Fi profiles for ESP32 devices.
  - Can access device health and asset reports.

- **Operator**
  - Gate operation and live monitoring only.
  - Can run scans and monitor inventory/tracking updates.
  - Cannot change geofence, Wi-Fi profiles, or master records.

### Geofence Ownership (recommended)
- Assign **one Manager** as primary geofence owner.
- Keep **one Admin** as backup approver.
- Operators should only monitor alerts and escalate if the zone needs update.

### Where to set geofence in UI
1. Login as **manager** or **admin**.
2. Open **Live Tracking** tab.
3. In **Geofence Settings**:
   - Search location or use `Select on Map`.
   - Set `Latitude`, `Longitude`, and `Radius`.
   - Click `Update Work Zone`.
4. Verify the new circle appears on map and alert banner behavior is correct.
