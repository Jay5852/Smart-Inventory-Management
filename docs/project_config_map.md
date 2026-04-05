# Project Configuration Map

This file is the single handoff reference for anyone moving the project to another PC or Wi-Fi network.

## Update These Values First

| Area | File | Key Values |
|---|---|---|
| Backend server | `server/server.js` | Listen port, WebSocket base, API URL assumptions |
| Database seed data | `server/db.js` | Default employee UIDs, component UID, tracker ID, names |
| RFID gate reader firmware | `firmware/rfid_reader_station/src/main.cpp` | `serverIP`, `serverPort`, default admin behavior |
| GPS tracker firmware | `firmware/gps_tracker/src/main.cpp` | `TRACKER_ID`, `ssid`, `password`, `serverHost`, `serverPort` |
| Dashboard login | `dashboard/login.html` | Session token storage and login redirect flow |
| Dashboard runtime UI | `dashboard/app.js` | Local `baseUrl`, role gates, tracker/report API endpoints |
| Project docs | `README.md`, `docs/master_execution_checklist.md` | Old defaults and usage text |

## Current Live Defaults

- **Server IP:** `10.13.125.209`
- **Server port:** `3000`
- **GPS tracker ID:** `COMP-ROUTER-001`
- **GPS tracker SSID:** `VISHAL`
- **GPS tracker password:** `11111111`
- **Admin login:** `admin / admin`
- **Manager login:** `manager / manager`
- **Default employee UID:** `2458CA2B`
- **Default admin UID in staff table:** `BDD0D316`
- **Default component UID:** `D6F87C05`

## What Your Friend Should Edit

1. Change the PC IP in both firmware files.
2. Update the Wi-Fi SSID/password in `firmware/gps_tracker/src/main.cpp`.
3. If the hardware tracker tag changes, update `TRACKER_ID` in the GPS firmware and `tracker_id` in the database seed.
4. If the new installation uses different default cards, update `server/db.js` and the default records in `config/project-settings.example.json`.
5. If the dashboard is served from a different origin, update `dashboard/app.js` `baseUrl` logic.
6. If the router or Wi-Fi provisioning flow changes, update the Wi-Fi profile docs in `server/db.js` and `server/server.js`.

## Notes

- This repo still contains legacy approval routes in the backend, but the dashboard is now role-gated and the core flow uses direct scan logic.
- The safest move is to copy `config/project-settings.example.json` to a local working file and keep the code files in sync with it.
- If you want a fully automated config system later, this map is the place to start wiring it in.
