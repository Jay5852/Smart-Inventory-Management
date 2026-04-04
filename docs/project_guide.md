# Smart Inventory Management System — Project Guide

## 1. Overview

Smart Inventory Management System is an RFID + GPS based inventory and asset tracking platform.
It is designed to:
- identify employees with RFID cards,
- identify components with RFID tags,
- track checked-out components using GPS,
- show live status in a web dashboard,
- protect admin-only actions using role-based access control.

The system is split into three major parts:
- **Backend:** Node.js + Express + SQLite + WebSocket
- **Dashboard:** HTML + CSS + JavaScript + Leaflet
- **Firmware:** ESP32 gate reader + ESP32 GPS tracker

## 2. Current Core Flow

1. An admin or manager logs into the dashboard.
2. A manager adds employees/components, Wi-Fi profiles, and geofence settings.
3. The gate reader scans one employee card and one component tag.
4. The backend resolves the scan order automatically.
5. If the component is checked out, the system records the transaction and starts live tracking.
6. The GPS tracker sends periodic updates to the backend.
7. The dashboard receives live updates through WebSocket and refreshes the map, activity, and tables.

## 3. Roles and Permissions

### Operator
Best for day-to-day gate handling.
- View live dashboard data
- Scan cards at the gate
- Use basic tracking and inventory views
- Receive live alerts

### Manager
Best for operations and setup.
- Add and remove employees
- Add and remove components
- Update Wi-Fi profiles
- Update geofence/work-zone settings
- View device health
- View asset reports
- Review transaction logs

### Admin
Best for audit and oversight.
- Everything a manager can do
- View audit trail
- Access admin-only reporting and logs
- Keep system-level control over the deployment

## 4. Dashboard Features

### Overview
- Summary cards for inventory, check-ins, check-outs, and activity
- Recent activity feed
- Live status panel

### Live Tracking
- Real-time map updates
- Follow/recenter controls
- Map mode toggle
- Accuracy ring
- Speed and heading display
- Geofence warning banner

### History & Playback
- Historical GPS trail
- Animated playback of movement
- Location breadcrumbs

### Inventory
- List registered components
- Show status, assignment, and tracker link
- Add or delete components for manager/admin roles

### Employee Portal
- View storeroom availability
- Request hardware by component UID
- View checked-out equipment and request history
- Track request status updates through live sync

### Staff Management
- List registered employees
- Add or delete employees for manager/admin roles

### Wi-Fi Settings
- Save multiple Wi-Fi profiles
- Push Wi-Fi settings to the ESP32 reader
- Allow the reader to reconnect automatically to saved networks

### Device Health
- Show tracker online/stale/offline state
- Show firmware version
- Show last seen GPS point and location

### Asset Reports
- Show timeline of transactions, GPS points, requests, and audit events
- Filter by component and date range

### Audit Trail
- Admin-only operational audit history
- Useful for compliance and troubleshooting

## 5. Firmware Features

### Gate Reader Firmware
- RFID card scanning
- Admin menu on-device
- Employee enrollment
- Component enrollment
- Wi-Fi provisioning from dashboard profiles
- Open network fallback
- Button diagnostics and OLED feedback
- Duplicate scan suppression and smoother menu navigation

### GPS Tracker Firmware
- GPS parsing and smoothing
- Wi-Fi upload to backend
- GSM fallback support
- Accuracy and motion metadata
- Live coordinate updates for dashboard tracking

## 6. Default Data

Current seeded records in the database:
- **Admin employee card:** `BDD0D316` → `Admin`
- **Employee card:** `2458CA2B` → `Employee`
- **Component tag:** `D6F87C05` → `Main Router`
- **Tracker ID:** `COMP-ROUTER-001`

## 7. Where to Change Settings

Use `docs/project_config_map.md` as the first stop.

Important values to change when moving to a new PC or Wi-Fi:
- server IP
- server port
- GPS tracker Wi-Fi SSID and password
- component tracker ID
- default employee/component UIDs
- dashboard base URL assumptions

## 8. Setup Instructions

### Backend
```bash
cd server
npm install
node server.js
```

### Dashboard
Open:
```text
http://localhost:3000/login.html
```

### Default Login
- Username: `admin`
- Password: `admin`

## 9. Typical Usage

### Add an employee
1. Log in as manager/admin.
2. Open Staff Management.
3. Enter a unique UID and name.
4. Save the employee.

### Add a component
1. Open Inventory.
2. Enter a unique component UID.
3. Enter the tracker ID if the asset has GPS tracking.
4. Save the component.

### Track an asset
1. Check out the component using the gate reader.
2. Confirm the tracker ID matches the component.
3. Watch the Live Tracking tab for updates.

### Update Wi-Fi for the gate reader
1. Open Network Settings.
2. Add one or more Wi-Fi profiles.
3. Save and push to devices.
4. On the reader, open the Wi-Fi menu and reconnect.

## 10. What Changed Recently

- Live tracking UI was simplified and cleaned up.
- Role-based visibility was tightened in the dashboard.
- The GPS tracker now sends coordinates even with weak satellite counts.
- The database now contains only the intended default records.

## 11. Removed or Hidden Extra Features

These are no longer exposed in the main dashboard for ordinary users:
- unnecessary device-health access for operators
- extra report access for non-managers
- audit trail access for non-admins
- duplicate or confusing menu actions

The core operational flow remains intact.

## 12. Troubleshooting

### GPS not updating
- Check the tracker Wi-Fi SSID/password.
- Confirm the server IP matches the current PC.
- Confirm the GPS tracker is using the correct `TRACKER_ID`.
- Check that the backend is running and reachable on port `3000`.

### Scanner seems stuck after one card
- Verify the RFID reader firmware has the latest duplicate-scan handling.
- Check that the card is not being read continuously due to hardware bounce.
- Confirm the backend logs show each scan arriving.

### Dashboard options look wrong for a role
- Check the session role stored in the login flow.
- Refresh the page after login.
- Ensure the user role is set correctly in the database/session.

## 13. Branching Workflow For Your Friend

For collaborator work:
1. Keep `main` stable.
2. Create a feature branch for UI changes.
3. Put visual changes and new features there.
4. Merge only after the core workflow still passes.

Suggested branch names:
- `feature/friend-ui-update`
- `feature/ui-and-features-sync`
- `release/stable-core`

## 14. Final Note

This guide reflects the current stable direction of the project: core scan logic, live GPS tracking, and role-based dashboard control.
