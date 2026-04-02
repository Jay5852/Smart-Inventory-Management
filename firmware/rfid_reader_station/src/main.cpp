#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Arduino.h>
#include <HTTPClient.h>
#include <MFRC522.h>
#include <Preferences.h>
#include <SPI.h>
#include <WiFi.h>
#include <Wire.h>

// ==========================================
// PIN DEFINITIONS
// ==========================================
#define RST_PIN 33
#define SS_PIN 14
#define BUZZER_PIN 4
#define BTN_UP 12
#define BTN_DOWN 13
#define BTN_SELECT 2
#define BTN_SETUP 15

// ==========================================
// OLED DISPLAY
// ==========================================
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET -1
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

// ==========================================
// OBJECTS
// ==========================================
MFRC522 mfrc522(SS_PIN, RST_PIN);
Preferences prefs; // Non-volatile storage (like EEPROM but better)

// ==========================================
// GLOBAL STATE
// ==========================================
String adminCardUID = "";
String savedSSID = "";
String savedPass = "";
String serverIP = "10.93.23.163";
int serverPort = 3000;

enum AppMode { MODE_FIRST_BOOT, MODE_NORMAL, MODE_ADMIN_MENU };
AppMode appMode = MODE_NORMAL;

enum ScanState { SCAN_FIRST, SCAN_SECOND, SENDING };
ScanState scanState = SCAN_FIRST;

String scannedID1 = "";
String scannedID2 = "";

// Admin Menu
int menuIndex = 0;
const int MENU_ITEMS = 4;
const char *menuLabels[] = {"Enroll Employee", "Enroll Component",
                            "Fetch WiFi Config", "Exit"};

// ==========================================
// FUNCTION DECLARATIONS
// ==========================================
void firstBootSetup();
void connectToWiFi();
void connectToOpenNetwork();
void resetScreen();
void sendScanToServer();
void enterAdminMenu();
void drawMenu();
void handleMenuAction();
void enrollCard(const char *type);
void fetchWiFiFromServer();
String readRFIDCard();
void showMessage(String line1, String line2 = "", String line3 = "");
void beep(int times);

// ==========================================
// SETUP
// ==========================================
void setup() {
  Serial.begin(115200);

  // Buttons (using internal pull-ups)
  pinMode(BTN_UP, INPUT_PULLUP);
  pinMode(BTN_DOWN, INPUT_PULLUP);
  pinMode(BTN_SELECT, INPUT_PULLUP);
  pinMode(BTN_SETUP, INPUT_PULLUP);
  pinMode(BUZZER_PIN, OUTPUT);

  // SPI & RFID
  SPI.begin(5, 27, 26, 14);
  mfrc522.PCD_Init();

  // OLED
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println(F("OLED Init Failed"));
    for (;;)
      ;
  }
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);

  // Load saved settings from flash memory
  prefs.begin("inventory", false);
  adminCardUID = prefs.getString("adminUID", "");
  savedSSID = prefs.getString("wifiSSID", "");
  savedPass = prefs.getString("wifiPass", "");

  // ---- FIRST BOOT CHECK ----
  if (adminCardUID == "") {
    appMode = MODE_FIRST_BOOT;
    firstBootSetup();
  }

  // Connect to WiFi
  if (savedSSID != "") {
    connectToWiFi();
  } else {
    showMessage("No WiFi Saved!", "Enter Admin Menu", "to setup WiFi");
    delay(2000);
  }

  resetScreen();
}

// ==========================================
// MAIN LOOP
// ==========================================
void loop() {

  // --- CHECK SETUP BUTTON (long-press 3 seconds) ---
  if (digitalRead(BTN_SETUP) == LOW) {
    unsigned long pressStart = millis();
    while (digitalRead(BTN_SETUP) == LOW) {
      if (millis() - pressStart > 3000) {
        // Long press detected! Enter Admin Mode
        beep(3);
        showMessage("ADMIN ACCESS", "", "Scan Admin Card...");

        // Wait for Admin Card scan (10 second timeout)
        unsigned long timeout = millis();
        String scanned = "";
        while (millis() - timeout < 10000) {
          scanned = readRFIDCard();
          if (scanned != "")
            break;
          delay(50);
        }

        if (scanned == adminCardUID) {
          beep(2);
          enterAdminMenu();
        } else if (scanned != "") {
          showMessage("ACCESS DENIED", "", "Wrong Card!");
          beep(1);
          delay(2000);
        } else {
          showMessage("TIMEOUT", "", "No card scanned");
          delay(1500);
        }
        resetScreen();
        return;
      }
      delay(10);
    }
  }

  // --- NORMAL SCAN MODE ---
  if (WiFi.status() != WL_CONNECTED && savedSSID != "") {
    connectToWiFi();
  }

  String uid = readRFIDCard();
  if (uid == "")
    return;

  beep(1);

  if (scanState == SCAN_FIRST) {
    scannedID1 = uid;
    Serial.println("First Card Scanned: " + uid);

    showMessage("Card 1 Scanned!", "", "Now scan Card 2");
    scanState = SCAN_SECOND;
    delay(1000);

  } else if (scanState == SCAN_SECOND) {
    if (uid == scannedID1) {
      Serial.println("Same card scanned twice, ignoring.");
      delay(500);
      return;
    }

    scannedID2 = uid;
    Serial.println("Second Card Scanned: " + uid);

    showMessage("Authenticating...", "", "Please wait.");
    scanState = SENDING;
    sendScanToServer();
  }
}

// ==========================================
// FIRST BOOT SETUP (Like a new phone)
// ==========================================
void firstBootSetup() {
  showMessage("=== WELCOME ===", "", "First-time setup!");
  delay(2000);
  showMessage("Scan any card to", "register it as", "MASTER ADMIN");

  // Wait indefinitely for a card
  String uid = "";
  while (uid == "") {
    uid = readRFIDCard();
    delay(50);
  }

  // Save to permanent memory
  adminCardUID = uid;
  prefs.putString("adminUID", adminCardUID);

  beep(3);
  showMessage("Admin Card Set!", "", uid);
  Serial.println("Master Admin UID saved: " + uid);
  delay(3000);

  // Ask to connect to WiFi now
  showMessage("Setup WiFi?", "SELECT = Open Net", "SETUP = Skip");

  unsigned long timeout = millis();
  while (millis() - timeout < 10000) {
    if (digitalRead(BTN_SELECT) == LOW) {
      delay(200);
      connectToOpenNetwork();
      break;
    }
    if (digitalRead(BTN_SETUP) == LOW) {
      delay(200);
      break;
    }
  }

  appMode = MODE_NORMAL;
}

// ==========================================
// ADMIN MENU (GFM MODE)
// ==========================================
void enterAdminMenu() {
  appMode = MODE_ADMIN_MENU;
  menuIndex = 0;
  drawMenu();

  while (appMode == MODE_ADMIN_MENU) {
    // UP button
    if (digitalRead(BTN_UP) == LOW) {
      menuIndex = (menuIndex - 1 + MENU_ITEMS) % MENU_ITEMS;
      drawMenu();
      delay(250);
    }

    // DOWN button
    if (digitalRead(BTN_DOWN) == LOW) {
      menuIndex = (menuIndex + 1) % MENU_ITEMS;
      drawMenu();
      delay(250);
    }

    // SELECT button
    if (digitalRead(BTN_SELECT) == LOW) {
      delay(200);
      handleMenuAction();
      if (appMode == MODE_ADMIN_MENU)
        drawMenu();
    }

    // SETUP/BACK button (exit menu)
    if (digitalRead(BTN_SETUP) == LOW) {
      delay(200);
      appMode = MODE_NORMAL;
    }

    delay(50);
  }
}

void drawMenu() {
  display.clearDisplay();
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("=== ADMIN MENU ===");
  display.println("");

  for (int i = 0; i < MENU_ITEMS; i++) {
    if (i == menuIndex) {
      display.print("> ");
    } else {
      display.print("  ");
    }
    display.println(menuLabels[i]);
  }

  display.println("");
  display.println("UP/DN=Move SEL=OK");
  display.display();
}

void handleMenuAction() {
  switch (menuIndex) {
  case 0:
    enrollCard("employee");
    break;
  case 1:
    enrollCard("component");
    break;
  case 2:
    fetchWiFiFromServer();
    break;
  case 3:
    appMode = MODE_NORMAL;
    break;
  }
}

// ==========================================
// CARD ENROLLMENT
// ==========================================
void enrollCard(const char *type) {
  showMessage("ENROLL MODE", String("Type: ") + type, "Scan new card...");

  String uid = "";
  unsigned long timeout = millis();
  while (uid == "" && millis() - timeout < 15000) {
    uid = readRFIDCard();
    delay(50);
  }

  if (uid == "") {
    showMessage("TIMEOUT", "No card detected");
    delay(1500);
    return;
  }

  beep(1);
  showMessage("Card: " + uid, "Enrolling...", "Please wait.");

  // Send to server
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    String url =
        "http://" + serverIP + ":" + String(serverPort) + "/api/enroll";
    http.begin(url);
    http.addHeader("Content-Type", "application/json");

    String payload =
        "{\"uid\":\"" + uid + "\",\"type\":\"" + String(type) + "\"}";
    int code = http.POST(payload);

    if (code == 200 || code == 201) {
      showMessage("ENROLLED!", uid, String(type) + " registered!");
      beep(2);
    } else {
      String resp = http.getString();
      showMessage("FAILED!", "Code: " + String(code), resp.substring(0, 20));
    }
    http.end();
  } else {
    showMessage("NO WiFi!", "Connect first", "via Fetch WiFi");
  }

  delay(2500);
}

// ==========================================
// OTA WIFI FETCH FROM DASHBOARD
// ==========================================
void fetchWiFiFromServer() {
  showMessage("FETCH WiFi", "Connecting to", "open network...");
  delay(1000);

  // If not connected, try to find an open network
  if (WiFi.status() != WL_CONNECTED) {
    connectToOpenNetwork();
  }

  if (WiFi.status() != WL_CONNECTED) {
    showMessage("FAILED!", "No network found", "Try again later.");
    delay(2000);
    return;
  }

  showMessage("Connected!", "Fetching WiFi", "from Dashboard...");

  HTTPClient http;
  String url =
      "http://" + serverIP + ":" + String(serverPort) + "/api/wifi-config";
  http.begin(url);
  int code = http.GET();

  if (code == 200) {
    String resp = http.getString();

    // Parse simple JSON like {"ssid":"MyNetwork","password":"MyPass123"}
    int ssidStart = resp.indexOf("\"ssid\":\"") + 8;
    int ssidEnd = resp.indexOf("\"", ssidStart);
    int passStart = resp.indexOf("\"password\":\"") + 12;
    int passEnd = resp.indexOf("\"", passStart);

    if (ssidStart > 8 && passStart > 12) {
      savedSSID = resp.substring(ssidStart, ssidEnd);
      savedPass = resp.substring(passStart, passEnd);

      // Save permanently
      prefs.putString("wifiSSID", savedSSID);
      prefs.putString("wifiPass", savedPass);

      showMessage("WiFi SAVED!", savedSSID, "Reconnecting...");
      beep(3);
      delay(1500);

      // Reconnect to the new secure network
      WiFi.disconnect();
      delay(500);
      connectToWiFi();
    } else {
      showMessage("PARSE ERROR", "Bad response", resp.substring(0, 20));
      delay(2000);
    }
  } else {
    showMessage("FETCH FAILED", "Code: " + String(code),
                "Set WiFi in Dashboard");
    delay(2000);
  }

  http.end();
}

// ==========================================
// WIFI CONNECTIONS
// ==========================================
void connectToWiFi() {
  showMessage("Connecting WiFi", savedSSID, "...");
  Serial.println("Connecting to: " + savedSSID);

  WiFi.begin(savedSSID.c_str(), savedPass.c_str());

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi Connected! IP: " + WiFi.localIP().toString());
    showMessage("WiFi Connected!", WiFi.localIP().toString(), "");
    delay(1500);
  } else {
    Serial.println("\nWiFi Connection Failed");
    showMessage("WiFi Failed!", "Will retry later", "or use Admin Menu");
    delay(2000);
  }
}

void connectToOpenNetwork() {
  showMessage("Scanning for", "open networks...", "");
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  delay(500);

  int n = WiFi.scanNetworks();
  Serial.println("Found " + String(n) + " networks");

  if (n == 0) {
    showMessage("No networks", "found!", "");
    delay(1500);
    return;
  }

  // Find open networks (no encryption)
  int openNets[10];
  int openCount = 0;

  for (int i = 0; i < n && openCount < 10; i++) {
    if (WiFi.encryptionType(i) == WIFI_AUTH_OPEN) {
      openNets[openCount++] = i;
    }
  }

  if (openCount == 0) {
    showMessage("No OPEN networks", "available.", "Set WiFi manually");
    delay(2000);
    return;
  }

  // Let user select from open networks using UP/DOWN/SELECT
  int selected = 0;

  while (true) {
    display.clearDisplay();
    display.setTextSize(1);
    display.setCursor(0, 0);
    display.println("Open Networks:");
    display.println("");

    // Show up to 4 networks at a time
    int startIdx = max(0, selected - 1);
    int endIdx = min(openCount, startIdx + 4);

    for (int i = startIdx; i < endIdx; i++) {
      if (i == selected)
        display.print("> ");
      else
        display.print("  ");
      display.println(WiFi.SSID(openNets[i]).substring(0, 18));
    }

    display.println("");
    display.println("SEL=Connect BACK=Cancel");
    display.display();

    // Wait for button press
    delay(100);

    if (digitalRead(BTN_UP) == LOW) {
      selected = (selected - 1 + openCount) % openCount;
      delay(200);
    }
    if (digitalRead(BTN_DOWN) == LOW) {
      selected = (selected + 1) % openCount;
      delay(200);
    }
    if (digitalRead(BTN_SELECT) == LOW) {
      delay(200);
      // Connect to selected open network
      String ssid = WiFi.SSID(openNets[selected]);
      showMessage("Connecting to", ssid, "...");

      WiFi.begin(ssid.c_str());
      int attempts = 0;
      while (WiFi.status() != WL_CONNECTED && attempts < 20) {
        delay(500);
        attempts++;
      }

      if (WiFi.status() == WL_CONNECTED) {
        showMessage("Connected!", ssid, WiFi.localIP().toString());
        beep(2);
        delay(1500);
      } else {
        showMessage("FAILED!", "Try another", "network");
        delay(1500);
      }
      return;
    }
    if (digitalRead(BTN_SETUP) == LOW) {
      delay(200);
      return; // Cancel
    }
  }
}

// ==========================================
// SEND GATE SCAN TO SERVER
// ==========================================
void sendScanToServer() {
  if (WiFi.status() != WL_CONNECTED) {
    showMessage("ERROR!", "No WiFi", "Cannot process.");
    delay(2000);
    scanState = SCAN_FIRST;
    resetScreen();
    return;
  }

  HTTPClient http;
  String url = "http://" + serverIP + ":" + String(serverPort) +
               "/api/transactions/scan";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  String payload = "{\"componentUid\":\"" + scannedID1 +
                   "\",\"employeeUid\":\"" + scannedID2 + "\"}";
  Serial.println("Sending: " + payload);

  int code = http.POST(payload);

  if (code > 0) {
    String response = http.getString();
    Serial.println("Response: " + String(code) + " " + response);

    if (code == 200 || code == 201) {
      showMessage("SUCCESS!", "", "Transaction OK");
      beep(2);
    } else {
      showMessage("DENIED!", "Code: " + String(code),
                  response.substring(0, 20));
      // Long error beep
      digitalWrite(BUZZER_PIN, HIGH);
      delay(1000);
      digitalWrite(BUZZER_PIN, LOW);
    }
  } else {
    showMessage("SERVER ERROR", "Code: " + String(code), "Check connection");
    digitalWrite(BUZZER_PIN, HIGH);
    delay(1000);
    digitalWrite(BUZZER_PIN, LOW);
  }

  http.end();
  delay(2500);
  scanState = SCAN_FIRST;
  resetScreen();
}

// ==========================================
// RFID CARD READER (Shared utility)
// ==========================================
String readRFIDCard() {
  if (!mfrc522.PICC_IsNewCardPresent() || !mfrc522.PICC_ReadCardSerial()) {
    return "";
  }

  String uid = "";
  for (byte i = 0; i < mfrc522.uid.size; i++) {
    uid += String(mfrc522.uid.uidByte[i] < 0x10 ? "0" : "");
    uid += String(mfrc522.uid.uidByte[i], HEX);
  }
  uid.toUpperCase();

  mfrc522.PICC_HaltA();
  return uid;
}

// ==========================================
// DISPLAY HELPERS
// ==========================================
void resetScreen() {
  display.clearDisplay();
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("Gate Reader Ready");
  display.println("-----------------");
  display.println("");
  display.setTextSize(2);
  display.println("Scan Tag");
  display.setTextSize(1);
  display.println("");
  display.println("SETUP: Hold 3s=Admin");
  display.display();

  scanState = SCAN_FIRST;
  scannedID1 = "";
  scannedID2 = "";
}

void showMessage(String line1, String line2, String line3) {
  display.clearDisplay();
  display.setTextSize(1);

  display.setCursor(0, 10);
  display.println(line1);
  display.println("");
  display.println(line2);
  display.println("");
  display.println(line3);

  display.display();
}

void beep(int times) {
  for (int i = 0; i < times; i++) {
    digitalWrite(BUZZER_PIN, HIGH);
    delay(100);
    digitalWrite(BUZZER_PIN, LOW);
    delay(100);
  }
}
