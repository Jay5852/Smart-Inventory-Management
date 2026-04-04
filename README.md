# Smart Inventory Management System

An intelligent RFID-based inventory management system with real-time GPS component tracking, built as a Final Year B.E. (E&TC) project.

## Features

- **RFID Check-In/Out:** Dual-card scanning at the gate (order-agnostic)
- **Role-Based Dashboard:** Operator, manager, and admin see different actions
- **Live GPS Tracking:** Real-time map with breadcrumb trails and geofencing alerts
- **Dual-Mode Connectivity:** WiFi + SIM800L GPRS cellular fallback
- **Hardware Admin Mode (GFM):** On-device OLED menu with 4 pushbuttons for card enrollment and WiFi setup
- **First Boot Setup:** Phone-style initial configuration for Master Admin card
- **OTA WiFi Provisioning:** ESP32 fetches secure WiFi credentials from the Dashboard over an open network
- **Secure Dashboard:** Admin login with role-based access control
- **Device Health & Asset Reports:** Manager/admin reporting for trackers and assets

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Hardware | ESP32 DevKit V1, MFRC522 RFID, NEO-6M GPS, SIM800L GSM |
| Firmware | C++ (PlatformIO/Arduino Framework) |
| Backend | Node.js, Express, SQLite, WebSocket |
| Frontend | HTML, CSS, JavaScript, Leaflet.js |

## Project Structure

```
├── firmware/
│   ├── rfid_reader_station/    # Gate Reader ESP32 firmware
│   └── gps_tracker/            # GPS Tracker ESP32 firmware
├── server/
│   ├── server.js               # Express + WebSocket backend
│   └── db.js                   # SQLite database setup
├── dashboard/
│   ├── home.html              # Public landing page with admin + employee portals
│   ├── index.html              # Admin Dashboard
│   ├── login.html              # Secure login page
│   ├── employee.html           # Employee request portal
│   ├── app.js                  # Dashboard logic
│   └── style.css               # Styling
└── docs/
    ├── hardware_connections.md  # Complete wiring guide
    ├── rfid_receiver_hardware.md
    ├── gps_transmitter_hardware.md
    ├── project_guide.md
    ├── project_config_map.md
    └── friend_handoff.md

└── config/
    └── project-settings.example.json
```

## Quick Start

1. **Wire hardware** per `docs/hardware_connections.md`
2. **Flash firmware** using PlatformIO (VS Code)
3. **Start server:**
   ```bash
   cd server
   npm install
   node server.js
   ```
4. **Open Dashboard:** http://localhost:3000 (Login: `admin` / `admin`)

## Configuration

If you move the project to another PC or Wi-Fi network, start with:
- `config/project-settings.example.json`
- `docs/project_config_map.md`

Those files list the server IP, Wi-Fi values, tracker ID, and default card UIDs that must stay in sync.

## User Guide

See `docs/project_guide.md` for the full role guide, setup flow, and troubleshooting notes.

## Hardware

See [docs/hardware_connections.md](docs/hardware_connections.md) for complete wiring diagrams.

## Notes

- The old approval workflow is still present in the backend as a legacy path, but the dashboard is now role-gated around the current stable workflow.

## License

MIT
