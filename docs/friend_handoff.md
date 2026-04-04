# Friend Handoff Notes

This document is for the collaborator who cloned the repo and wants to update UI and feature work safely.

## Stable Core

Do not change these unless you are intentionally modifying the system architecture:
- scan order logic
- RFID to employee/component linking
- GPS tracker-to-component mapping
- WebSocket live update flow
- backend RBAC rules
- dashboard role gating

## Safe Places To Edit

### UI changes
- `dashboard/home.html`
- `dashboard/index.html`
- `dashboard/style.css`
- `dashboard/app.js`
- `dashboard/login.html`

### Hardware config changes
- `firmware/rfid_reader_station/src/main.cpp`
- `firmware/gps_tracker/src/main.cpp`

### Defaults and seed data
- `server/db.js`
- `config/project-settings.example.json`

## Before You Push

1. Update IPs and Wi-Fi settings.
2. Confirm the two default employee cards and one component card still match the database.
3. Check role visibility for operator, manager, and admin.
4. Test a full scan cycle.
5. Test a live GPS update.

## Recommended Branch Flow

- Keep `main` protected/stable.
- Create a separate branch for UI experiments.
- Merge only after the backend and firmware still work together.
