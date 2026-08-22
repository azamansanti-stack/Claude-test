"use strict";

/* ------------------------------------------------------------------
 * Rooftop Runners
 * A Subway-Surfers-style endless lane runner rendered on <canvas>.
 * Two playable characters: Miles and Prowler (original stylised
 * character art drawn with canvas primitives, not traced artwork).
 * ------------------------------------------------------------------ */

(() => {
  const LANES = 3;
  const LANE_CENTER = 1; // index of the middle lane
  const TRACK_LENGTH = 2000; // world units from horizon (z=TRACK_LENGTH) to camera (z=0)
  const SPAWN_Z = TRACK_LENGTH;
  const COLLIDE_NEAR = 40; // z window around the player where collisions are evaluated
  const COLLIDE_FAR = 140;

  const BASE_SPEED = 620; // world units / second
  const MAX_SPEED = 1500;
  const SPEED_PER_DISTANCE = 0.045; // speed gain per world-unit travelled

  const GRAVITY = 3400;
  const JUMP_VELOCITY = 1150;
  const JUMP_MAX_HEIGHT = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY);
  const SLIDE_DURATION = 0.55; // seconds
  const LANE_SWITCH_SPEED = 12; // lerp speed for lane changes

  const HORIZON_RATIO = 0.34; // canvas-height fraction where the track vanishes
  const GROUND_RATIO = 0.90; // canvas-height fraction of the near edge of the track

  const PALETTES = {
    miles: {
      suit: "#12121a",
      primary: "#e21b2e",
      secondary: "#1a54ff",
      web: "#ffffff",
      mask: "#111014",
      lens: "#f4f4f4",
      accent: "#e21b2e"
    },
    prowler: {
      suit: "#1c1226",
      primary: "#5b21b6",
      secondary: "#241533",
      web: "#c9a227",
      mask: "#181022",
      lens: "#ffcf4d",
      accent: "#c9a227"
    }
  };

  const HIGH_SCORE_KEY = "rooftop-runners-highscore";

  /* ---------------------------- Utilities ---------------------------- */

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  function randInt(min, max) {
    return Math.floor(min + Math.random() * (max - min + 1));
  }

  /* ------------------------- Character drawing ------------------------ */

  /**
   * Draws a simple stylised runner. `pose` controls the running / jumping /
   * sliding silhouette. Everything is built from primitives so no external
   * art assets are required.
   */
  function drawCharacter(ctx, cx, groundY, scale, palette, pose) {
    const { runPhase = 0, airT = 0, sliding = false, dead = false } = pose;

    const s = scale;
    ctx.save();
    ctx.translate(cx, groundY);
    ctx.scale(s, s);

    if (dead) {
      ctx.rotate(Math.PI / 2.4);
      ctx.translate(-10, 10);
    }

    const bodyH = sliding ? 34 : 70;
    const bodyTopY = sliding ? -34 : -70 - airT * 46;
    const legSwing = Math.sin(runPhase * Math.PI * 2) * (sliding ? 0 : 22);

    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // --- Legs ---
    if (!sliding) {
      drawLimb(ctx, 0, bodyTopY + bodyH, 10, legSwing, 34, palette.suit, 9);
      drawLimb(ctx, 0, bodyTopY + bodyH, -10, -legSwing, 34, palette.suit, 9);
    } else {
      // tucked slide pose: legs drawn low and stretched forward
      ctx.strokeStyle = palette.suit;
      ctx.lineWidth = 11;
      ctx.beginPath();
      ctx.moveTo(-4, bodyTopY + bodyH);
      ctx.lineTo(26, bodyTopY + bodyH + 6);
      ctx.stroke();
    }

    // --- Arms ---
    const armSwing = Math.sin(runPhase * Math.PI * 2 + Math.PI) * (sliding ? 6 : 20);
    drawLimb(ctx, 0, bodyTopY + 14, 9, armSwing, 26, palette.primary, 7);
    drawLimb(ctx, 0, bodyTopY + 14, -9, -armSwing, 26, palette.primary, 7);

    // --- Torso ---
    ctx.fillStyle = palette.suit;
    roundRect(ctx, -14, bodyTopY, 28, bodyH, 8);
    ctx.fill();

    // chest accent (abstract emblem, not a copied logo)
    if (palette === PALETTES.miles) {
      ctx.fillStyle = palette.accent;
      ctx.beginPath();
      ctx.moveTo(0, bodyTopY + bodyH * 0.28);
      ctx.lineTo(8, bodyTopY + bodyH * 0.55);
      ctx.lineTo(0, bodyTopY + bodyH * 0.82);
      ctx.lineTo(-8, bodyTopY + bodyH * 0.55);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = -1; i <= 1; i++) {
        ctx.moveTo(i * 6 - 3, bodyTopY + bodyH * 0.25);
        ctx.lineTo(i * 6 + 3, bodyTopY + bodyH * 0.75);
      }
      ctx.stroke();
    }

    // --- Head ---
    const headY = bodyTopY - 14;
    ctx.fillStyle = palette.mask;
    ctx.beginPath();
    ctx.arc(0, headY, 15, 0, Math.PI * 2);
    ctx.fill();

    // lenses / goggles
    ctx.fillStyle = palette.lens;
    if (palette === PALETTES.miles) {
      ctx.beginPath();
      ctx.ellipse(-5, headY - 1, 5, 3.4, -0.15, 0, Math.PI * 2);
      ctx.ellipse(5, headY - 1, 5, 3.4, 0.15, 0, Math.PI * 2);
      ctx.fill();
    } else {
      roundRect(ctx, -10, headY - 4, 20, 7, 3);
      ctx.fill();
    }

    ctx.restore();
  }

  function drawLimb(ctx, ox, oy, offsetX, swing, length, color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(ox + offsetX * 0.4, oy);
    ctx.lineTo(ox + offsetX + swing * 0.5, oy + length + Math.abs(swing) * 0.3);
    ctx.stroke();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ------------------------------- Game -------------------------------- */

  class Game {
    constructor() {
      this.canvas = document.getElementById("game-canvas");
      this.ctx = this.canvas.getContext("2d");

      this.hud = document.getElementById("hud");
      this.scoreEl = document.getElementById("score");
      this.coinsEl = document.getElementById("coins");
      this.highScoreEl = document.getElementById("high-score");

      this.menuScreen = document.getElementById("menu-screen");
      this.gameOverScreen = document.getElementById("game-over-screen");
      this.finalScoreEl = document.getElementById("final-score");
      this.finalBestEl = document.getElementById("final-best");
      this.startBtn = document.getElementById("start-btn");

      this.state = "menu"; // 'menu' | 'playing' | 'gameover'
      this.selectedCharacter = null;
      this.highScore = Number(localStorage.getItem(HIGH_SCORE_KEY)) || 0;

      this.resize = this.resize.bind(this);
      window.addEventListener("resize", this.resize);
      this.resize();

      this.bindMenu();
      this.bindInput();
      this.renderCharacterPreviews();

      this.lastTime = performance.now();
      requestAnimationFrame(this.loop.bind(this));
    }

    resize() {
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
      this.width = this.canvas.width;
      this.height = this.canvas.height;
      this.groundY = this.height * GROUND_RATIO;
      this.horizonY = this.height * HORIZON_RATIO;
    }

    /* ----------------------------- Menu ----------------------------- */

    renderCharacterPreviews() {
      document.querySelectorAll(".char-preview").forEach((canvas) => {
        const key = canvas.dataset.preview;
        canvas.width = 100;
        canvas.height = 130;
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawCharacter(ctx, 50, 110, 1.05, PALETTES[key], { runPhase: 0.25 });
      });
    }

    bindMenu() {
      document.querySelectorAll(".char-card").forEach((card) => {
        card.addEventListener("click", () => {
          document.querySelectorAll(".char-card").forEach((c) => c.classList.remove("selected"));
          card.classList.add("selected");
          this.selectedCharacter = card.dataset.char;
          this.startBtn.disabled = false;
        });
      });

      this.startBtn.disabled = true;
      this.startBtn.addEventListener("click", () => this.startGame());

      document.getElementById("retry-btn").addEventListener("click", () => this.startGame());
      document.getElementById("menu-btn").addEventListener("click", () => {
        this.gameOverScreen.classList.add("hidden");
        this.menuScreen.classList.remove("hidden");
        this.state = "menu";
      });
    }

    /* ----------------------------- Input ----------------------------- */

    bindInput() {
      window.addEventListener("keydown", (e) => {
        if (this.state !== "playing") return;
        switch (e.key) {
          case "ArrowLeft":
          case "a":
          case "A":
            this.player.moveLeft();
            break;
          case "ArrowRight":
          case "d":
          case "D":
            this.player.moveRight();
            break;
          case "ArrowUp":
          case "w":
          case "W":
          case " ":
            e.preventDefault();
            this.player.jump();
            break;
          case "ArrowDown":
          case "s":
          case "S":
            this.player.slide();
            break;
        }
      });

      const touchControls = document.getElementById("touch-controls");
      document.getElementById("touch-left").addEventListener("click", () => this.player && this.player.moveLeft());
      document.getElementById("touch-right").addEventListener("click", () => this.player && this.player.moveRight());
      document.getElementById("touch-up").addEventListener("click", () => this.player && this.player.jump());
      document.getElementById("touch-down").addEventListener("click", () => this.player && this.player.slide());

      if ("ontouchstart" in window) {
        touchControls.classList.remove("hidden");
      }

      // swipe gestures directly on the canvas
      let touchStartX = null;
      let touchStartY = null;
      this.canvas.addEventListener("touchstart", (e) => {
        const t = e.changedTouches[0];
        touchStartX = t.clientX;
        touchStartY = t.clientY;
      });
      this.canvas.addEventListener("touchend", (e) => {
        if (touchStartX === null || this.state !== "playing") return;
        const t = e.changedTouches[0];
        const dx = t.clientX - touchStartX;
        const dy = t.clientY - touchStartY;
        const SWIPE_THRESHOLD = 30;
        if (Math.abs(dx) > Math.abs(dy)) {
          if (dx > SWIPE_THRESHOLD) this.player.moveRight();
          else if (dx < -SWIPE_THRESHOLD) this.player.moveLeft();
        } else {
          if (dy < -SWIPE_THRESHOLD) this.player.jump();
          else if (dy > SWIPE_THRESHOLD) this.player.slide();
        }
        touchStartX = null;
        touchStartY = null;
      });
    }

    /* --------------------------- Projection --------------------------- */

    depthT(z) {
      return clamp(z / TRACK_LENGTH, 0, 1);
    }

    screenY(t) {
      return lerp(this.groundY, this.horizonY, t);
    }

    scaleAt(t) {
      return lerp(1, 0.12, t);
    }

    laneX(lane, t) {
      const spreadNear = this.width * 0.34;
      const spreadFar = this.width * 0.035;
      const spread = lerp(spreadNear, spreadFar, t);
      return this.width / 2 + (lane - LANE_CENTER) * spread;
    }

    /* ----------------------------- Flow ------------------------------ */

    startGame() {
      this.menuScreen.classList.add("hidden");
      this.gameOverScreen.classList.add("hidden");
      this.hud.classList.remove("hidden");

      this.player = new Player(this.selectedCharacter || "miles");
      this.obstacles = [];
      this.coins = [];
      this.distance = 0;
      this.speed = BASE_SPEED;
      this.spawnCooldown = 0;
      this.score = 0;
      this.coinCount = 0;
      this.state = "playing";
    }

    endGame() {
      this.state = "gameover";
      this.hud.classList.add("hidden");
      this.score = Math.floor(this.distance / 10) + this.coinCount * 5;
      if (this.score > this.highScore) {
        this.highScore = this.score;
        localStorage.setItem(HIGH_SCORE_KEY, String(this.highScore));
      }
      this.finalScoreEl.textContent = `Score: ${this.score}`;
      this.finalBestEl.textContent = `Best: ${this.highScore}`;
      this.gameOverScreen.classList.remove("hidden");
    }

    /* ---------------------------- Spawning ---------------------------- */

    spawnWave() {
      const pattern = randInt(0, 3);
      const type = Math.random() < 0.6 ? "barrier" : Math.random() < 0.5 ? "beam" : "train";

      if (pattern === 0) {
        // single obstacle in a random lane
        const lane = randInt(0, LANES - 1);
        this.obstacles.push(new Obstacle(lane, SPAWN_Z, type));
      } else if (pattern === 1) {
        // two obstacles, one lane left open
        const openLane = randInt(0, LANES - 1);
        for (let lane = 0; lane < LANES; lane++) {
          if (lane !== openLane) this.obstacles.push(new Obstacle(lane, SPAWN_Z, type === "train" ? "train" : type));
        }
      } else if (pattern === 2) {
        // full row of coins across a random lane arc
        const lane = randInt(0, LANES - 1);
        for (let i = 0; i < 6; i++) {
          this.coins.push(new Coin(lane, SPAWN_Z - i * 60));
        }
      } else {
        // obstacle plus a coin reward lane
        const blockedLane = randInt(0, LANES - 1);
        this.obstacles.push(new Obstacle(blockedLane, SPAWN_Z, type));
        const coinLane = (blockedLane + 1) % LANES;
        for (let i = 0; i < 4; i++) {
          this.coins.push(new Coin(coinLane, SPAWN_Z - i * 60));
        }
      }
    }

    /* ------------------------------ Loop ------------------------------ */

    loop(now) {
      const dt = Math.min((now - this.lastTime) / 1000, 0.05);
      this.lastTime = now;

      if (this.state === "playing") this.update(dt);
      this.render();

      requestAnimationFrame(this.loop.bind(this));
    }

    update(dt) {
      this.speed = clamp(BASE_SPEED + this.distance * SPEED_PER_DISTANCE, BASE_SPEED, MAX_SPEED);
      this.distance += this.speed * dt;

      this.player.update(dt);

      this.spawnCooldown -= this.speed * dt;
      if (this.spawnCooldown <= 0) {
        this.spawnWave();
        this.spawnCooldown = randInt(420, 620);
      }

      for (const obstacle of this.obstacles) {
        obstacle.z -= this.speed * dt;
        this.checkObstacleCollision(obstacle);
      }
      this.obstacles = this.obstacles.filter((o) => o.z > -100 && !o.hit);

      for (const coin of this.coins) {
        coin.z -= this.speed * dt;
        this.checkCoinPickup(coin);
      }
      this.coins = this.coins.filter((c) => c.z > -100 && !c.collected);

      this.score = Math.floor(this.distance / 10) + this.coinCount * 5;
      this.scoreEl.textContent = `Score: ${this.score}`;
      this.coinsEl.textContent = `Coins: ${this.coinCount}`;
      this.highScoreEl.textContent = `Best: ${this.highScore}`;
    }

    checkObstacleCollision(obstacle) {
      // Resolve each obstacle exactly once, at the instant it crosses the
      // collision line -- re-checking across a whole window would let a
      // player who already cleared a barrier get killed by it moments later.
      if (obstacle.resolved || obstacle.z > COLLIDE_NEAR) return;
      obstacle.resolved = true;
      if (Math.round(this.player.lane) !== obstacle.lane) return;

      let hit = false;
      if (obstacle.type === "train") {
        hit = true;
      } else if (obstacle.type === "barrier") {
        hit = !(this.player.isJumping && this.player.airT > 0.3);
      } else if (obstacle.type === "beam") {
        hit = !this.player.isSliding;
      }

      if (hit) {
        this.player.die();
        this.endGame();
      }
    }

    checkCoinPickup(coin) {
      if (coin.collected) return;
      if (coin.z > COLLIDE_FAR || coin.z < -COLLIDE_NEAR) return;
      if (Math.round(this.player.lane) !== coin.lane) return;
      if (coin.z <= COLLIDE_NEAR) {
        coin.collected = true;
        this.coinCount += 1;
      }
    }

    /* ----------------------------- Render ----------------------------- */

    render() {
      const { ctx, width, height } = this;
      ctx.clearRect(0, 0, width, height);
      this.drawSky();
      this.drawTrack();

      if (this.state === "playing" || this.state === "gameover") {
        const drawables = [...this.obstacles, ...this.coins].sort((a, b) => b.z - a.z);
        for (const item of drawables) {
          if (item instanceof Obstacle) this.drawObstacle(item);
          else this.drawCoin(item);
        }
        this.drawPlayer();
      }
    }

    drawSky() {
      const { ctx, width, height } = this;
      const grad = ctx.createLinearGradient(0, 0, 0, this.horizonY);
      grad.addColorStop(0, "#160b2e");
      grad.addColorStop(1, "#3a1a5c");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, this.horizonY);

      // silhouette skyline
      ctx.fillStyle = "rgba(10, 4, 20, 0.8)";
      const buildingCount = 10;
      const bw = width / buildingCount;
      for (let i = 0; i < buildingCount; i++) {
        const h = 40 + ((i * 53) % 90);
        ctx.fillRect(i * bw, this.horizonY - h, bw * 0.8, h);
      }
    }

    drawTrack() {
      const { ctx, width } = this;
      const groundGrad = ctx.createLinearGradient(0, this.horizonY, 0, this.groundY);
      groundGrad.addColorStop(0, "#241238");
      groundGrad.addColorStop(1, "#100a1c");
      ctx.fillStyle = groundGrad;
      ctx.beginPath();
      ctx.moveTo(this.laneX(-0.5, 0), this.groundY);
      ctx.lineTo(this.laneX(LANES - 0.5, 0), this.groundY);
      ctx.lineTo(this.laneX(LANES - 0.5, 1), this.horizonY);
      ctx.lineTo(this.laneX(-0.5, 1), this.horizonY);
      ctx.closePath();
      ctx.fill();

      // lane dividers
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 2;
      for (let lane = 0; lane <= LANES; lane++) {
        ctx.beginPath();
        ctx.moveTo(this.laneX(lane - 0.5, 0), this.groundY);
        ctx.lineTo(this.laneX(lane - 0.5, 1), this.horizonY);
        ctx.stroke();
      }

      // scrolling speed lines for motion feel
      if (this.state === "playing") {
        const offset = (this.distance * 0.002) % 1;
        ctx.strokeStyle = "rgba(255,255,255,0.12)";
        for (let i = 0; i < 6; i++) {
          const t = clamp((i + offset) / 6, 0, 1);
          ctx.beginPath();
          ctx.moveTo(this.laneX(-0.5, t), this.screenY(t));
          ctx.lineTo(this.laneX(LANES - 0.5, t), this.screenY(t));
          ctx.stroke();
        }
      }
    }

    drawObstacle(obstacle) {
      const t = this.depthT(Math.max(obstacle.z, 0));
      const x = this.laneX(obstacle.lane, t);
      const y = this.screenY(t);
      const scale = this.scaleAt(t);
      const { ctx } = this;

      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);

      if (obstacle.type === "train") {
        ctx.fillStyle = "#2b2440";
        roundRect(ctx, -60, -230, 120, 230, 14);
        ctx.fill();
        ctx.fillStyle = "#f2c94c";
        roundRect(ctx, -46, -170, 92, 40, 6);
        ctx.fill();
      } else if (obstacle.type === "barrier") {
        ctx.fillStyle = "#c0392b";
        roundRect(ctx, -34, -46, 68, 46, 8);
        ctx.fill();
        ctx.fillStyle = "#f5d76e";
        roundRect(ctx, -34, -46, 68, 10, 4);
        ctx.fill();
      } else if (obstacle.type === "beam") {
        ctx.fillStyle = "#7f8c8d";
        roundRect(ctx, -46, -170, 92, 22, 6);
        ctx.fill();
        ctx.fillStyle = "#576574";
        ctx.fillRect(-40, -150, 10, 150);
        ctx.fillRect(30, -150, 10, 150);
      }

      ctx.restore();
    }

    drawCoin(coin) {
      const t = this.depthT(Math.max(coin.z, 0));
      const x = this.laneX(coin.lane, t);
      const y = this.screenY(t) - 40 * this.scaleAt(t);
      const scale = this.scaleAt(t);
      const { ctx } = this;

      ctx.save();
      ctx.translate(x, y);
      const bob = Math.sin((coin.z * 0.02) + performance.now() * 0.006) * 4 * scale;
      ctx.translate(0, bob);
      ctx.scale(scale, scale);
      ctx.fillStyle = "#f4d03f";
      ctx.beginPath();
      ctx.arc(0, 0, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#f9e79f";
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    drawPlayer() {
      const p = this.player;
      const x = this.laneX(p.lane, 0.02);
      drawCharacter(this.ctx, x, this.groundY, 1.55, PALETTES[p.character], {
        runPhase: p.runPhase,
        airT: p.airT,
        sliding: p.isSliding,
        dead: this.state === "gameover"
      });
    }
  }

  /* ------------------------------ Player ------------------------------ */

  class Player {
    constructor(character) {
      this.character = character;
      this.lane = LANE_CENTER;
      this.targetLane = LANE_CENTER;
      this.isJumping = false;
      this.velocityY = 0;
      this.jumpHeight = 0;
      this.airT = 0;
      this.isSliding = false;
      this.slideTimer = 0;
      this.runPhase = 0;
    }

    moveLeft() {
      this.targetLane = clamp(this.targetLane - 1, 0, LANES - 1);
    }

    moveRight() {
      this.targetLane = clamp(this.targetLane + 1, 0, LANES - 1);
    }

    jump() {
      if (this.isJumping || this.isSliding) return;
      this.isJumping = true;
      this.velocityY = JUMP_VELOCITY;
    }

    slide() {
      if (this.isSliding || this.isJumping) return;
      this.isSliding = true;
      this.slideTimer = SLIDE_DURATION;
    }

    die() {
      this.isJumping = false;
      this.isSliding = false;
    }

    update(dt) {
      this.lane = lerp(this.lane, this.targetLane, Math.min(1, LANE_SWITCH_SPEED * dt));

      if (this.isJumping) {
        this.jumpHeight += this.velocityY * dt;
        this.velocityY -= GRAVITY * dt;
        if (this.jumpHeight <= 0) {
          this.jumpHeight = 0;
          this.isJumping = false;
          this.velocityY = 0;
        }
        this.airT = clamp(this.jumpHeight / JUMP_MAX_HEIGHT, 0, 1);
      } else {
        this.airT = 0;
      }

      if (this.isSliding) {
        this.slideTimer -= dt;
        if (this.slideTimer <= 0) this.isSliding = false;
      }

      this.runPhase += dt * (this.isSliding ? 4 : 6);
    }
  }

  /* ---------------------------- Obstacle/Coin --------------------------- */

  class Obstacle {
    constructor(lane, z, type) {
      this.lane = lane;
      this.z = z;
      this.type = type; // 'barrier' | 'beam' | 'train'
      this.resolved = false;
      this.hit = false;
    }
  }

  class Coin {
    constructor(lane, z) {
      this.lane = lane;
      this.z = z;
      this.collected = false;
    }
  }

  window.addEventListener("DOMContentLoaded", () => {
    new Game();
  });
})();
