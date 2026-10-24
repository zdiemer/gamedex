"use strict";

// UI components for konami.js. Feature state and orchestration remain in that module.

function konamiSprite(frame) {
  // The all-dot first row on most frames is not padding to clean up — it IS the bob: the
  // passing frames (3 and 7) start a row of pixels higher than the rest.
  const rows = FRAMES[frame].replace(/^\n|\n$/g, "").split("\n");
  const w = Math.max(...rows.map((r) => r.length));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = rows.length;
  const g = c.getContext("2d");
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const col = PAL[ch];
      if (!col) return;
      g.fillStyle = col;
      g.fillRect(x, y, 1, 1);
    });
  });
  return c;
}

function konamiRun() {
  if (konamiRunning) return;
  konamiRunning = true;

  const SC = 4;                       // pixel scale — big enough to read the stride
  const cv = document.createElement("canvas");
  cv.className = "konami-cv";
  const W = window.innerWidth, H = 150;
  cv.width = W; cv.height = H;
  document.body.appendChild(cv);
  const g = cv.getContext("2d");
  g.imageSmoothingEnabled = false;

  const sprites = FRAMES.map((_, i) => konamiSprite(i));
  const sw = sprites[0].width * SC, sh = sprites[0].height * SC;
  const groundY = H - sh - 6;

  let x = -sw;
  const speed = 3.1;
  const bullets = [];
  let t = 0, lastShot = -999;

  // The spread gun: five shots at once, fanning. It is the only correct choice.
  const fire = (from) => {
    for (const dy of [-2.2, -1.1, 0, 1.1, 2.2]) {
      // 0.37 of sprite height = the barrel row, now that the rifle sits at chest height
      bullets.push({ x: from, y: groundY + sh * 0.37, vx: 7.5, vy: dy, life: 0 });
    }
  };

  const tick = () => {
    t++;
    g.clearRect(0, 0, W, H);

    // run
    x += speed;
    const frame = Math.floor(t / 4.3) % sprites.length;   // ~14 fps at 60 Hz — sprint tempo
    g.drawImage(sprites[frame], Math.round(x), Math.round(groundY), sw, sh);

    // muzzle flash + shots, every ~26 frames
    const muzzleX = x + sw - 4;
    if (t - lastShot > 26) {
      lastShot = t;
      fire(muzzleX);
    }
    if (t - lastShot < 4) {
      g.fillStyle = PAL.M;
      g.fillRect(Math.round(muzzleX), Math.round(groundY + sh * 0.35), 8, 8);
    }

    for (const b of bullets) {
      b.x += b.vx; b.y += b.vy; b.life++;
      g.fillStyle = b.life % 4 < 2 ? PAL.M : "#fff6c2";
      g.fillRect(Math.round(b.x), Math.round(b.y), 6, 4);
    }
    for (let i = bullets.length - 1; i >= 0; i--) {
      if (bullets[i].x > W + 20 || bullets[i].y < -10 || bullets[i].y > H + 10) bullets.splice(i, 1);
    }

    if (x > W + sw) {
      cv.remove();
      konamiRunning = false;
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  // A little acknowledgement, so it's clear it was you and not a glitch.
  const t2 = document.createElement("div");
  t2.className = "konami-toast";
  t2.textContent = "30 lives";
  document.body.appendChild(t2);
  setTimeout(() => t2.remove(), 2600);
}
