#pragma once

#include "hal_config.h"
#include <Adafruit_SSD1306.h>

extern Adafruit_SSD1306 display;

void initDisplay();
void showMessage(String line1, String line2 = "", String line3 = "");
