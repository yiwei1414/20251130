// 改進：讓動作更協調，包括 ping-pong（往返播放）、跨幀混合 (crossfade)、逐格控制
let img;

// 動畫參數
let fps = 6; // 基本速度（調慢）
let paused = false;
let playPingPong = false; // 若 true 則往返播放
let enableBlend = false; // 關閉 crossfade，避免殘影
let blendDuration = 0.12; // 保留參數，但預設不啟用

// sprite 參數（偵測或手動覆寫）
let frameW = 0;
let frameH = 0;
let cols = 1;
let rows = 1;
let totalFrames = 1;
let totalFramesOverride = 0; // 0 = 自動偵測

// 自己管理的動畫時間（秒），以便暫停時停止累加，且可做逐格操作
let animTime = 0;

// 音樂合成參數（使用 p5.sound）
let musicOn = false;
let bpm = 110;
let lastBeat = -1;
let kickOsc, kickEnv;
let hatNoise, hatEnv, hatFilter;
let audioEnabled = false; // 使用者是否已啟用 audio context
let musicFile = null;
let musicFileLoaded = false;


function preload() {
	img = loadImage('截圖 2025-12-01 上午1.23.07.png',
		() => console.log('圖片載入成功'),
		(err) => console.warn('圖片載入失敗：', err)
	);

	// 嘗試載入外部音檔（如果存在）
	// 檔案名稱應為根目錄的 pulsation-132512.mp3
	if (typeof loadSound === 'function') {
		musicFile = loadSound('pulsation-132512.mp3',
			() => {
				musicFileLoaded = true;
				console.log('musicFile loaded');
			},
			(err) => console.warn('musicFile load error', err)
		);
	}
}

function setup() {
	createCanvas(windowWidth, windowHeight);
	imageMode(CENTER);
	noSmooth();
	// 建立簡單合成器（需要使用者互動以啟動音訊）
	if (typeof p5 !== 'undefined' && typeof p5.prototype !== 'undefined') {
		// kick: sine + envelope
		kickOsc = new p5.Oscillator('sine');
		kickEnv = new p5.Envelope();
		kickEnv.setADSR(0.001, 0.08, 0.0, 0.08);
		kickEnv.setRange(1, 0);
		kickOsc.amp(0);
		kickOsc.start();

		// hat: noise through highpass + envelope
		hatNoise = new p5.Noise('white');
		hatFilter = new p5.Filter('highpass');
		hatEnv = new p5.Envelope();
		hatEnv.setADSR(0.001, 0.03, 0.0, 0.02);
		hatNoise.disconnect();
		hatNoise.connect(hatFilter);
		hatFilter.amp(0);
		hatNoise.start();
		}
	}

	window.mousePressed = function() {
		// 嘗試啟用 audio context（許多瀏覽器需要使用者互動）
		if (!audioEnabled && (typeof userStartAudio === 'function')) {
			userStartAudio().then(() => {
				audioEnabled = true;
				console.log('Audio enabled via user interaction');
				// 若使用者已打開音樂開關，確保節拍從現在開始計時
				if (musicOn) lastBeat = -1;
			}).catch((e) => console.warn('userStartAudio failed', e));
		}
		}
function draw() {
	background('#FFA500');

	if (!img) {
		fill(0);
		textAlign(CENTER, CENTER);
		text('載入中...', width / 2, height / 2);
		return;
	}

	if (frameW === 0) detectFrames();

	// 更新 animTime（如果沒暫停）
	if (!paused) {
		animTime += deltaTime / 1000.0; // deltaTime 是 p5 的幀間毫秒
	}

	// 計算浮點影格（可包含小數用於混合）
	let frameFloat = animTime * fps; // e.g., 3.4 => between frame 3 and 4

	// 如果使用 ping-pong，需要把連續的 frameFloat 轉換成 pingpong 的索引空間
	let effectiveIndexFloat = mapToIndex(frameFloat);
	let currentFrame = floor(effectiveIndexFloat) % totalFrames;
	let nextFrame = (currentFrame + 1) % totalFrames;
	let intra = effectiveIndexFloat - floor(effectiveIndexFloat); // 0..1

	// 若未啟用混合，直接以整數影格顯示
	push();
	translate(width / 2, height / 2);

	const marginFactor = 0.6;
	const maxW = width * marginFactor;
	const maxH = height * marginFactor;
	const displayW = frameW;
	const displayH = frameH;
	const s = Math.min(maxW / displayW, maxH / displayH, 2);

	if (enableBlend) {
		// 計算 blend alpha：用 intra，但限制在 blendDuration 與每幀時間比例
		const frameSec = 1 / fps;
		let alpha = constrain(intra * (frameSec / max(frameSec, blendDuration)), 0, 1);

		// 畫 current with (1-alpha), next with alpha
		push();
		tint(255, 255 * (1 - alpha));
		drawFrame(currentFrame, 0, 0, displayW * s, displayH * s);
		pop();

		push();
		tint(255, 255 * alpha);
		drawFrame(nextFrame, 0, 0, displayW * s, displayH * s);
		pop();
		noTint();
	} else {
			// 直接顯示整格，避免殘影
			drawFrame(currentFrame, 0, 0, displayW * s, displayH * s);
	}

	pop();

	drawHUD(currentFrame);

		// 音樂節拍觸發（簡單步進器）
		if (musicOn) {
			// 每小節 1 拍為基礎
			let beatFloat = (millis() / 1000.0) * (bpm / 60.0);
			let beat = floor(beatFloat);
			if (beat !== lastBeat) {
				lastBeat = beat;
				// 範例 pattern: 每 4 拍，kick 在 0,2 拍，hat 在每拍
				let idx = beat % 4;
				if (idx === 0 || idx === 2) triggerKick();
				triggerHat();
			}
		}
}

function mapToIndex(frameFloat) {
	if (!playPingPong) return frameFloat;

	// ping-pong 範圍長度為 L = 2*totalFrames - 2 (例如 4 帧 -> 6 長度: 0,1,2,3,2,1)
	const L = max(1, 2 * totalFrames - 2);
	let n = floor(frameFloat) % L;
	let frac = frameFloat - floor(frameFloat);

	if (n < totalFrames) {
		return n + frac;
	} else {
		// 反向段
		let mirrored = 2 * totalFrames - 2 - n;
		return mirrored + frac;
	}
}

function drawFrame(frameIndex, dx, dy, dw, dh) {
	const sx = (frameIndex % cols) * frameW;
	const sy = floor(frameIndex / cols) * frameH;
	image(img, dx, dy, dw, dh, sx, sy, frameW, frameH);
}

function detectFrames() {
	// 嘗試更通用的偵測：先試水平 single-row，再試 grid（找整除關係）
	// 優先使用 totalFramesOverride
	if (totalFramesOverride > 0) {
		totalFrames = totalFramesOverride;
		cols = totalFrames;
		rows = 1;
		frameW = img.width / cols;
		frameH = img.height;
		console.log('使用 override 影格數', totalFrames);
		return;
	}

	// 嘗試水平一列（每格高度等於圖片高度）
	if (img.width >= img.height) {
		frameH = img.height;
		cols = max(1, floor(img.width / frameH));
		frameW = img.width / cols;
		rows = 1;
		totalFrames = cols * rows;
		// 若計算出來的 frameW 與整數像素不一致也沒關係
	} else {
		// 嘗試垂直一列
		frameW = img.width;
		rows = max(1, floor(img.height / frameW));
		frameH = img.height / rows;
		cols = 1;
		totalFrames = cols * rows;
	}

	// 如果圖片看起來像是 grid（可被小整數整除），嘗試找出合理的 cols/rows
	for (let c = 1; c <= 8; c++) {
		if (img.width % c === 0) {
			let maybeW = img.width / c;
			if (img.height % maybeW === 0) {
				cols = c;
				frameW = maybeW;
				rows = img.height / frameW;
				frameH = frameW;
				totalFrames = cols * rows;
				break;
			}
		}
	}

	console.log('偵測影格:', { frameW, frameH, cols, rows, totalFrames });
}

function drawHUD(frameIndex) {
	push();
	fill(0, 160);
	rect(8, 8, 320, 90, 6);
	fill(255);
	noStroke();
	textSize(12);
	textAlign(LEFT, TOP);
		text(`影格 ${frameIndex + 1}/${totalFrames}\nFPS: ${fps} (${paused ? '暫停' : '播放'})\n模式: ${playPingPong ? 'PingPong' : 'Loop'}  混合: ${enableBlend ? 'On' : 'Off'}\n音樂: ${musicOn ? 'On' : 'Off'} BPM:${bpm}\n快捷鍵: 空白暫停/播放, ↑↓ 調 FPS, B 切混合, P 切模式, M 切音樂, +/- 調 BPM`, 16, 12);
	pop();
}

function keyPressed() {
	if (key === ' ') {
		paused = !paused;
	} else if (key === 'B' || key === 'b') {
		enableBlend = !enableBlend;
	} else if (key === 'P' || key === 'p') {
		playPingPong = !playPingPong;
		} else if (key === 'M' || key === 'm') {
			// 嘗試啟動 audio 上下文
			if (getAudioContext && getAudioContext().state !== 'running') {
				getAudioContext().resume();
			}
			musicOn = !musicOn;
			if (!musicOn) lastBeat = -1;
		} else if (key === '+') {
			bpm = min(240, bpm + 5);
		} else if (key === '-') {
			bpm = max(40, bpm - 5);
	} else if (keyCode === UP_ARROW) {
		fps = min(60, fps + 1);
	} else if (keyCode === DOWN_ARROW) {
		fps = max(1, fps - 1);
	} else if (keyCode === RIGHT_ARROW) {
		// 若暫停時，逐格前進
		if (paused) animTime += 1 / fps;
	} else if (keyCode === LEFT_ARROW) {
		if (paused) animTime = max(0, animTime - 1 / fps);
	}
}

// 音效觸發函數
function triggerKick() {
	if (!kickOsc || !kickEnv) return;
	// 低頻快速下墜
	let now = getAudioContext().currentTime;
	kickOsc.freq(120);
	kickEnv.play(kickOsc, 0, 0.1);
	// sweep
	kickOsc.freq(60);
	kickOsc.freq(100, 0.06);
}

function triggerHat() {
	if (!hatNoise || !hatEnv || !hatFilter) return;
	// 縮短高通頻率以做出敲擊感
	hatFilter.freq(8000);
	hatEnv.play(hatFilter, 0, 0.05);
}

function windowResized() {
	resizeCanvas(windowWidth, windowHeight);
}
