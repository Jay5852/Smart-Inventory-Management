# GPS Transmitter (Component Tracker) Hardware Guide

This is the portable device attached to your highly expensive telecommunication components. It tracks their location outdoors and sends the coordinates via Wi-Fi to your server.

### Components Needed
1. **ESP32 DevKit V1** (Microcontroller)
2. **NEO-6M GPS Module** (with ceramic antenna)
3. **SIM800L GPRS Module** (for cellular data outside Wi-Fi range)
4. **3.7V Li-Po Battery** (1000mAh minimum, 2000mAh recommended for GSM)
5. **TP4056 Lithium Battery Charging Module**
6. **LM2596 Step-Down Module** (Optional, but recommended if SIM800L resets)
7: **Breadboard** (No PCB required, you can mount everything on a standard breadboard)

> [!TIP]
> **NO CAPACITOR? NO PROBLEM:** If you don't have a big capacitor (1000uF), you must use **thick and short jumper wires** for the SIM800L VCC and GND. Long, thin wires have high resistance and will cause the module to crash. Use your highest capacity battery (2000mAh) to keep the voltage stable.

### Step 1: Connect the NEO-6M GPS Module
The NEO-6M communicates using UART (Serial2). 

| NEO-6M Pin | ESP32 Pin | Note |
|------------|-----------|------|
| **VCC**    | **VIN / 5V** | Powering from VIN ensures a stable satellite lock. |
| **GND**    | **GND**      | Ground. |
| **TX**     | **D26 (RX2)**| Transmits the GPS data from the module into the ESP32. |
| **RX**     | **D27 (TX2)**| *(Optional)* Receives commands from ESP32. |

### Step 2: Connect the SIM800L GSM Module (Phase 4)
The SIM800L requires its own UART connection (Serial1) and handles the GPRS data transmission when the component is taken out of the yard.

| SIM800L Pin | ESP32 Pin | Note |
|-------------|-----------|------|
| **VCC**     | **BAT+ / 4.0V** | **CRITICAL:** Do NOT connect to ESP32 3V3 or 5V. The SIM800L pulls 2A peaks! Connect directly to a 3.7V LiPo or use an LM2596 to drop 5V to exactly ~4.0V. |
| **GND**     | **GND**   | MUST share a common ground with the ESP32. |
| **RXD**     | **D33**   | ESP32 RX1 |
| **TXD**     | **D32**   | ESP32 TX1 |

### Step 3: Connect the Battery & Power
*(Note: Skip this step if you are just testing by plugging the ESP32 directly into your laptop via USB).*

To make the tracker portable for real-world use, you must use a battery.

1. **Battery to TP4056:**
   - Connect **Battery (+)** to **TP4056 "B+"**
   - Connect **Battery (-)** to **TP4056 "B-"**
2. **TP4056 to ESP32:**
   - Connect **TP4056 "OUT+"** to **ESP32 "VIN"** (NOT 3V3!).
   - Connect **TP4056 "OUT-"** to **ESP32 "GND"**.

### Status LEDs
- When you first take the tracker outside, the **NEO-6M** module will have a solid light.
- After 2-5 minutes, a tiny blue/red LED on the NEO-6M will begin **blinking every 1 second**. This means it has a satellite lock and is transmitting coordinates!
- The **SIM800L** red LED will flash **fast** (searching for network) and then **slowly** (every 3 seconds) when successfully connected to the cellular network.
