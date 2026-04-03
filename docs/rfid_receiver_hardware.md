# RFID Gate Reader — Complete Hardware Guide (Phase 5)

This is the stationary device kept at the inventory room door. It reads employee ID cards and component tags, handles check-in/check-out logging, and now supports **Admin Enrollment Mode** with 4 hardware pushbuttons.

### Components Needed
1. **ESP32 DevKit V1** (Microcontroller)
2. **MFRC522** (RFID Reader Module)
3. **I2C OLED Display (128x64)**
4. **Active Buzzer (5V)**
5. **4x Tactile Push Buttons** (for Admin Menu navigation)
6. **Breadboard & Jumper Wires**

---

### Step 1: Connect the MFRC522 RFID Reader
The RFID reader uses the SPI protocol and requires **3.3V** power.

| MFRC522 Pin | ESP32 Pin | Note |
|-------------|-----------|------|
| **3.3V**    | **3V3**   | **DO NOT connect to 5V (VIN)! It will burn.** |
| **GND**     | **GND**   | Ground |
| **RST**     | **D16**   | Reset |
| **MISO**    | **D17**   | SPI MISO |
| **MOSI**    | **D23**   | SPI MOSI |
| **SCK**     | **D18**   | SPI Clock |
| **SDA (SS)**| **D19**   | SPI Chip Select |

### Step 2: Connect the I2C OLED Display
The OLED module uses I2C communication and safely runs on 3.3V.

| OLED Pin | ESP32 Pin |
|-------------|-----------|
| **GND**     | **GND**   |
| **VCC**     | **3V3** (or VIN) |
| **SDA**     | **D21**   |
| **SCL**     | **D22**   |

### Step 3: Buzzer
1. **Buzzer Positive (+):** Connect to **ESP32 D4 (GPIO 4)**.
2. **Buzzer Negative (-):** Connect to **ESP32 GND**.

### Step 4: Connect the 4 Navigation Buttons (NEW — Phase 5)
Each button connects between the ESP32 GPIO pin and **GND**. No external resistors are needed (we use the ESP32's internal pull-up resistors in code).

| Button | ESP32 Pin | Function |
|--------|-----------|----------|
| **UP**     | **D25 (GPIO 25)** | Navigate menu UP |
| **DOWN**   | **D26 (GPIO 26)** | Navigate menu DOWN |
| **SELECT** | **D27 (GPIO 27)** | Confirm / Enter, hold 3s for Setup/Admin |
| **BACK**   | **D14 (GPIO 14)** | Back / Exit / Cancel |

**Wiring for each button:**
```
ESP32 GPIO Pin ──────┐
                     │
                  [BUTTON]
                     │
ESP32 GND ───────────┘
```

> [!TIP]
> All 4 buttons are wired identically: one leg to the GPIO pin, other leg to GND. The ESP32 code uses `INPUT_PULLUP` mode so no extra resistor is needed.

---

### Complete Pin Summary

| ESP32 Pin | Connected To | Purpose |
|-----------|-------------|---------|
| **3V3**   | MFRC522 VCC, OLED VCC | Power (3.3V) |
| **GND**   | Everything | Common Ground |
| **D18**   | MFRC522 SCK | SPI Clock |
| **D17**   | MFRC522 MISO | SPI Data |
| **D23**   | MFRC522 MOSI | SPI Data |
| **D19**   | MFRC522 SDA | SPI Chip Select |
| **D16**   | MFRC522 RST | RFID Reset |
| **D21**   | OLED SDA | I2C Data |
| **D22**   | OLED SCL | I2C Clock |
| **D4**    | Buzzer (+) | Audio Feedback |
| **D25**   | UP Button | Menu Navigation |
| **D26**   | DOWN Button | Menu Navigation |
| **D27**   | SELECT Button | Confirm Action / Hold 3s Setup |
| **D14**   | BACK Button | Back / Exit / Cancel |

### Powering the Unit
Plug the ESP32 into a standard USB phone charger or your laptop. Since it stays at the inventory room, it does not need a battery.
