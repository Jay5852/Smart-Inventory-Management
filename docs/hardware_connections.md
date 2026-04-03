# Smart Inventory Management System — Complete Hardware Connections

This is the **single master reference** for ALL hardware wiring in this project. Print this page before starting assembly.

---

## 🔵 DEVICE 1: RFID Gate Reader (ESP32 #1)
*Stays at the inventory room door. Scans employee cards and component tags.*

### Components
- ESP32 DevKit V1
- MFRC522 RFID Reader
- 128x64 I2C OLED Display
- Active Buzzer (5V)
- 4x Tactile Push Buttons

### Complete Pin Map

| ESP32 Pin | Connected To | Module | Purpose |
|-----------|-------------|--------|---------|
| **3V3** | VCC | MFRC522 | ⚠️ Must be 3.3V, NOT 5V! |
| **GND** | GND | ALL modules | Common ground |
| **D18** | SCK | MFRC522 | SPI Clock |
| **D17** | MISO | MFRC522 | SPI Data In |
| **D23** | MOSI | MFRC522 | SPI Data Out |
| **D19** | SDA (SS) | MFRC522 | SPI Chip Select |
| **D16** | RST | MFRC522 | Reset |
| **D21** | SDA | OLED | I2C Data |
| **D22** | SCL | OLED | I2C Clock |
| **D4** | (+) | Buzzer | Audio feedback |
| **D25** | Leg 1 | UP Button | Menu UP (other leg → GND) |
| **D26** | Leg 1 | DOWN Button | Menu DOWN (other leg → GND) |
| **D27** | Leg 1 | SELECT Button | Hold 3s = Setup/Admin Mode (other leg → GND) |
| **D14** | Leg 1 | BACK Button | Exit/Cancel (other leg → GND) |

### Button Wiring Diagram
```
ESP32 GPIO ──────┐
                 │
              [BUTTON]
                 │
ESP32 GND ───────┘
```
No external resistors needed. Code uses `INPUT_PULLUP`.

---

## 🟢 DEVICE 2: GPS Tracker (ESP32 #2)
*Attaches to expensive equipment. Tracks location via WiFi or cellular (SIM800L).*

### Components
- ESP32 DevKit V1
- NEO-6M GPS Module (with ceramic antenna)
- SIM800L GPRS Module (for cellular fallback — keep wired even if testing WiFi only)
- 3.7V Li-Po Battery (2000mAh recommended)
- TP4056 Charging Module
- LM2596 Step-Down (Optional, for stable 4.0V to SIM800L)

### Complete Pin Map

| ESP32 Pin | Connected To | Module | Purpose |
|-----------|-------------|--------|---------|
| **VIN (5V)** | VCC | NEO-6M | GPS power (needs 5V for stable lock) |
| **GND** | GND | ALL modules | Common ground |
| **D26 (RX2)** | TX | NEO-6M | GPS data → ESP32 |
| **D27 (TX2)** | RX | NEO-6M | ESP32 → GPS (optional) |
| **D33 (RX1)** | RXD | SIM800L | GSM data → ESP32 |
| **D32 (TX1)** | TXD | SIM800L | ESP32 → GSM |

### ⚠️ SIM800L Power (CRITICAL!)
**DO NOT power SIM800L from ESP32 pins!** It draws 2A peaks and will crash your ESP32.

| SIM800L Pin | Connect To | Note |
|-------------|-----------|------|
| **VCC** | **Battery (+)** directly, or LM2596 output set to 4.0V | Must be 3.7V–4.2V, 2A capable |
| **GND** | **Common GND** with ESP32 and Battery | MUST share ground |

### Battery & Charging
```
Battery(+) ─── TP4056 B+ ─── TP4056 OUT+ ─── ESP32 VIN
Battery(-) ─── TP4056 B- ─── TP4056 OUT- ─── ESP32 GND
                                     │
                              SIM800L VCC (tap directly from Battery+ or OUT+)
                              SIM800L GND (tap directly from common GND)
```

### Status LEDs
| LED | Meaning |
|-----|---------|
| NEO-6M solid | Searching for satellites |
| NEO-6M blinking (1/sec) | ✅ GPS lock acquired! |
| SIM800L fast blink | Searching for cellular network |
| SIM800L slow blink (3/sec) | ✅ Connected to network! |

---

## 📌 Quick Reference — All Pins Used

### Gate Reader ESP32
```
Used:   D4, D14, D16, D17, D18, D19, D21, D22, D23, D25, D26, D27
Free:   D0, D2, D5, D12, D13, D15, D32, D33, D34, D35
```

### GPS Tracker ESP32
```
Used:   D26, D27, D32, D33, VIN
Free:   D0, D2, D4, D5, D12, D13, D14, D15, D18, D19, D21, D22, D23, D25, D34, D35
```
