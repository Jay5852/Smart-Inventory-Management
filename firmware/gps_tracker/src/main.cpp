#define TINY_GSM_MODEM_SIM800

#include <Arduino.h>
#include <ArduinoHttpClient.h>
#include <Preferences.h>
#include <TinyGPSPlus.h>
#include <TinyGsmClient.h>
#include <WiFi.h>

// --- Tracking Configuration ---
String TRACKER_ID = "COMP-ROUTER-001";
const int UPDATE_INTERVAL_MS = 15000;
const float MAX_ACCEPTABLE_HDOP = 8.0;
const char *FIRMWARE_VERSION = "gps-tracker-1.0.0";
const float DEFAULT_ACCURACY_GOOD = 20.0f;
const float DEFAULT_ACCURACY_FAIR = 35.0f;
const float DEFAULT_ACCURACY_POOR = 60.0f;
const int MIN_SATELLITES_FOR_FALLBACK = 4;
const unsigned long MAX_FIX_AGE_MS = 15000;
const unsigned long WIFI_RETRY_INTERVAL_MS = 30000;
const float UNUSABLE_HDOP_SENTINEL = 90.0f;

// --- Networking Credentials ---
String wifiSsid = "VISHAL";
String wifiPassword = "11111111";
const char apn[] = "internet"; // Standard APN
const char gprsUser[] = "";
const char gprsPass[] = "";

// --- Server API Endpoint ---
String configuredServerHost = "10.13.125.209"; // Manual fallback host
int configuredServerPort = 3000;
bool useGatewayServer = true;
String lastKnownServerHost = "";
const char *serverPath = "/api/tracking";

// --- Hardware Serial Definitions ---
TinyGPSPlus gps;
HardwareSerial gpsSerial(2);
const int GPS_RX_PIN = 26;
const int GPS_TX_PIN = 27;

HardwareSerial gsmSerial(1);
const int GSM_RX_PIN = 33;
const int GSM_TX_PIN = 32;
TinyGsm modem(gsmSerial);

unsigned long lastSendTime = 0;
unsigned long lastGpsDiagTime = 0;
unsigned long lastWifiRetryTime = 0;
unsigned long lastGpsRejectLogTime = 0;
uint32_t gpsBytesSeen = 0;
Preferences prefs;

void connectToWifiStation();
String getGatewayServerHost();
int buildServerCandidates(String candidates[], int maxCandidates);
int sendPayloadOverWiFiAuto(const String &payload, String &usedHost);
int sendPayloadOverGsmAuto(const String &payload, String &usedHost);

void saveRuntimeConfig() {
  prefs.putString("ssid", wifiSsid);
  prefs.putString("password", wifiPassword);
  prefs.putString("serverHost", configuredServerHost);
  prefs.putInt("serverPort", configuredServerPort);
  prefs.putBool("serverUseGw", useGatewayServer);
  prefs.putString("serverLast", lastKnownServerHost);
}

void loadRuntimeConfig() {
  wifiSsid = prefs.getString("ssid", wifiSsid);
  wifiPassword = prefs.getString("password", wifiPassword);
  configuredServerHost = prefs.getString("serverHost", configuredServerHost);
  configuredServerPort = prefs.getInt("serverPort", configuredServerPort);
  useGatewayServer = prefs.getBool("serverUseGw", true);
  lastKnownServerHost = prefs.getString("serverLast", "");
}

String getGatewayServerHost() {
  if (WiFi.status() != WL_CONNECTED) {
    return "";
  }

  IPAddress gateway = WiFi.gatewayIP();
  if (gateway[0] == 0 && gateway[1] == 0 && gateway[2] == 0 && gateway[3] == 0) {
    return "";
  }

  return gateway.toString();
}

int buildServerCandidates(String candidates[], int maxCandidates) {
  int candidateCount = 0;

  auto addCandidate = [&](const String &host) {
    if (host == "") {
      return;
    }

    for (int index = 0; index < candidateCount; index++) {
      if (candidates[index] == host) {
        return;
      }
    }

    if (candidateCount < maxCandidates) {
      candidates[candidateCount++] = host;
    }
  };

  addCandidate(lastKnownServerHost);
  if (useGatewayServer) {
    addCandidate(getGatewayServerHost());
  }
  addCandidate(configuredServerHost);

  return candidateCount;
}

int sendPayloadOverWiFiAuto(const String &payload, String &usedHost) {
  String candidates[3];
  int candidateCount = buildServerCandidates(candidates, 3);

  for (int index = 0; index < candidateCount; index++) {
    String host = candidates[index];
    WiFiClient wifiClient;
    HttpClient http(wifiClient, host.c_str(), configuredServerPort);

    http.beginRequest();
    http.post(serverPath);
    http.sendHeader("Content-Type", "application/json");
    http.sendHeader("Content-Length", payload.length());
    http.beginBody();
    http.print(payload);
    http.endRequest();

    int statusCode = http.responseStatusCode();
    if (statusCode > 0) {
      if (lastKnownServerHost != host) {
        lastKnownServerHost = host;
        prefs.putString("serverLast", lastKnownServerHost);
      }
      usedHost = host;
      return statusCode;
    }
  }

  usedHost = "";
  return -1;
}

int sendPayloadOverGsmAuto(const String &payload, String &usedHost) {
  String candidates[3];
  int candidateCount = buildServerCandidates(candidates, 3);

  for (int index = 0; index < candidateCount; index++) {
    String host = candidates[index];
    TinyGsmClient gsmClient(modem);
    HttpClient http(gsmClient, host.c_str(), configuredServerPort);

    http.beginRequest();
    http.post(serverPath);
    http.sendHeader("Content-Type", "application/json");
    http.sendHeader("Content-Length", payload.length());
    http.beginBody();
    http.print(payload);
    http.endRequest();

    int statusCode = http.responseStatusCode();
    http.stop();
    if (statusCode > 0) {
      if (lastKnownServerHost != host) {
        lastKnownServerHost = host;
        prefs.putString("serverLast", lastKnownServerHost);
      }
      usedHost = host;
      return statusCode;
    }
  }

  usedHost = "";
  return -1;
}

String getActiveServerHost() {
  if (useGatewayServer && WiFi.status() == WL_CONNECTED) {
    IPAddress gateway = WiFi.gatewayIP();
    if (!(gateway[0] == 0 && gateway[1] == 0 && gateway[2] == 0 &&
          gateway[3] == 0)) {
      return gateway.toString();
    }
  }

  return configuredServerHost;
}

void printRuntimeConfigHelp() {
  Serial.println("[CFG] Commands:");
  Serial.println("[CFG] SHOW");
  Serial.println("[CFG] MODE GATEWAY");
  Serial.println("[CFG] MODE MANUAL");
  Serial.println("[CFG] HOST <ip-or-host>");
  Serial.println("[CFG] PORT <1-65535>");
  Serial.println("[CFG] WIFI <ssid>|<password>");
  Serial.println("[CFG] HELP");
}

void printRuntimeConfigStatus() {
  Serial.println("[CFG] --- Tracker Config ---");
  Serial.println("[CFG] WiFi SSID: " + wifiSsid);
  Serial.println("[CFG] Server mode: " +
                 String(useGatewayServer ? "GATEWAY" : "MANUAL"));
  Serial.println("[CFG] Manual host: " + configuredServerHost);
  Serial.println("[CFG] Last good host: " +
                 String(lastKnownServerHost == "" ? "(none)"
                                                  : lastKnownServerHost));
  Serial.println("[CFG] Active host: " + getActiveServerHost());
  Serial.println("[CFG] Port: " + String(configuredServerPort));
}

void processRuntimeSerialCommands() {
  if (!Serial.available()) {
    return;
  }

  String raw = Serial.readStringUntil('\n');
  raw.trim();
  if (raw == "") {
    return;
  }

  String command = raw;
  command.toUpperCase();

  if (command == "HELP") {
    printRuntimeConfigHelp();
    return;
  }

  if (command == "SHOW") {
    printRuntimeConfigStatus();
    return;
  }

  if (command == "MODE GATEWAY") {
    useGatewayServer = true;
    saveRuntimeConfig();
    Serial.println("[CFG] Mode set to GATEWAY.");
    printRuntimeConfigStatus();
    return;
  }

  if (command == "MODE MANUAL") {
    useGatewayServer = false;
    saveRuntimeConfig();
    Serial.println("[CFG] Mode set to MANUAL.");
    printRuntimeConfigStatus();
    return;
  }

  if (command.startsWith("HOST ")) {
    String hostValue = raw.substring(5);
    hostValue.trim();
    if (hostValue == "") {
      Serial.println("[CFG] Host cannot be empty.");
      return;
    }

    configuredServerHost = hostValue;
    useGatewayServer = false;
    saveRuntimeConfig();
    Serial.println("[CFG] Manual host updated.");
    printRuntimeConfigStatus();
    return;
  }

  if (command.startsWith("PORT ")) {
    String portValue = raw.substring(5);
    portValue.trim();
    int parsedPort = portValue.toInt();
    if (parsedPort <= 0 || parsedPort > 65535) {
      Serial.println("[CFG] Invalid port. Use 1-65535.");
      return;
    }

    configuredServerPort = parsedPort;
    saveRuntimeConfig();
    Serial.println("[CFG] Port updated.");
    printRuntimeConfigStatus();
    return;
  }

  if (command.startsWith("WIFI ")) {
    String wifiPayload = raw.substring(5);
    int splitIndex = wifiPayload.indexOf('|');
    if (splitIndex <= 0 || splitIndex >= wifiPayload.length() - 1) {
      Serial.println("[CFG] Use WIFI <ssid>|<password>");
      return;
    }

    String newSsid = wifiPayload.substring(0, splitIndex);
    String newPassword = wifiPayload.substring(splitIndex + 1);
    newSsid.trim();
    newPassword.trim();

    if (newSsid == "") {
      Serial.println("[CFG] SSID cannot be empty.");
      return;
    }

    wifiSsid = newSsid;
    wifiPassword = newPassword;
    saveRuntimeConfig();
    Serial.println("[CFG] WiFi credentials updated. Reconnecting...");
    WiFi.disconnect();
    delay(200);
    connectToWifiStation();
    return;
  }

  Serial.println("[CFG] Unknown command. Type HELP.");
}

void connectToWifiStation() {
  lastWifiRetryTime = millis();
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.disconnect();
  delay(200);
  WiFi.begin(wifiSsid.c_str(), wifiPassword.c_str());
  Serial.print("Connecting to Wi-Fi");

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 10) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[Wi-Fi] Connected! IP: " + WiFi.localIP().toString());
  } else {
    Serial.println("\n[Wi-Fi] Not detected. Will fallback to GSM.");
  }
}

void ensureWifiConnected() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  if (millis() - lastWifiRetryTime < WIFI_RETRY_INTERVAL_MS) {
    return;
  }

  lastWifiRetryTime = millis();
  connectToWifiStation();
}

bool hasUsableHdop(float hdop) {
  return hdop > 0.0f && hdop < UNUSABLE_HDOP_SENTINEL;
}

void logGpsReject(const String &message) {
  if (millis() - lastGpsRejectLogTime < 4000) {
    return;
  }

  lastGpsRejectLogTime = millis();
  Serial.println(message);
}

void setup() {
  Serial.begin(115200);
  prefs.begin("gpscfg", false);
  loadRuntimeConfig();

  // Initialize GPS
  gpsSerial.begin(9600, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);

  // Initialize SIM800L
  gsmSerial.begin(9600, SERIAL_8N1, GSM_RX_PIN, GSM_TX_PIN);

  Serial.println("\n==================================");
  Serial.println("DUAL-MODE GPS TRACKER STARTED");
  Serial.println("==================================");
  printRuntimeConfigStatus();
  printRuntimeConfigHelp();

  connectToWifiStation();
}

void loop() {
  processRuntimeSerialCommands();

  // 1. Process GPS Data Continuously
  uint16_t bytesReadThisLoop = 0;
  while (gpsSerial.available() > 0) {
    gps.encode(gpsSerial.read());
    bytesReadThisLoop++;
  }
  gpsBytesSeen += bytesReadThisLoop;

  if (millis() - lastGpsDiagTime > 3000) {
    lastGpsDiagTime = millis();
    Serial.printf("[GPS LINK] bytes_recent=%u total=%lu chars=%lu sentences=%lu valid=%s\n",
                  bytesReadThisLoop, gpsBytesSeen, gps.charsProcessed(),
                  gps.sentencesWithFix(), gps.location.isValid() ? "YES" : "NO");

    if (gps.charsProcessed() < 10) {
      Serial.println("[GPS LINK] No GPS serial data yet. Check TX/RX wiring, power, and baud (9600).");
    }
  }

  // 2. Transmit Location Data at Intervals
  if (millis() - lastSendTime > UPDATE_INTERVAL_MS) {
    lastSendTime = millis();
    ensureWifiConnected();

    if (gps.location.isValid()) {
      if (gps.location.age() > MAX_FIX_AGE_MS) {
        Serial.printf("[GPS] Location age is %lu ms; continuing with last valid fix.\n",
                      static_cast<unsigned long>(gps.location.age()));
      }

      float rawLat = gps.location.lat();
      float rawLng = gps.location.lng();
      bool hdopReported = gps.hdop.isValid();
      float reportedHdop = hdopReported ? gps.hdop.hdop() : -1.0f;
      bool hdopUsable = hdopReported && hasUsableHdop(reportedHdop);
      int satellites = gps.satellites.isValid() ? gps.satellites.value() : 0;
      float accuracyMeters = 0.0f;

      if (satellites < MIN_SATELLITES_FOR_FALLBACK) {
        Serial.printf("[GPS] Warning: Low satellite count (%d). Sending anyway.\n", satellites);
      }

      if (hdopUsable && reportedHdop > MAX_ACCEPTABLE_HDOP) {
        logGpsReject("High GPS error warning. HDOP: " +
                     String(reportedHdop, 2) +
                     " - using satellite fallback accuracy.");
        hdopUsable = false;
      }

      if (hdopUsable) {
        accuracyMeters = reportedHdop * 5.0f;
      } else if (satellites >= 8) {
        accuracyMeters = DEFAULT_ACCURACY_GOOD;
      } else if (satellites >= 5) {
        accuracyMeters = DEFAULT_ACCURACY_FAIR;
      } else {
        accuracyMeters = DEFAULT_ACCURACY_POOR;
      }
      float speedKmh = gps.speed.isValid() ? gps.speed.kmph() : 0.0f;
      float headingDegrees = gps.course.isValid() ? gps.course.deg() : 0.0f;

      if (!hdopUsable) {
        Serial.printf("⚠️ HDOP unavailable/unusable, using satellite fallback (hdop=%.2f, sats=%d, estAcc=%.1fm)\n",
                      reportedHdop, satellites, accuracyMeters);
      } else {
        Serial.printf("GPS fix accepted (HDOP: %.2f, sats=%d, estAcc=%.1fm)\n",
                      reportedHdop, satellites, accuracyMeters);
      }

      if (rawLat == 0.0f && rawLng == 0.0f) {
        logGpsReject("[GPS] Ignoring zero-coordinate fix.");
        return;
      }

      // Exponential Moving Average (EMA)
      static float fLat = 0, fLng = 0;
      const float alpha = 0.4;
      if (fLat == 0) {
        fLat = rawLat;
        fLng = rawLng;
      } else {
        fLat = (alpha * rawLat) + ((1.0 - alpha) * fLat);
        fLng = (alpha * rawLng) + ((1.0 - alpha) * fLng);
      }

      if (hdopUsable) {
        Serial.printf("Filtered GPS: %f, %f (HDOP: %.2f, sats=%d)\n", fLat,
                      fLng, reportedHdop, satellites);
      } else {
        Serial.printf("Filtered GPS: %f, %f (HDOP: N/A, sats=%d)\n", fLat,
                      fLng, satellites);
      }

      String payload = "{\"trackerId\":\"" + TRACKER_ID +
               "\",\"firmwareVersion\":\"" + String(FIRMWARE_VERSION) +
               "\",\"hdop\":" + String(hdopUsable ? reportedHdop : -1.0f, 2) +
               ",\"accuracyMeters\":" + String(accuracyMeters, 1) +
               ",\"speedKmh\":" + String(speedKmh, 1) +
               ",\"headingDegrees\":" + String(headingDegrees, 1) +
               ",\"lat\":" + String(fLat, 6) +
               ",\"lng\":" + String(fLng, 6) + "}";

      // Attempt Wi-Fi First
      if (WiFi.status() == WL_CONNECTED) {
        Serial.println("[Wi-Fi] Sending data over Wi-Fi...");
        String usedHost;
        int statusCode = sendPayloadOverWiFiAuto(payload, usedHost);
        Serial.printf("[Wi-Fi] Response Code: %d (host=%s)\n", statusCode,
                      usedHost.c_str());
      }
      // Fallback to Cellular GPRS
      else {
        Serial.println(
            "[Wi-Fi] Disconnected/Out of Range. Switching to GSM/GPRS...");

        if (!modem.testAT()) {
          Serial.println(
              "[GSM] Failed to communicate with SIM800L. Retrying...");
          modem.restart();
          return;
        }

        if (!modem.isNetworkConnected()) {
          Serial.println("[GSM] Waiting for cellular network...");
          if (!modem.waitForNetwork(60000L)) {
            Serial.println("[GSM] Network fetch failed.");
            return;
          }
        }

        if (!modem.isGprsConnected()) {
          Serial.println("[GSM] Connecting to GPRS Internet...");
          if (!modem.gprsConnect(apn, gprsUser, gprsPass)) {
            Serial.println("[GSM] GPRS Connection Failed.");
            return;
          }
        }

        Serial.println("[GSM] GPRS Connected. Sending data...");
        String usedHost;
        int statusCode = sendPayloadOverGsmAuto(payload, usedHost);
        Serial.printf("[GSM] Response Code: %d (host=%s)\n", statusCode,
                      usedHost.c_str());
      }

    } else {
      if (gps.location.isValid()) {
        logGpsReject("[GPS] Waiting for a fresh location update.");
      } else {
        logGpsReject("Waiting for GPS satellite lock...");
      }
    }
  }
}
