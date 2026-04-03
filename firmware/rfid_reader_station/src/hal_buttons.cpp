#include "hal_buttons.h"

static bool lastBtnUpState = HIGH;
static bool lastBtnDownState = HIGH;
static bool lastBtnSelectState = HIGH;
static bool lastBtnSetupState = HIGH;

void initButtons() {
  pinMode(BTN_UP, INPUT_PULLUP);
  pinMode(BTN_DOWN, INPUT_PULLUP);
  pinMode(BTN_SELECT, INPUT_PULLUP);
  pinMode(BTN_SETUP, INPUT_PULLUP);
  syncButtonStates();

  Serial.println("Button diagnostics ready. Press buttons to see serial logs.");
}

void syncButtonStates() {
  lastBtnUpState = digitalRead(BTN_UP);
  lastBtnDownState = digitalRead(BTN_DOWN);
  lastBtnSelectState = digitalRead(BTN_SELECT);
  lastBtnSetupState = digitalRead(BTN_SETUP);
}

void logButtonStateChanges() {
  struct ButtonInfo {
    const char *name;
    uint8_t pin;
    bool *lastState;
  };

  ButtonInfo buttons[] = {{"UP", BTN_UP, &lastBtnUpState},
                          {"DOWN", BTN_DOWN, &lastBtnDownState},
                          {"SELECT", BTN_SELECT, &lastBtnSelectState},
                          {"BACK", BTN_SETUP, &lastBtnSetupState}};

  for (auto &button : buttons) {
    bool currentState = digitalRead(button.pin);

    if (currentState != *button.lastState) {
      delay(20);
      currentState = digitalRead(button.pin);

      if (currentState != *button.lastState) {
        *button.lastState = currentState;
        Serial.println(String("[BUTTON] ") + button.name +
                       (currentState == LOW ? " PRESSED" : " RELEASED"));
      }
    }
  }
}
