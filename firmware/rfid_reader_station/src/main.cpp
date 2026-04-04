#include <Arduino.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <WiFi.h>

#include "hal_buttons.h"
#include "hal_buzzer.h"
#include "hal_config.h"
#include "hal_display.h"
#include "hal_rfid.h"
#include "hal_wifi.h"
Preferences prefs; // Non-volatile storage (like EEPROM but better)

// ==========================================
// GLOBAL STATE
// ==========================================
String adminCardUID = "";
String serverIP = "192.168.0.167"; // Current PC LAN IP on Wi-Fi
int serverPort = 3000;

enum AppMode { MODE_FIRST_BOOT, MODE_NORMAL, MODE_HOME_MENU, MODE_ADMIN_MENU };
AppMode appMode = MODE_NORMAL;

enum ScanState { SCAN_FIRST, SCAN_SECOND, SENDING };
ScanState scanState = SCAN_FIRST;

String scannedID1 = "";
String scannedID2 = "";
WifiProfile wifiProfiles[MAX_WIFI_PROFILES];
uint8_t wifiProfileCount = 0;
String lastSeenUid = "";
unsigned long lastSeenUidMs = 0;
unsigned long lastWifiRetryMs = 0;
const unsigned long WIFI_RETRY_INTERVAL_MS = 30000;
const unsigned long RFID_DUPLICATE_WINDOW_MS = 1500;

// Home Menu
int homeMenuIndex = 0;
const int HOME_MENU_ITEMS = 4;
const char *homeMenuLabels[] = {"Resume Scan", "WiFi Connect", "Admin Access",
                                "Exit"};

// Admin Menu
int menuIndex = 0;
const int MENU_ITEMS = 4;
const char *menuLabels[] = {"Enroll Employee", "Enroll Component",
                            "Fetch WiFi Config", "Exit"};

// ==========================================
// FUNCTION DECLARATIONS
// ==========================================
void firstBootSetup();
bool connectToWiFi(bool showUi = true);
void connectToOpenNetwork();
void resetScreen();
void sendScanToServer();
void enterHomeMenu();
void enterAdminMenu();
void enterSetupAccess();
void drawHomeMenu();
void drawMenu();
void handleHomeMenuAction();
void handleMenuAction();
void enrollCard(const char *type);
void fetchWiFiFromServer();
bool fetchWiFiFromServerInternal(bool interactiveOpenNetwork,
                                 bool showUi = true);
void updateWiFiBackground();
void waitForButtonRelease(unsigned long maxWaitMs = 1500);
void drawWiFiStatusIcon(int16_t x, int16_t y, bool connected);
bool consumeButtonPress(uint8_t pin, unsigned long debounceMs = 35,
                        unsigned long releaseTimeoutMs = 1200);
String pollRFIDCard();
String getWiFiLabel();
void openHomeWiFiMenu();

// ==========================================
// SETUP
// ==========================================
void setup() {
  Serial.begin(115200);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);

  initButtons();
  initBuzzer();
  initDisplay();
  initRFID();

  // Load saved settings from flash memory
  prefs.begin("inventory", false);
  adminCardUID = prefs.getString("adminUID", "");
  loadWifiProfiles(prefs, wifiProfiles, wifiProfileCount);

  // ---- FIRST BOOT CHECK ----
  if (adminCardUID == "") {
    appMode = MODE_FIRST_BOOT;
    firstBootSetup();
  }

  // Connect to WiFi
  if (wifiProfileCount > 0) {
    connectToWiFi();
  } else {
    showMessage("No WiFi Saved!", "SELECT = Main Menu", "Choose WiFi");
    delay(1200);
  }

  resetScreen();
}

// ==========================================
// MAIN LOOP
// ==========================================
void loop() {
  logButtonStateChanges();

  if (scanState == SCAN_FIRST && appMode == MODE_NORMAL &&
      consumeButtonPress(BTN_SELECT)) {
    enterHomeMenu();
    resetScreen();
    return;
  }

  updateWiFiBackground();

  String uid = pollRFIDCard();
  if (uid == "")
    return;

  beep(1);

  if (scanState == SCAN_FIRST) {
    if (uid == adminCardUID) {
      // Admin card detected — give 2-second window to confirm admin mode
      // If no button pressed, treat as normal employee scan for transactions
      showMessage("Admin Card", "SEL = Admin Menu", "Wait = Normal Scan");
      beep(1);

      unsigned long confirmTimeout = millis();
      bool adminConfirmed = false;
      while (millis() - confirmTimeout < 2000) {
        logButtonStateChanges();
        if (consumeButtonPress(BTN_SELECT)) {
          adminConfirmed = true;
          break;
        }
        delay(20);
      }

      if (adminConfirmed) {
        showMessage("Admin Card", "Setup Access", "Opening menu...");
        beep(2);
        delay(350);
        enterAdminMenu();
        lastSeenUid = adminCardUID;
        lastSeenUidMs = millis();
        resetScreen();
        return;
      }

      // Not confirmed — treat as normal employee scan
      Serial.println("Admin card used as employee scan");
    }

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
    logButtonStateChanges();
    uid = pollRFIDCard();
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
  showMessage("Setup WiFi?", "SELECT = WiFi Menu", "BACK = Skip");

  unsigned long timeout = millis();
  while (millis() - timeout < 10000) {
    logButtonStateChanges();

    if (consumeButtonPress(BTN_SELECT)) {
      openHomeWiFiMenu();
      break;
    }
    if (consumeButtonPress(BTN_SETUP)) {
      break;
    }
  }

  appMode = MODE_NORMAL;
}

// ==========================================
// ADMIN MENU (GFM MODE)
// ==========================================
void enterHomeMenu() {
  appMode = MODE_HOME_MENU;
  homeMenuIndex = 0;
  drawHomeMenu();
  waitForButtonRelease();

  while (appMode == MODE_HOME_MENU) {
    logButtonStateChanges();

    if (consumeButtonPress(BTN_UP)) {
      homeMenuIndex = (homeMenuIndex - 1 + HOME_MENU_ITEMS) % HOME_MENU_ITEMS;
      drawHomeMenu();
      continue;
    }

    if (consumeButtonPress(BTN_DOWN)) {
      homeMenuIndex = (homeMenuIndex + 1) % HOME_MENU_ITEMS;
      drawHomeMenu();
      continue;
    }

    if (consumeButtonPress(BTN_SELECT)) {
      handleHomeMenuAction();
      if (appMode == MODE_HOME_MENU) {
        drawHomeMenu();
      }
      continue;
    }

    if (consumeButtonPress(BTN_SETUP)) {
      appMode = MODE_NORMAL;
      break;
    }

    delay(25);
  }
}

void drawHomeMenu() {
  display.clearDisplay();
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("=== MAIN MENU ===");
  display.print("WiFi: ");
  display.println(getWiFiLabel());
  display.println("");

  for (int i = 0; i < HOME_MENU_ITEMS; i++) {
    display.print(i == homeMenuIndex ? "> " : "  ");
    display.println(homeMenuLabels[i]);
  }

  display.println("");
  display.println("UP/DN Move  SEL OK");
  display.println("BACK Exit");
  display.display();
}

void handleHomeMenuAction() {
  switch (homeMenuIndex) {
  case 0:
    appMode = MODE_NORMAL;
    break;
  case 1:
    openHomeWiFiMenu();
    break;
  case 2:
    appMode = MODE_NORMAL;
    enterSetupAccess();
    break;
  case 3:
    appMode = MODE_NORMAL;
    break;
  }
}

void enterAdminMenu() {
  appMode = MODE_ADMIN_MENU;
  menuIndex = 0;
  drawMenu();
  waitForButtonRelease();
  unsigned long ignoreInputUntil = millis() + 400;

  while (appMode == MODE_ADMIN_MENU) {
    logButtonStateChanges();

    if (millis() < ignoreInputUntil) {
      delay(20);
      continue;
    }

    // UP button
    if (consumeButtonPress(BTN_UP)) {
      menuIndex = (menuIndex - 1 + MENU_ITEMS) % MENU_ITEMS;
      drawMenu();
    }

    // DOWN button
    if (consumeButtonPress(BTN_DOWN)) {
      menuIndex = (menuIndex + 1) % MENU_ITEMS;
      drawMenu();
    }

    // SELECT button
    if (consumeButtonPress(BTN_SELECT)) {
      handleMenuAction();
      if (appMode == MODE_ADMIN_MENU)
        drawMenu();
    }

    // BACK button exits menu immediately
    if (consumeButtonPress(BTN_SETUP)) {
      appMode = MODE_NORMAL;
    }

    delay(50);
  }
}

void enterSetupAccess() {
  beep(3);
  showMessage("SETUP ACCESS", "", "Scan Admin Card...");
  waitForButtonRelease();

  // Wait for Admin Card scan (10 second timeout)
  unsigned long timeout = millis();
  String scanned = "";
  while (millis() - timeout < 10000) {
    logButtonStateChanges();
    scanned = pollRFIDCard();
    if (scanned != "")
      break;
    delay(50);
  }

  if (scanned == adminCardUID) {
    beep(2);
    waitForButtonRelease();
    enterAdminMenu();
    lastSeenUid = adminCardUID;
    lastSeenUidMs = millis();
  } else if (scanned != "") {
    showMessage("ACCESS DENIED", "", "Wrong Card!");
    beep(1);
    delay(2000);
  } else {
    showMessage("TIMEOUT", "", "No card scanned");
    delay(1500);
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
  display.println("Exit=Menu item #4");
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
    uid = pollRFIDCard();
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
void fetchWiFiFromServer() { fetchWiFiFromServerInternal(true, true); }

bool fetchWiFiFromServerInternal(bool interactiveOpenNetwork, bool showUi) {
  if (showUi) {
    showMessage("FETCH WiFi", "Connecting to", "open network...");
    delay(800);
  } else {
    Serial.println("[WiFi] Provisioning skipped: user must select network.");
  }

  // If not connected, try to find an open network
  if (WiFi.status() != WL_CONNECTED) {
    if (interactiveOpenNetwork) {
      connectToOpenNetwork();
    } else {
      if (showUi) {
        showMessage("No Open WiFi", "Use WiFi menu", "Choose network");
        delay(1200);
      }
      return false;
    }
  }

  if (WiFi.status() != WL_CONNECTED) {
    if (showUi) {
      showMessage("FAILED!", "No network found", "Try again later.");
      delay(1500);
    } else {
      Serial.println("[WiFi] Background provisioning skipped: no network.");
    }
    return false;
  }

  if (showUi) {
    showMessage("Connected!", "Fetching WiFi", "from Dashboard...");
  } else {
    Serial.println("[WiFi] Connected to bootstrap network. Fetching profiles.");
  }

  HTTPClient http;
  String url =
      "http://" + serverIP + ":" + String(serverPort) + "/api/wifi-config";
  http.begin(url);
  int code = http.GET();
  bool fetchSuccess = false;

  if (code == 200) {
    String resp = http.getString();

    WifiProfile fetchedProfiles[MAX_WIFI_PROFILES];
    uint8_t fetchedCount = 0;

    if (parseWifiProfilesResponse(resp, fetchedProfiles, fetchedCount)) {
      saveWifiProfiles(prefs, fetchedProfiles, fetchedCount);
      loadWifiProfiles(prefs, wifiProfiles, wifiProfileCount);

      if (showUi) {
        showMessage("WiFi SAVED!", String(wifiProfileCount) + " profile(s)",
                    "Reconnecting...");
      } else {
        Serial.printf("[WiFi] Saved %u WiFi profile(s).\n", wifiProfileCount);
      }
      if (showUi) {
        beep(3);
        delay(1200);
      }

      WiFi.disconnect();
      delay(showUi ? 500 : 250);
      connectToWiFi(showUi);
      fetchSuccess = (WiFi.status() == WL_CONNECTED);
    } else {
      if (showUi) {
        showMessage("PARSE ERROR", "Bad response", resp.substring(0, 30));
        delay(1500);
      } else {
        Serial.println("[WiFi] Failed to parse dashboard WiFi profiles.");
      }
    }
  } else {
    if (showUi) {
      showMessage("FETCH FAILED", "Code: " + String(code),
                  "Check Dashboard API");
      delay(1500);
    } else {
      Serial.printf("[WiFi] Dashboard fetch failed with code %d.\n", code);
    }
  }

  http.end();
  if (!fetchSuccess && wifiProfileCount == 0 && WiFi.status() == WL_CONNECTED) {
    WiFi.disconnect();
  }
  return fetchSuccess;
}

// ==========================================
// WIFI CONNECTIONS
// ==========================================
bool connectToWiFi(bool showUi) {
  if (wifiProfileCount == 0) {
    if (showUi) {
      showMessage("No WiFi profiles", "Open WiFi Connect", "from main menu");
      delay(1500);
    }
    return false;
  }

  if (showUi) {
    showMessage("Connecting WiFi", "Trying saved", "profiles...");
  } else {
    Serial.println("[WiFi] Retrying saved profiles in background.");
  }

  if (connectToSavedWifi(wifiProfiles, wifiProfileCount)) {
    if (showUi) {
      showMessage("WiFi Connected!", WiFi.localIP().toString(),
                  WiFi.SSID().substring(0, 20));
      delay(1200);
    } else {
      Serial.println("[WiFi] Reconnected to " + WiFi.SSID());
    }
    return true;
  } else {
    Serial.println("\nWiFi Connection Failed");
    if (showUi) {
      showMessage("WiFi Failed!", "Auto retry enabled", "Use WiFi Connect");
      delay(1500);
    }
  }

  return false;
}

void updateWiFiBackground() {
  unsigned long now = millis();

  if (WiFi.status() == WL_CONNECTED || scanState != SCAN_FIRST ||
      appMode != MODE_NORMAL) {
    return;
  }

  if (wifiProfileCount > 0 && now - lastWifiRetryMs >= WIFI_RETRY_INTERVAL_MS) {
    lastWifiRetryMs = now;
    connectToWiFi(false);
  }
}

void waitForButtonRelease(unsigned long maxWaitMs) {
  unsigned long start = millis();
  while (millis() - start < maxWaitMs) {
    bool anyPressed =
        (digitalRead(BTN_UP) == LOW) || (digitalRead(BTN_DOWN) == LOW) ||
        (digitalRead(BTN_SELECT) == LOW) || (digitalRead(BTN_SETUP) == LOW);
    if (!anyPressed) {
      delay(40);
      return;
    }
    delay(20);
  }
}

void drawWiFiStatusIcon(int16_t x, int16_t y, bool connected) {
  if (connected) {
    display.drawCircle(x, y, 6, SSD1306_WHITE);
    display.drawCircle(x, y, 4, SSD1306_WHITE);
    display.drawCircle(x, y, 2, SSD1306_WHITE);
    display.fillCircle(x, y + 7, 1, SSD1306_WHITE);
  } else {
    display.drawCircle(x, y, 6, SSD1306_WHITE);
    display.drawLine(x - 7, y + 8, x + 7, y - 6, SSD1306_WHITE);
  }
}

bool consumeButtonPress(uint8_t pin, unsigned long debounceMs,
                        unsigned long releaseTimeoutMs) {
  if (digitalRead(pin) != LOW) {
    return false;
  }

  delay(debounceMs);
  if (digitalRead(pin) != LOW) {
    return false;
  }

  unsigned long start = millis();
  while (digitalRead(pin) == LOW && millis() - start < releaseTimeoutMs) {
    logButtonStateChanges();
    delay(10);
  }

  delay(25);
  return true;
}

String pollRFIDCard() {
  String uid = readRFIDCard();
  if (uid == "") {
    return "";
  }

  unsigned long now = millis();
  if (uid == lastSeenUid && now - lastSeenUidMs < RFID_DUPLICATE_WINDOW_MS) {
    return "";
  }

  lastSeenUid = uid;
  lastSeenUidMs = now;
  return uid;
}

String getWiFiLabel() {
  if (WiFi.status() == WL_CONNECTED) {
    String ssid = WiFi.SSID();
    return ssid.length() > 12 ? ssid.substring(0, 12) : ssid;
  }

  if (wifiProfileCount > 0) {
    return "Auto retry";
  }

  return "No profile";
}

void openHomeWiFiMenu() {
  const int WIFI_MENU_ITEMS = 4;
  const char *wifiMenu[] = {"Retry Saved WiFi", "Fetch Dashboard WiFi",
                            "Open Network", "Back"};
  int wifiMenuIndex = 0;

  waitForButtonRelease(2000);

  while (true) {
    logButtonStateChanges();

    display.clearDisplay();
    display.setTextSize(1);
    display.setCursor(0, 0);
    display.println("=== WIFI STATUS ===");
    display.print("State: ");
    display.println(WiFi.status() == WL_CONNECTED ? "CONNECTED" : "OFFLINE");
    display.print("Now: ");
    display.println(getWiFiLabel());
    display.print("Saved: ");
    display.println(String(wifiProfileCount));

    for (int i = 0; i < WIFI_MENU_ITEMS; i++) {
      display.print(i == wifiMenuIndex ? "> " : "  ");
      display.println(wifiMenu[i]);
    }

    display.display();

    if (consumeButtonPress(BTN_UP)) {
      wifiMenuIndex = (wifiMenuIndex - 1 + WIFI_MENU_ITEMS) % WIFI_MENU_ITEMS;
      continue;
    }

    if (consumeButtonPress(BTN_DOWN)) {
      wifiMenuIndex = (wifiMenuIndex + 1) % WIFI_MENU_ITEMS;
      continue;
    }

    if (consumeButtonPress(BTN_SETUP)) {
      return;
    }

    if (!consumeButtonPress(BTN_SELECT)) {
      delay(20);
      continue;
    }

    if (wifiMenuIndex == 0) {
      connectToWiFi(true);
    } else if (wifiMenuIndex == 1) {
      fetchWiFiFromServerInternal(true, true);
    } else if (wifiMenuIndex == 2) {
      connectToOpenNetwork();
    } else {
      return;
    }

    waitForButtonRelease(2000);
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
    logButtonStateChanges();

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

    if (consumeButtonPress(BTN_UP)) {
      selected = (selected - 1 + openCount) % openCount;
    }
    if (consumeButtonPress(BTN_DOWN)) {
      selected = (selected + 1) % openCount;
    }
    if (consumeButtonPress(BTN_SELECT)) {
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
    if (consumeButtonPress(BTN_SETUP)) {
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

void resetScreen() {
  display.clearDisplay();
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("Gate Reader Ready");
  drawWiFiStatusIcon(118, 9, WiFi.status() == WL_CONNECTED);
  display.println("-----------------");
  display.setTextSize(2);
  display.println("Scan Tag");
  display.setTextSize(1);
  display.print("WiFi: ");
  display.println(getWiFiLabel());
  display.println("SELECT: Main Menu");
  display.println("Scan cards below");
  display.display();

  scanState = SCAN_FIRST;
  scannedID1 = "";
  scannedID2 = "";
}
