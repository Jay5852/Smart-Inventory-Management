#include "hal_wifi.h"

static String buildKey(const char *prefix, uint8_t index) {
  return String(prefix) + String(index);
}

void loadWifiProfiles(Preferences &prefs, WifiProfile profiles[], uint8_t &count) {
  count = prefs.getUChar("wifiCount", 0);
  if (count > MAX_WIFI_PROFILES) {
    count = MAX_WIFI_PROFILES;
  }

  for (uint8_t i = 0; i < count; i++) {
    profiles[i].ssid = prefs.getString(buildKey("wifiSSID", i).c_str(), "");
    profiles[i].password = prefs.getString(buildKey("wifiPass", i).c_str(), "");
  }
}

void saveWifiProfiles(Preferences &prefs, const WifiProfile profiles[],
                      uint8_t count) {
  if (count > MAX_WIFI_PROFILES) {
    count = MAX_WIFI_PROFILES;
  }

  prefs.putUChar("wifiCount", count);

  for (uint8_t i = 0; i < MAX_WIFI_PROFILES; i++) {
    if (i < count) {
      prefs.putString(buildKey("wifiSSID", i).c_str(), profiles[i].ssid);
      prefs.putString(buildKey("wifiPass", i).c_str(), profiles[i].password);
    } else {
      prefs.putString(buildKey("wifiSSID", i).c_str(), "");
      prefs.putString(buildKey("wifiPass", i).c_str(), "");
    }
  }
}

void clearWifiProfiles(Preferences &prefs) {
  prefs.putUChar("wifiCount", 0);
  for (uint8_t i = 0; i < MAX_WIFI_PROFILES; i++) {
    prefs.putString(buildKey("wifiSSID", i).c_str(), "");
    prefs.putString(buildKey("wifiPass", i).c_str(), "");
  }
}

bool parseWifiProfilesResponse(const String &response, WifiProfile profiles[],
                               uint8_t &count) {
  count = 0;
  int searchPos = 0;

  while (count < MAX_WIFI_PROFILES) {
    int ssidStart = response.indexOf("\"ssid\":\"", searchPos);
    if (ssidStart < 0) {
      break;
    }
    ssidStart += 8;
    int ssidEnd = response.indexOf('"', ssidStart);
    if (ssidEnd < 0) {
      break;
    }

    int passwordStart = response.indexOf("\"password\":\"", ssidEnd);
    if (passwordStart < 0) {
      break;
    }
    passwordStart += 12;
    int passwordEnd = response.indexOf('"', passwordStart);
    if (passwordEnd < 0) {
      break;
    }

    profiles[count].ssid = response.substring(ssidStart, ssidEnd);
    profiles[count].password = response.substring(passwordStart, passwordEnd);
    if (profiles[count].ssid.length() > 0) {
      count++;
    }

    searchPos = passwordEnd + 1;
  }

  return count > 0;
}

bool connectToSavedWifi(const WifiProfile profiles[], uint8_t count) {
  if (count == 0) {
    return false;
  }

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);

  for (uint8_t i = 0; i < count; i++) {
    if (profiles[i].ssid.length() == 0) {
      continue;
    }

    Serial.println("Trying WiFi: " + profiles[i].ssid);
    WiFi.disconnect(true, true);
    delay(200);
    WiFi.begin(profiles[i].ssid.c_str(), profiles[i].password.c_str());

    unsigned long start = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
      delay(500);
      Serial.print(".");
    }
    Serial.println();

    if (WiFi.status() == WL_CONNECTED) {
      Serial.println("WiFi Connected! IP: " + WiFi.localIP().toString());
      return true;
    }
  }

  return false;
}
