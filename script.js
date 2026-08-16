const START_ANGLE = 15;
const STOP_DELAY = 500;
const SENSOR_INTERVAL = 50;

let calibrated = false;
let riding = false;

let baselineAngle = 0;
let wheelieStart = 0;
let stopTimeout = null;

let currentAngle = 0;
let currentSpeed = 0;

let best = Number(localStorage.getItem("wheelieBest")) || 0;
let last = Number(localStorage.getItem("wheelieLast")) || 0;
let maxSpeed = Number(localStorage.getItem("maxSpeed")) || 0;

// -------------------------
// UI
// -------------------------

const timerEl = document.getElementById("timer");
const speedEl = document.getElementById("speed");
const angleEl = document.getElementById("angle");
const maxSpeedEl = document.getElementById("maxSpeed");
const bestEl = document.getElementById("best");
const lastEl = document.getElementById("last");

const calibrateButton = document.getElementById("calibrateButton");

const deleteButton = document.getElementById("deleteButton");
const deleteMenu = document.getElementById("deleteMenu");

const deleteWheelie = document.getElementById("deleteWheelie");
const deleteSpeed = document.getElementById("deleteSpeed");
const cancelDelete = document.getElementById("cancelDelete");

// -------------------------
// Initial UI
// -------------------------

updateStats();

function updateStats() {
  bestEl.textContent = best.toFixed(2);
  lastEl.textContent = last.toFixed(2);
  maxSpeedEl.textContent = `${Math.round(maxSpeed)} km/h`;
}

// -------------------------
// Kalibrering
// -------------------------

async function calibrate() {
  try {
    // iOS kräver uttryckligt tillstånd för motion
    if (
      typeof DeviceMotionEvent !== "undefined" &&
      typeof DeviceMotionEvent.requestPermission === "function"
    ) {
      const permission = await DeviceMotionEvent.requestPermission();

      if (permission !== "granted") {
        alert("Tillåt rörelsesensor för att använda Wheelie Timer.");
        return;
      }
    }

    baselineAngle = currentAngle;
    calibrated = true;

    timerEl.textContent = "0.00";
    calibrateButton.textContent = "KALIBRERAD";

  } catch (error) {
    console.error("Sensor permission error:", error);
    alert("Kunde inte få åtkomst till rörelsesensorn.");
  }
}

calibrateButton.addEventListener("click", calibrate);

// -------------------------
// Accelerometer / gyrosensor
// -------------------------

function handleMotion(event) {
  const acceleration = event.accelerationIncludingGravity;

  if (!acceleration) return;

  const x = acceleration.x || 0;
  const y = acceleration.y || 0;
  const z = acceleration.z || 0;

  const angle =
    Math.atan2(
      y,
      Math.sqrt(x * x + z * z)
    ) *
    (180 / Math.PI);

  currentAngle = angle;

  const relativeAngle = currentAngle - baselineAngle;

  angleEl.textContent = `${Math.abs(relativeAngle).toFixed(1)}°`;

  if (!calibrated) return;

  // Start wheelie
  if (relativeAngle < -START_ANGLE && !riding) {

    if (stopTimeout) {
      clearTimeout(stopTimeout);
      stopTimeout = null;
    }

    riding = true;
    wheelieStart = performance.now();

    timerEl.textContent = "0.00";
  }

  // Wheelie pågår
  if (riding) {

    const elapsed =
      (performance.now() - wheelieStart) / 1000;

    timerEl.textContent = elapsed.toFixed(2);

    // För låg vinkel → starta stopptimer
    if (
      relativeAngle >= -START_ANGLE &&
      !stopTimeout
    ) {

      stopTimeout = setTimeout(() => {

        const finalTime =
          (performance.now() - wheelieStart) / 1000;

        timerEl.textContent = finalTime.toFixed(2);

        last = finalTime;

        if (finalTime > best) {
          best = finalTime;
        }

        localStorage.setItem(
          "wheelieBest",
          best
        );

        localStorage.setItem(
          "wheelieLast",
          last
        );

        updateStats();

        riding = false;
        stopTimeout = null;

      }, STOP_DELAY);
    }

    // Börjar wheelie igen innan timeout
    if (
      relativeAngle < -START_ANGLE &&
      stopTimeout
    ) {

      clearTimeout(stopTimeout);
      stopTimeout = null;
    }
  }
}

window.addEventListener(
  "devicemotion",
  handleMotion,
  { passive: true }
);

// -------------------------
// GPS
// -------------------------

function startGPS() {

  if (!navigator.geolocation) {
    console.log("GPS stöds inte.");
    return;
  }

  navigator.geolocation.watchPosition(
    position => {

      const speed =
        position.coords.speed;

      if (
        typeof speed === "number" &&
        speed >= 0
      ) {

        currentSpeed = speed * 3.6;

        const roundedSpeed =
          Math.round(currentSpeed);

        speedEl.textContent =
          `${roundedSpeed} km/h`;

        if (roundedSpeed > maxSpeed) {

          maxSpeed = roundedSpeed;

          localStorage.setItem(
            "maxSpeed",
            maxSpeed
          );

          maxSpeedEl.textContent =
            `${maxSpeed} km/h`;
        }
      }
    },

    error => {
      console.log(
        "GPS error:",
        error.message
      );
    },

    {
      enableHighAccuracy: true,
      maximumAge: 500,
      timeout: 5000
    }
  );
}

startGPS();

// -------------------------
// Radera-menyn
// -------------------------

deleteButton.addEventListener(
  "click",
  () => {
    deleteMenu.classList.remove("hidden");
  }
);

cancelDelete.addEventListener(
  "click",
  () => {
    deleteMenu.classList.add("hidden");
  }
);

// Radera wheelie-data
deleteWheelie.addEventListener(
  "click",
  () => {

    best = 0;
    last = 0;

    localStorage.removeItem(
      "wheelieBest"
    );

    localStorage.removeItem(
      "wheelieLast"
    );

    updateStats();

    deleteMenu.classList.add("hidden");
  }
);

// Radera hastighetsdata
deleteSpeed.addEventListener(
  "click",
  () => {

    maxSpeed = 0;

    localStorage.removeItem(
      "maxSpeed"
    );

    updateStats();

    deleteMenu.classList.add("hidden");
  }
);

// -------------------------
// Service Worker
// -------------------------

if ("serviceWorker" in navigator) {

  window.addEventListener(
    "load",
    () => {

      navigator.serviceWorker
        .register("./sw.js")
        .catch(error => {
          console.log(
            "Service Worker error:",
            error
          );
        });

    }
  );
}
