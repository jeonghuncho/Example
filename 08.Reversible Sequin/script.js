(() => {
  const canvas = document.querySelector("#gardenCanvas");
  const ctx = canvas.getContext("2d");
  const video = document.querySelector("#cameraFeed");
  const gate = document.querySelector("#cameraGate");
  const gateCopy = document.querySelector("#gateCopy");
  const startButton = document.querySelector("#startCamera");

  const sampleCanvas = document.createElement("canvas");
  const sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });
  const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const glyphs = [" ", ".", ".", ":", "-", "x", "x", "×", "X", "M", "W"];
  const grassGlyphs = ["/", "/", "\\", "|", "!", "l", "I", "v", "A"];
  const sparkGlyphs = ["-", "+", "·", ":", "o", "|", "_", "L"];
  const waterGlyphs = ["o", "O", "0", "·"];
  const sparkColors = ["#f1f1ec", "#d5d7cf", "#b8bbb3", "#92978f"];
  const TARGET_FRAME_MS = 45;
  const MAX_DPR = 1.15;
  const GRID_LIMIT = {
    live: { cols: 104, rows: 62, minCell: 13.2 },
    idle: { cols: 96, rows: 58, minCell: 13.8 },
  };

  const flowers = [
    { x: 0.12, max: 0.28, seed: 0.12, color: "#db573f", type: "ring", phase: 0.1 },
    { x: 0.24, max: 0.78, seed: 0.11, color: "#d65340", type: "ring", phase: 1.9 },
    { x: 0.31, max: 0.43, seed: 0.13, color: "#dc5a42", type: "ring", phase: 2.8 },
    { x: 0.40, max: 0.52, seed: 0.1, color: "#ecefe4", type: "bell", phase: 4.7 },
    { x: 0.50, max: 0.45, seed: 0.14, color: "#d95b45", type: "cup", phase: 3.2 },
    { x: 0.58, max: 0.52, seed: 0.12, color: "#ecefe4", type: "moon", phase: 1.2 },
    { x: 0.66, max: 0.55, seed: 0.13, color: "#7fc2ec", type: "cup", phase: 5.1 },
    { x: 0.75, max: 0.50, seed: 0.11, color: "#ecefe4", type: "moon", phase: 0.9 },
    { x: 0.86, max: 0.66, seed: 0.1, color: "#d35283", type: "pink", phase: 3.9 },
    { x: 0.93, max: 0.14, seed: 0.1, color: "#dc573d", type: "bud", phase: 2.2 },
  ];

  const state = {
    stream: null,
    pending: false,
    running: false,
    frame: 0,
    lastRender: 0,
    averageRenderMs: TARGET_FRAME_MS,
    qualityScale: 1,
    startedAt: performance.now(),
    width: 0,
    height: 0,
    dpr: 1,
    cols: 0,
    rows: 0,
    luma: null,
    previousLuma: null,
    motion: null,
    sequinFlip: null,
    sequinVelocity: null,
    sequinSeed: null,
    sparks: [],
    drops: [],
    splashes: [],
    pointer: {
      x: -999,
      y: -999,
      previousX: -999,
      previousY: -999,
      active: false,
      lastMove: -1000,
    },
    blink: {
      baseline: null,
      previousScore: null,
      eyePair: null,
      cooldownUntil: 0,
      indicator: 0,
    },
    lastDropAt: 0,
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function lerp(start, end, amount) {
    return start + (end - start) * amount;
  }

  function noise(x, y, seed = 0) {
    const n = Math.sin(x * 127.1 + y * 311.7 + seed * 41.3) * 43758.5453123;
    return n - Math.floor(n);
  }

  function ensureSequins(count) {
    if (state.sequinFlip?.length === count) return;

    state.sequinFlip = new Float32Array(count);
    state.sequinVelocity = new Float32Array(count);
    state.sequinSeed = new Float32Array(count);

    for (let index = 0; index < count; index += 1) {
      const x = index % 251;
      const y = Math.floor(index / 251);
      const seed = noise(x, y, 17);
      state.sequinSeed[index] = seed;
      state.sequinFlip[index] = seed > 0.72 ? 1 : 0;
    }
  }

  function idleSequinValue(x, y, time) {
    const wave = Math.sin(x * 0.14 + time * 0.0017) + Math.cos(y * 0.2 - time * 0.0012);
    const shimmer = Math.sin((x + y) * 0.055 - time * 0.0022);
    return clamp(wave * 45 + shimmer * 32 + 112, 0, 255);
  }

  function idleSequinMotion(x, y, time) {
    const sweep = Math.sin(x * 0.22 + y * 0.09 - time * 0.0032);
    return clamp((sweep - 0.64) * 160, 0, 64);
  }

  function sequinSource(index, x, y, time, mode) {
    if (mode === "live" && state.luma && state.motion) {
      return {
        value: state.luma[index],
        motion: state.motion[index],
      };
    }

    return {
      value: idleSequinValue(x, y, time),
      motion: idleSequinMotion(x, y, time),
    };
  }

  function updateSequins(cols, rows, cellW, cellH, time, mode = "live") {
    const count = cols * rows;
    ensureSequins(count);

    const pointer = state.pointer;
    const pointerAlive = time - pointer.lastMove < 820;
    const pointerRadius = clamp(Math.min(state.width, state.height) * (pointer.active ? 0.11 : 0.075), 34, 104);
    const pointerDx = pointer.x - pointer.previousX;
    const pointerDy = pointer.y - pointer.previousY;
    const pointerTarget = pointerDx + pointerDy * 0.35 >= 0 ? 1 : 0;

    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const index = y * cols + x;
        const seed = state.sequinSeed[index];
        const { value, motion } = sequinSource(index, x, y, time, mode);
        const dither = bayer[(y % 4) * 4 + (x % 4)] * 3.2;
        const threshold = 112 + (seed - 0.5) * 58 + dither;
        let target = value + motion * 0.65 > threshold ? 1 : 0;

        if (mode !== "live") {
          const sweep = Math.sin(x * 0.13 + y * 0.055 - time * 0.0028 + seed * 4);
          if (sweep > 0.82) target = 1;
          if (sweep < -0.86) target = 0;
        }

        if (motion > 20 && noise(x, y, state.frame * 0.29) < clamp(motion / 145, 0, 0.72)) {
          target = 1 - target;
          state.sequinVelocity[index] += (target ? 1 : -1) * clamp(motion / 680, 0.025, 0.11);
        }

        if (pointerAlive) {
          const cx = x * cellW + cellW * 0.5;
          const cy = y * cellH + cellH * 0.5;
          const distance = Math.hypot(cx - pointer.x, cy - pointer.y);

          if (distance < pointerRadius) {
            const pressure = 1 - distance / pointerRadius;
            target = pointerTarget;
            state.sequinVelocity[index] += (target ? 1 : -1) * pressure * 0.19;
          }
        }

        const flip = state.sequinFlip[index];
        const stiffness = 0.075 + clamp(motion / 420, 0, 0.13);
        let velocity = (state.sequinVelocity[index] + (target - flip) * stiffness) * 0.72;
        let next = flip + velocity;

        if (next < 0 || next > 1) {
          next = clamp(next, 0, 1);
          velocity *= -0.16;
        }

        state.sequinFlip[index] = next;
        state.sequinVelocity[index] = velocity;
      }
    }
  }

  function drawSequin(cx, cy, cellW, cellH, value, motion, flip, seed, time) {
    const luma = clamp(value / 255, 0, 1);
    const side = flip >= 0.5 ? 1 : 0;
    const flatness = Math.abs(flip - 0.5) * 2;
    const radius = Math.min(cellW, cellH) * 0.55;
    const rx = Math.max(1.5, radius * (0.28 + flatness * 0.72));
    const ry = Math.max(2, radius * 0.84);
    const rotation = (seed - 0.5) * 0.54 + Math.sin(time * 0.0014 + seed * 6.28) * 0.08;
    const shine = 0.5 + Math.sin(time * 0.006 + seed * 13.7 + cx * 0.013 + cy * 0.009) * 0.5;
    const frontShade = clamp(lerp(24, 132, luma) + shine * 9, 0, 255);
    const backShade = clamp(lerp(168, 238, luma) + motion * 0.14 + shine * 12, 0, 255);
    const shade = side ? backShade : frontShade;
    const shadowAlpha = side ? 0.22 : 0.3;
    const highlightAlpha = clamp((side ? 0.28 : 0.14) + shine * 0.18 + motion / 820, 0.1, 0.58);

    ctx.fillStyle = `rgba(0, 0, 0, ${shadowAlpha})`;
    ctx.beginPath();
    ctx.ellipse(cx + cellW * 0.08, cy + cellH * 0.1, rx, ry, rotation, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = `rgba(${Math.floor(shade)}, ${Math.floor(shade)}, ${Math.floor(shade)}, ${0.78 + flatness * 0.2})`;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, rotation, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = `rgba(255, 255, 238, ${highlightAlpha})`;
    ctx.lineWidth = Math.max(0.6, radius * 0.13);
    ctx.beginPath();
    ctx.ellipse(cx - rx * 0.16, cy - ry * 0.24, rx * 0.45, ry * 0.26, rotation, -0.25, Math.PI * 0.95);
    ctx.stroke();

    if (radius > 3.3) {
      ctx.fillStyle = side ? "rgba(36, 35, 29, 0.22)" : "rgba(230, 238, 202, 0.16)";
      ctx.beginPath();
      ctx.arc(cx + Math.cos(rotation) * radius * 0.28, cy - radius * 0.24, radius * 0.12, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawSequins(cols, rows, cellW, cellH, time, mode = "live") {
    ensureSequins(cols * rows);
    ctx.save();
    ctx.globalCompositeOperation = "source-over";

    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const index = y * cols + x;
        const { value, motion } = sequinSource(index, x, y, time, mode);
        drawSequin(
          x * cellW + cellW * 0.5,
          y * cellH + cellH * 0.5,
          cellW,
          cellH,
          value,
          motion,
          state.sequinFlip[index],
          state.sequinSeed[index],
          time,
        );
      }
    }

    ctx.restore();
  }

  function resetGardenGrowth() {
    flowers.forEach((flower) => {
      flower.growth = flower.seed;
      flower.wet = 0;
      flower.bump = 0;
    });
    state.drops = [];
    state.splashes = [];
    state.blink.baseline = null;
    state.blink.previousScore = null;
    state.blink.eyePair = null;
    state.blink.cooldownUntil = 0;
    state.blink.indicator = 0;
    state.lastDropAt = 0;
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const width = Math.max(320, Math.round(rect.width));
    const height = Math.max(280, Math.round(rect.height));
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);

    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      state.width = width;
      state.height = height;
      state.dpr = dpr;
      state.previousLuma = null;
      state.luma = null;
      state.motion = null;
      state.sequinFlip = null;
      state.sequinVelocity = null;
      state.sequinSeed = null;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
    }
  }

  function gridMetrics(mode) {
    const limit = GRID_LIMIT[mode];
    const baseCell = clamp(state.width / 118, limit.minCell, 16);
    const cell = baseCell * state.qualityScale;
    const cols = clamp(Math.floor(state.width / cell), 48, limit.cols);
    const rows = clamp(Math.floor(state.height / cell), 34, limit.rows);

    return {
      cols,
      rows,
      cellW: state.width / cols,
      cellH: state.height / rows,
    };
  }

  function tuneQuality(renderMs) {
    state.averageRenderMs = state.averageRenderMs * 0.9 + renderMs * 0.1;

    if (state.averageRenderMs > 48 && state.qualityScale < 1.7) {
      state.qualityScale = Math.min(1.7, state.qualityScale + 0.08);
    } else if (state.averageRenderMs < 27 && state.qualityScale > 1) {
      state.qualityScale = Math.max(1, state.qualityScale - 0.035);
    }
  }

  function cropCover(sourceWidth, sourceHeight, targetWidth, targetHeight) {
    const sourceRatio = sourceWidth / sourceHeight;
    const targetRatio = targetWidth / targetHeight;

    if (sourceRatio > targetRatio) {
      const width = sourceHeight * targetRatio;
      return {
        sx: (sourceWidth - width) / 2,
        sy: 0,
        sw: width,
        sh: sourceHeight,
      };
    }

    const height = sourceWidth / targetRatio;
    return {
      sx: 0,
      sy: (sourceHeight - height) / 2,
      sw: sourceWidth,
      sh: height,
    };
  }

  function sampleVideo(cols, rows) {
    if (sampleCanvas.width !== cols || sampleCanvas.height !== rows) {
      sampleCanvas.width = cols;
      sampleCanvas.height = rows;
    }

    sampleCtx.clearRect(0, 0, cols, rows);
    sampleCtx.imageSmoothingEnabled = true;

    const videoWidth = video.videoWidth || 1280;
    const videoHeight = video.videoHeight || 720;
    const crop = cropCover(videoWidth, videoHeight, cols, rows);

    sampleCtx.save();
    sampleCtx.translate(cols, 0);
    sampleCtx.scale(-1, 1);
    sampleCtx.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, cols, rows);
    sampleCtx.restore();

    return sampleCtx.getImageData(0, 0, cols, rows).data;
  }

  function prepareLuma(data, cols, rows) {
    const count = cols * rows;

    if (!state.luma || state.luma.length !== count) {
      state.luma = new Uint8ClampedArray(count);
      state.motion = new Uint8ClampedArray(count);
      state.previousLuma = new Uint8ClampedArray(count);
    }

    for (let index = 0, pixel = 0; index < count; index += 1, pixel += 4) {
      const raw = data[pixel] * 0.299 + data[pixel + 1] * 0.587 + data[pixel + 2] * 0.114;
      const value = clamp((raw - 22) * 1.24, 0, 255);
      state.luma[index] = value;
      state.motion[index] = Math.abs(value - state.previousLuma[index]);
    }
  }

  function drawPanelBase() {
    const gradient = ctx.createLinearGradient(0, 0, 0, state.height);
    gradient.addColorStop(0, "#242626");
    gradient.addColorStop(0.62, "#1b1d1d");
    gradient.addColorStop(1, "#141515");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, state.width, state.height);
  }

  function glyphFor(value, x, y) {
    const dither = bayer[(y % 4) * 4 + (x % 4)] * 4;
    const adjusted = clamp(value - dither + noise(x, y, state.frame) * 42, 0, 255);
    const index = clamp(Math.floor(adjusted / 24), 0, glyphs.length - 1);
    return glyphs[index];
  }

  function drawAsciiCamera(cols, rows, cellW, cellH) {
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${Math.max(6.4, cellH * 1.02)}px ui-monospace, "SFMono-Regular", Menlo, monospace`;

    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const index = y * cols + x;
        const luma = state.luma[index];
        const motion = state.motion[index];
        const value = luma + motion * 0.72;
        const mark = glyphFor(value, x, y);

        if (mark === " " && noise(x, y, state.frame) > 0.14) continue;

        const shade = Math.floor(clamp(31 + luma * 0.36 + motion * 0.55, 28, 148));
        const alpha = clamp(0.2 + luma / 380 + motion / 420, 0.16, 0.76);
        const cool = motion > 28 ? 8 : 0;
        const flip = state.sequinFlip?.[index] ?? 0;
        ctx.fillStyle = flip > 0.55
          ? `rgba(18, 20, 18, ${alpha * 0.5})`
          : `rgba(${shade}, ${shade + cool}, ${shade + cool * 0.7}, ${alpha * 0.92})`;
        ctx.fillText(mark, x * cellW + cellW * 0.5, y * cellH + cellH * 0.55);
      }
    }

    ctx.restore();
  }

  function spawnSparks(cols, rows, cellW, cellH) {
    if (!state.motion || state.frame % 2 !== 0) return;

    for (let y = 4; y < rows - 9; y += 4) {
      for (let x = 3; x < cols - 3; x += 4) {
        const index = y * cols + x;
        const motion = state.motion[index];
        const luma = state.luma[index];
        const chance = noise(x, y, state.frame * 0.34);

        if (motion > 24 && luma > 24 && chance < 0.048) {
          const hue = sparkColors[Math.floor(noise(x, y, state.frame + 9) * sparkColors.length)];
          state.sparks.push({
            x: x * cellW + cellW * 0.5,
            y: y * cellH + cellH * 0.5,
            vx: (noise(y, x, state.frame) - 0.5) * 1.1,
            vy: -0.25 - noise(x, y, state.frame + 4) * 0.75,
            age: 0,
            life: 34 + Math.floor(motion * 0.75),
            glyph: sparkGlyphs[Math.floor(noise(x, y, state.frame + 12) * sparkGlyphs.length)],
            color: hue,
            box: chance < 0.018,
          });
        }
      }
    }

    if (state.sparks.length > 56) {
      state.sparks.splice(0, state.sparks.length - 56);
    }
  }

  function drawSparks(time) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "15px ui-monospace, SFMono-Regular, Menlo, monospace";

    state.sparks = state.sparks.filter((spark) => {
      spark.age += 1;
      spark.x += spark.vx + Math.sin(time * 0.002 + spark.age * 0.22) * 0.22;
      spark.y += spark.vy;

      const life = 1 - spark.age / spark.life;
      if (life <= 0) return false;

      ctx.globalAlpha = clamp(life, 0, 0.85);
      ctx.fillStyle = spark.color;
      ctx.fillText(spark.glyph, spark.x, spark.y);

      if (spark.box) {
        ctx.fillText("[", spark.x - 10, spark.y + 2);
        ctx.fillText("]", spark.x + 10, spark.y + 2);
      }

      return spark.x > -24 && spark.x < state.width + 24 && spark.y > -24 && spark.y < state.height + 24;
    });

    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function eyeRegionStats(cols, rows, cellW, cellH, x0, x1, y0, y1) {
    let darkTotal = 0;
    let motionTotal = 0;
    let count = 0;

    const startX = Math.max(1, Math.floor(cols * x0));
    const endX = Math.min(cols - 1, Math.ceil(cols * x1));
    const startY = Math.max(1, Math.floor(rows * y0));
    const endY = Math.min(rows - 1, Math.ceil(rows * y1));

    for (let y = startY; y < endY; y += 1) {
      for (let x = startX; x < endX; x += 1) {
        const index = y * cols + x;
        const luma = state.luma[index];
        darkTotal += clamp((92 - luma) / 92, 0, 1);
        motionTotal += state.motion[index];
        count += 1;
      }
    }

    return {
      dark: count ? darkTotal / count : 0,
      motion: count ? motionTotal / count : 0,
      x: ((startX + endX) * 0.5) * cellW,
      y: ((startY + endY) * 0.5) * cellH,
    };
  }

  function detectBlink(cols, rows, cellW, cellH, time) {
    if (!state.motion || !state.luma) return null;

    const left = eyeRegionStats(cols, rows, cellW, cellH, 0.31, 0.47, 0.2, 0.43);
    const right = eyeRegionStats(cols, rows, cellW, cellH, 0.53, 0.69, 0.2, 0.43);
    const score = (left.dark + right.dark) * 0.5;
    const motion = (left.motion + right.motion) * 0.5;
    const scoreChange = state.blink.previousScore === null ? 0 : Math.abs(score - state.blink.previousScore);

    if (state.blink.baseline === null) {
      state.blink.baseline = score;
      state.blink.previousScore = score;
      return null;
    }

    const darkDrop = state.blink.baseline - score;
    const bothEyesMoved = left.motion > 2.2 && right.motion > 2.2;
    const blinkLikeChange = darkDrop > Math.max(0.026, state.blink.baseline * 0.18) || scoreChange > 0.055;
    const didBlink = time > state.blink.cooldownUntil && bothEyesMoved && motion > 4.5 && blinkLikeChange;

    if (didBlink) {
      state.blink.cooldownUntil = time + 620;
      state.blink.indicator = 8;
      state.blink.previousScore = score;
      return {
        eyes: [left, right],
        x: (left.x + right.x) * 0.5,
        y: (left.y + right.y) * 0.5,
        strength: clamp(motion / 18 + scoreChange * 5, 0.7, 2.4),
      };
    }

    const canLearnOpenEye = motion < 7 || score >= state.blink.baseline - 0.018;
    if (canLearnOpenEye) {
      const rate = score > state.blink.baseline ? 0.1 : 0.025;
      state.blink.baseline = state.blink.baseline * (1 - rate) + score * rate;
    }

    state.blink.previousScore = score;
    state.blink.indicator = Math.max(0, state.blink.indicator - 1);
    return null;
  }

  function spawnDropsFromBlink(blink, time) {
    if (!blink || time - state.lastDropAt < 360) return;

    blink.eyes.forEach((eye, index) => {
      const drift = (noise(eye.x * 0.08, eye.y * 0.08, state.frame + index) - 0.5) * 18;
      state.drops.push({
        x: clamp(eye.x + drift, 8, state.width - 8),
        y: clamp(eye.y + 18, 14, state.height - 48),
        vy: 2.8 + blink.strength * 0.82,
        vx: (noise(eye.y, eye.x, state.frame + index) - 0.5) * 0.42,
        age: 0,
        glyph: waterGlyphs[Math.floor(noise(eye.x, eye.y, state.frame + 5) * waterGlyphs.length)],
      });
    });

    if (blink.strength > 1.25) {
      state.drops.push({
        x: clamp(blink.x + (noise(blink.x, blink.y, state.frame) - 0.5) * 22, 8, state.width - 8),
        y: clamp(blink.y + 26, 14, state.height - 48),
        vy: 2.5 + blink.strength * 0.55,
        vx: (noise(blink.y, blink.x, state.frame + 11) - 0.5) * 0.36,
        age: 0,
        glyph: "·",
      });
    }

    state.lastDropAt = time;
  }

  function addSplash(x, y, color = "#91d6ff") {
    for (let i = 0; i < 7; i += 1) {
      const angle = -Math.PI + (Math.PI * 2 * i) / 7 + noise(x, y, i) * 0.6;
      state.splashes.push({
        x,
        y,
        vx: Math.cos(angle) * (0.8 + noise(i, x, y) * 1.5),
        vy: Math.sin(angle) * (0.8 + noise(y, i, x) * 1.2) - 0.5,
        age: 0,
        life: 18 + Math.floor(noise(x, i, y) * 12),
        glyph: i % 2 === 0 ? "." : "`",
        color,
      });
    }

    if (state.splashes.length > 96) {
      state.splashes.splice(0, state.splashes.length - 96);
    }
  }

  function flowerMetrics(flower, time) {
    const fontSize = clamp(state.width * 0.0125, 11, 15);
    const baseY = state.height - 37;
    const growth = clamp(flower.growth ?? flower.seed, 0.08, 1.06);
    const fullHeight = state.height * flower.max;
    const visibleHeight = Math.max(22, fullHeight * growth);
    const sway = Math.sin(time * 0.0011 + flower.phase) * 3.4;
    const x = state.width * flower.x + sway;

    return {
      fontSize,
      baseY,
      growth,
      visibleHeight,
      sway,
      x,
      topY: baseY - visibleHeight,
    };
  }

  function waterFlower(flower) {
    flower.wet = 18;
    flower.bump = 14;
  }

  function nearestFlowerForDrop(drop, time) {
    let nearest = null;
    let nearestDistance = Infinity;

    flowers.forEach((flower) => {
      const metrics = flowerMetrics(flower, time);
      const distance = Math.abs(drop.x - metrics.x);
      const hitWidth = Math.max(22, state.width * 0.035);
      const reachedPlant = drop.y >= metrics.topY - 8 && drop.y <= metrics.baseY + 18;

      if (distance < hitWidth && reachedPlant && distance < nearestDistance) {
        nearest = { flower, metrics };
        nearestDistance = distance;
      }
    });

    return nearest;
  }

  function updateWater(time) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${clamp(state.width * 0.013, 12, 16)}px ui-monospace, SFMono-Regular, Menlo, monospace`;

    state.drops = state.drops.filter((drop) => {
      drop.age += 1;
      drop.vy += 0.055;
      drop.x += drop.vx + Math.sin((time + drop.age * 70) * 0.003) * 0.16;
      drop.y += drop.vy;

      const hit = nearestFlowerForDrop(drop, time);
      if (hit) {
        waterFlower(hit.flower);
        addSplash(drop.x, drop.y, "#96d9ff");
        return false;
      }

      if (drop.y > state.height - 25) {
        const closest = flowers.reduce((best, flower) => {
          const distance = Math.abs(drop.x - state.width * flower.x);
          return distance < best.distance ? { flower, distance } : best;
        }, { flower: null, distance: Infinity });

        if (closest.flower && closest.distance < state.width * 0.045) {
          waterFlower(closest.flower);
        }
        addSplash(drop.x, state.height - 28, "#88cff8");
        return false;
      }

      ctx.globalAlpha = clamp(0.94 - drop.age / 140, 0.34, 0.94);
      ctx.fillStyle = "#91d6ff";
      ctx.fillText(drop.glyph, drop.x, drop.y);
      ctx.fillStyle = "rgba(229, 246, 255, 0.48)";
      ctx.fillText("|", drop.x, drop.y - 10);
      return drop.age < 180;
    });

    state.splashes = state.splashes.filter((splash) => {
      splash.age += 1;
      splash.vy += 0.06;
      splash.x += splash.vx;
      splash.y += splash.vy;

      const life = 1 - splash.age / splash.life;
      if (life <= 0) return false;

      ctx.globalAlpha = clamp(life, 0, 0.82);
      ctx.fillStyle = splash.color;
      ctx.fillText(splash.glyph, splash.x, splash.y);
      return true;
    });

    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawGrass(time) {
    const baseY = state.height - 15;
    const size = clamp(state.width * 0.011, 10, 13);
    const gap = size * 0.72;

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${size}px ui-monospace, SFMono-Regular, Menlo, monospace`;

    for (let x = 3; x < state.width; x += gap) {
      const seed = noise(Math.floor(x * 0.41), 3, 2);
      const glyph = grassGlyphs[Math.floor(seed * grassGlyphs.length)];
      const sway = Math.sin(time * 0.002 + x * 0.06) * 1.6;
      const y = baseY + noise(x, 1, 4) * 7;
      const alpha = 0.42 + seed * 0.46;

      ctx.fillStyle = `rgba(186, 194, 109, ${alpha})`;
      ctx.fillText(glyph, x + sway, y);

      if (seed > 0.82) {
        ctx.fillStyle = "rgba(132, 142, 82, 0.48)";
        ctx.fillText("|", x + gap * 0.35, y - 6);
      }
    }

    ctx.restore();
  }

  function drawBloom(flower, x, y, size, alpha) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${size}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.fillStyle = flower.color;
    ctx.globalAlpha = alpha;

    if (flower.type === "cup") {
      const top = flower.color === "#7fc2ec" ? "uuuuu" : "ooooo";
      ctx.fillText(top, x, y - size * 0.42);
      ctx.fillText("(___)", x, y + size * 0.45);
    } else if (flower.type === "bell") {
      ctx.fillText("uuuuu", x, y - size * 0.45);
      ctx.fillText("\\_Y_/", x, y + size * 0.42);
    } else if (flower.type === "moon") {
      ctx.fillText("( )", x, y);
    } else if (flower.type === "pink") {
      ctx.fillText("(w)", x, y);
    } else if (flower.type === "bud") {
      ctx.fillText("o", x, y);
    } else {
      ctx.fillText("(o)", x, y);
    }

    ctx.globalAlpha = 1;
  }

  function drawFlower(flower, time) {
    const { fontSize, baseY, growth, sway, x, topY } = flowerMetrics(flower, time);
    const alpha = clamp(0.48 + growth * 0.48, 0.52, 0.96);
    const wetGlow = clamp((flower.wet || 0) / 18, 0, 1);
    const bump = clamp((flower.bump || 0) / 14, 0, 1);
    const reaction = Math.sin(bump * Math.PI) * 4;

    flower.wet = Math.max(0, (flower.wet || 0) - 1);
    flower.bump = Math.max(0, (flower.bump || 0) - 1);

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.fillStyle = `rgba(${187 + wetGlow * 30}, ${195 + wetGlow * 26}, ${109 + wetGlow * 52}, ${alpha * 0.86})`;

    ctx.strokeStyle = `rgba(180, ${190 + wetGlow * 42}, ${104 + wetGlow * 62}, ${alpha * (0.42 + wetGlow * 0.18)})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, baseY - 5);
    ctx.lineTo(x + sway * 0.45 + reaction * 0.8, topY + fontSize * 0.7 - reaction);
    ctx.stroke();

    ctx.fillText("^^^^^", x, baseY + 4);

    let segment = 0;
    const step = fontSize * 1.22;
    for (let y = baseY - fontSize; y > topY + fontSize * 0.8; y -= step) {
      const stemSway = Math.sin(time * 0.0017 + segment * 0.82 + flower.phase) * (2 + bump * 1.5);
      ctx.fillText("|", x + stemSway, y);

      if (segment % 2 === 0) {
        ctx.fillText("/", x - fontSize * 0.66 + stemSway * 0.5, y + fontSize * 0.08);
      } else {
        ctx.fillText("\\", x + fontSize * 0.66 + stemSway * 0.5, y + fontSize * 0.08);
      }

      segment += 1;
    }

    drawBloom(flower, x + sway * 0.25 + reaction * 0.6, topY - reaction, fontSize * (1.12 + bump * 0.1), alpha);
    ctx.restore();
  }

  function drawFlowers(time) {
    drawGrass(time);
    flowers.forEach((flower) => drawFlower(flower, time));
  }

  function drawPanelDetails(time) {
    ctx.save();

    ctx.globalAlpha = 0.22;
    ctx.fillStyle = "#000";
    for (let y = 1; y < state.height; y += 4) {
      ctx.fillRect(0, y, state.width, 1);
    }

    ctx.globalAlpha = 0.18;
    for (let x = 0; x < state.width; x += 9) {
      ctx.fillRect(x, 0, 1, state.height);
    }

    ctx.globalAlpha = 1;
    ctx.font = "8px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(231, 234, 224, 0.34)";
    ctx.fillText("cam  live", 16, 12);
    ctx.fillText("sequin garden", state.width - 96, 12);

    const vignette = ctx.createRadialGradient(
      state.width * 0.52,
      state.height * 0.45,
      state.width * 0.18,
      state.width * 0.52,
      state.height * 0.45,
      state.width * 0.72,
    );
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(0.72, "rgba(0, 0, 0, 0.13)");
    vignette.addColorStop(1, "rgba(0, 0, 0, 0.52)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, state.width, state.height);

    ctx.fillStyle = `rgba(235, 240, 224, ${0.02 + noise(1, 3, time * 0.0001) * 0.018})`;
    ctx.fillRect(0, 0, state.width, state.height);
    ctx.restore();
  }

  function drawWaitingScene(time) {
    drawPanelBase();
    const { cols, rows, cellW, cellH } = gridMetrics("idle");

    updateSequins(cols, rows, cellW, cellH, time, "idle");
    drawSequins(cols, rows, cellW, cellH, time, "idle");

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${Math.max(6.4, cellH * 1.02)}px ui-monospace, SFMono-Regular, Menlo, monospace`;

    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const value = (Math.sin(x * 0.16 + time * 0.0014) + Math.cos(y * 0.21 - time * 0.001)) * 54 + 90;
        const mark = glyphFor(value, x, y);
        if (mark === " " || noise(x, y, 7) > 0.58) continue;

        const shade = Math.floor(clamp(33 + value * 0.24, 28, 108));
        ctx.fillStyle = `rgba(${shade}, ${shade}, ${shade}, 0.42)`;
        ctx.fillText(mark, x * cellW + cellW * 0.5, y * cellH + cellH * 0.55);
      }
    }

    ctx.restore();
    drawFlowers(time);
    drawPanelDetails(time);
  }

  function drawLiveScene(time) {
    const { cols, rows, cellW, cellH } = gridMetrics("live");
    const data = sampleVideo(cols, rows);

    state.cols = cols;
    state.rows = rows;
    prepareLuma(data, cols, rows);
    spawnDropsFromBlink(detectBlink(cols, rows, cellW, cellH, time), time);
    drawPanelBase();
    updateSequins(cols, rows, cellW, cellH, time, "live");
    drawSequins(cols, rows, cellW, cellH, time, "live");
    drawAsciiCamera(cols, rows, cellW, cellH);
    spawnSparks(cols, rows, cellW, cellH);
    drawSparks(time);
    updateWater(time);
    drawFlowers(time);
    drawPanelDetails(time);
    state.previousLuma.set(state.luma);
  }

  function draw(time) {
    requestAnimationFrame(draw);

    if (time - state.lastRender < TARGET_FRAME_MS) return;
    state.lastRender = time;
    state.frame += 1;
    resizeCanvas();

    const renderStart = performance.now();

    if (state.running && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      drawLiveScene(time);
    } else {
      drawWaitingScene(time);
    }

    tuneQuality(performance.now() - renderStart);
  }

  async function startCamera() {
    if (state.pending || state.running) return;

    if (!navigator.mediaDevices?.getUserMedia) {
      gateCopy.textContent = "이 브라우저에서는 카메라를 사용할 수 없습니다.";
      return;
    }

    try {
      state.pending = true;
      startButton.disabled = true;
      gateCopy.textContent = "카메라 권한을 확인하고 있습니다.";

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          width: { ideal: 720 },
          height: { ideal: 405 },
          frameRate: { ideal: 20, max: 24 },
        },
      });

      state.stream = stream;
      video.srcObject = stream;
      await video.play();
      state.running = true;
      state.pending = false;
      state.startedAt = performance.now();
      resetGardenGrowth();
      gate.classList.add("is-hidden");
      document.body.classList.add("is-live");
    } catch (error) {
      state.pending = false;
      startButton.disabled = false;
      gate.classList.remove("is-hidden");
      gateCopy.textContent = "브라우저 카메라 권한을 항상 허용으로 바꾼 뒤 다시 시작하세요.";
      document.body.classList.remove("is-live");
    }
  }

  function updatePointer(event, active = true) {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    state.pointer.previousX = state.pointer.x;
    state.pointer.previousY = state.pointer.y;
    state.pointer.x = x;
    state.pointer.y = y;
    state.pointer.active = active;
    state.pointer.lastMove = performance.now();
  }

  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture?.(event.pointerId);
    updatePointer(event, true);
  });

  canvas.addEventListener("pointermove", (event) => {
    updatePointer(event, state.pointer.active || event.buttons > 0);
  });

  canvas.addEventListener("pointerup", (event) => {
    updatePointer(event, false);
  });

  canvas.addEventListener("pointercancel", (event) => {
    updatePointer(event, false);
  });

  startButton.addEventListener("click", startCamera);
  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("beforeunload", () => {
    state.stream?.getTracks().forEach((track) => track.stop());
  });

  resizeCanvas();
  resetGardenGrowth();
  requestAnimationFrame(draw);
  window.setTimeout(startCamera, 320);
})();
