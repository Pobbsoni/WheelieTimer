const START_ANGLE = 15;
const STOP_DELAY = 500;

const timerElement = document.getElementById("timer");
const bestElement = document.getElementById("best");
const lastElement = document.getElementById("last");
const angleElement = document.getElementById("angle");
const statusElement = document.getElementById("status");
const calibrateButton = document.getElementById("calibrateButton");

let calibrated = false;
let angle = 0;
let best = Number(localStorage.getItem("wheelieBest") || 0);
let last = Number(localStorage.getItem("wheelieLast") || 0);

let baseline = 0;
let wheelieStart = 0;
let riding = false;
let stopTimer = null;
let animationFrame = null;

let latestAcceleration = null;
let sensorStarted = false;

bestElement.textContent = best.toFixed(2);
lastElement.textContent = last.toFixed(2);

function updateUI() {
  timerElement.textContent = riding
    ? ((performance.now() - wheelieStart) / 1000).toFixed(2)
    : "0.00";

  angleElement.textContent = `${Math.abs(angle).toFixed(1)}°`;

  statusElement.textContent =
    riding ? "WHEELIE" : calibrated ? "REDO" : "KALIBRERA";
}

function calculateAngle(acceleration) {
  const { x, y, z } = acceleration;

  return Math.atan2(
    y,
    Math.sqrt(x * x + z * z)
  ) * (180 / Math.PI);
}

function handleMotion(event) {
  const acceleration =
    event.accelerationIncludingGravity;

  if (!acceleration) return;

  if (
    acceleration.x == null ||
    acceleration.y == null ||
    acceleration.z == null
  ) {
    return;
  }

  latestAcceleration = {
    x: acceleration.x,
    y: acceleration.y,
    z: acceleration.z
  };

  const currentAngle = calculateAngle(latestAcceleration);

  const relativeAngle =
    currentAngle - baseline;

  angle = relativeAngle;

  if (!calibrated) {
    updateUI();
    return;
  }

  /*
   * Start wheelie
   */
  if (relativeAngle < -START_ANGLE && !riding) {
    if (stopTimer) {
      clearTimeout(stopTimer);
      stopTimer = null;
    }

    wheelieStart = performance.now();
    riding = true;
  }

  /*
   * Wheelie is active
   */
  if (riding) {
    if (
      relativeAngle >= -START_ANGLE &&
      !stopTimer
    ) {
      stopTimer = setTimeout(() => {
        const finalTime =
          (performance.now() - wheelieStart) / 1000;

        last = finalTime;

        if (finalTime > best) {
          best = finalTime;
        }

        localStorage.setItem(
          "wheelieBest",
          best.toString()
        );

        localStorage.setItem(
          "wheelieLast",
          last.toString()
        );

        lastElement.textContent =
          last.toFixed(2);

        bestElement.textContent =
          best.toFixed(2);

        riding = false;
        stopTimer = null;

        updateUI();
      }, STOP_DELAY);
    }

    /*
     * Rider went back into wheelie position
     */
    if (
      relativeAngle < -START_ANGLE &&
      stopTimer
    ) {
      clearTimeout(stopTimer);
      stopTimer = null;
    }
  }

  updateUI();
}

function startSensor() {
  if (sensorStarted) return;

  window.addEventListener(
    "devicemotion",
    handleMotion,
    true
  );

  sensorStarted = true;
}

async function requestSensorPermission() {
  /*
   * iOS requires permission to be requested
   * from a user interaction.
   */

  if (
    typeof DeviceMotionEvent !== "undefined" &&
    typeof DeviceMotionEvent.requestPermission === "function"
  ) {
    try {
      const permission =
        await DeviceMotionEvent.requestPermission();

      if (permission !== "granted") {
        alert(
          "WheelieTimer behöver tillgång till rörelsesensorerna."
        );
        return false;
      }
    } catch (error) {
      console.error(error);

      alert(
        "Kunde inte få tillgång till rörelsesensorerna."
      );

      return false;
    }
  }

  startSensor();

  return true;
}

async function calibrate() {
  const permissionGranted =
    await requestSensorPermission();

  if (!permissionGranted) return;

  /*
   * Give the browser a moment to receive
   * a fresh sensor reading.
   */
  setTimeout(() => {
    if (!latestAcceleration) {
      alert(
        "Ingen sensorinformation mottogs. Kontrollera att du använder iPhone Safari."
      );
      return;
    }

    const currentAngle =
      calculateAngle(latestAcceleration);

    baseline = currentAngle;

    angle = 0;
    calibrated = true;
    riding = false;

    if (stopTimer) {
      clearTimeout(stopTimer);
      stopTimer = null;
    }

    updateUI();
  }, 150);
}

calibrateButton.addEventListener(
  "click",
  calibrate
);

/*
 * Keep the timer updating smoothly.
 */
function animationLoop() {
  updateUI();
  animationFrame =
    requestAnimationFrame(animationLoop);
}

animationLoop();

/*
 * Clean up when leaving the page.
 */
window.addEventListener("beforeunload", () => {
  if (stopTimer) {
    clearTimeout(stopTimer);
  }

  if (animationFrame) {
    cancelAnimationFrame(animationFrame);
  }
});