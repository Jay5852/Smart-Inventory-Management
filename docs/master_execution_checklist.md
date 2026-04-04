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
