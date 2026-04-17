import {animate} from 'animejs';

/**
 * VCR NOISE CONTROLLER
 * Simulates the look of old VHS tape noise with dynamic tracking lines and "tape age" effects.
 * Designed to be performant by using a single canvas overlay and simple rectangle fills for noise.
 * The "impact" method can be called to create a burst of intense noise, ideal for events like explosions or impacts.
 */
export class VCRNoiseController {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private active: boolean = false;
    private vcrTracking1: number = 0.55; // bottom tracking position (0 to 1, where 0 is bottom of canvas)
    private vcrTracking2: number = 0.55; // top tracking position (0 to 1, where 0 is top of canvas)
    private vcrAge: number = 1; // "Tape age" equivalent, controls density of noise
    private intensityMult: number = 0.0; // Multiplier for noise intensity, used for impact effects
    private trackingStrength: number = 1.0; // How far the tracking lines can move (0 to 1)

    constructor(parent: HTMLElement) {
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'vcr-overlay';
        this.ctx = this.canvas.getContext('2d')!;
        
        // Match parent size
        this.resize();
        parent.appendChild(this.canvas);
        
        // CSS to ensure it overlays correctly
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.pointerEvents = 'none'; // Don't block button clicks
        this.canvas.style.opacity = '0.0';       // Subtle noise
        this.canvas.style.mixBlendMode = 'screen';
        this.canvas.style.filter = `blur(1px)`;
    }

    /** Temporarily boosts noise density and visibility */
    public async impact(duration: number): Promise<void> {
        // If already high intensity, don't stack timers
        if (this.intensityMult > 0.01) return;

    // Get the parent element so the WHOLE screen shakes, not just the noise
        const parent = this.canvas.parentElement;
        if (parent) parent.classList.add('shake-heavy');

        this.intensityMult = 100.0; 
        this.canvas.style.opacity = '0.8';
        this.canvas.style.filter = 'blur(1.2px) contrast(150%)';
        this.trackingStrength= 1.0;
        
        return new Promise((resolve) => {
            setTimeout(() => {
                // Only fade back if we aren't stopping the controller entirely
                if (this.active) {
                    this.intensityMult = .0;
                    this.canvas.style.opacity = '0.0';
                    this.canvas.style.filter = 'blur(0.4px)';
                   if (parent) parent.classList.remove('shake-heavy');
                }
                resolve();
            }, duration);
        });
    }

    public resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    private getRandomInt(min: number, max: number): number {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    private renderTail(x: number, y: number, radius: number) {
        
        //: length of the tail is randomized to create more organic noise patterns
        const n = this.getRandomInt(1, 32);
        const spread = 2 + Math.random() * 8; // Horizontal spread of the tail 

        let rd = radius;
        const dir = Math.random() > 0.5 ? 1 : -1;

        for (let i = 0; i < n; i++) {
            rd -= 0.01;
            let r = this.getRandomInt(Math.max(0.1, rd), radius);
            //: Random horizontal step to create a "drifting" tail effect
            let dx = this.getRandomInt(1, spread) * dir;
 
            x += dx;
            this.ctx.fillRect(x, y, r, r);
        }

        return;
    }

    private loop = () => {
        if (!this.active) return;

        this.trackingStrength *= 0.92; // Gradually reduce tracking strength over time

        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.fillStyle = "#fff";
 
        let posy1 = this.canvas.height- (this.vcrTracking1 * this.trackingStrength) * this.canvas.height ;
    
        let posy3 = (this.vcrTracking2* this.trackingStrength)* this.canvas.height
 
        let num = this.vcrAge + 20 * this.intensityMult;

        this.intensityMult *= 0.71; // Gradually reduce intensity multiplier over time
        for (let i = 0; i < num; i++) {
            const x = Math.random() * this.canvas.width;
            const y1 = this.getRandomInt(posy1+=3,  this.canvas.height);
            const y2 = this.getRandomInt(0, posy3-=3);
 
            const thick = 1+ 2*(i % 2) ; // Randomly vary the thickness of the noise for visual interest
            this.ctx.fillRect(x, y1, 4, thick);
            this.ctx.fillRect(x, y2, 4, thick );

            this.renderTail(x, y1, thick);
            this.renderTail(x, y2, thick);
        }

        requestAnimationFrame(this.loop);
        return;
    }

    public start() {
        this.active = true;
        this.loop();
        return;
    }

    public stop() {
        this.active = false;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        return;
    }
} // <<< End of VCRNoiseController class





/**
 * VISUAL GLITCH CONTROLLER (RGB Split Effect)
 * Simulates a chromatic aberration effect by splitting the red, green, and blue channels into separate layers that can be independently animated.
 * The "start" method begins a loop that randomly triggers glitch bursts, while the "stop" method halts all animations and resets the layers.
 * Designed to be lightweight by using CSS transforms and filters, allowing for smooth performance even on lower-end devices.
 * The intensity and frequency of glitches can be easily adjusted through configuration parameters.
 */


/** * CONFIGURATION & CONSTANTS
 * Keeping magic numbers and strings in one place makes maintenance easier.
 */
const GLITCH_CONFIG = {
    SKIP_TITLE: false,
    GLITCH_CHANCE: 0.25,
    GLITCH_POOLS: [
        "!<>-_\\/[]{}",
        "░▒▓█■□▲△▼▽◆◇○●◎◉",
        "≠≈∞∑∏√∂∆",
        "⧖⧗⧘⟟¥¢§¶©®±µ"
    ],
    PROTECTED_CHARS: /[|[ ▪'\[\]]/
};

// --- TYPES ---
export type GlitchLayer = { r: HTMLElement; g: HTMLElement; b: HTMLElement };

export class ChromaGlitchController {
		private layers: GlitchLayer;
        private timer: number | null = null;
        private active: boolean = false;

    constructor(layers: GlitchLayer) {
				this.layers = layers;
		}

    private glitchOnce(isBurst: boolean = false): void {
        const intensity = isBurst ? (Math.random() - 0.5) * 32 : Math.random() * 12 - 6;
        const duration = isBurst ? 260 : 450;
        const blur = isBurst ? `blur(${Math.abs(intensity) * 0.5}px)` : 'blur(0px)';

        // Batch animations for R, G, B layers
        const targets = [
            { el: this.layers.r, mult: -1 },
            { el: this.layers.g, mult: 0.5 },
            { el: this.layers.b, mult: 1 }
        ];

        targets.forEach(t => {
            animate(t.el, {
                translateX: [intensity * t.mult, 0],
                translateY: [Math.random() * 4 - 2, 0],
                filter: [blur, 'blur(0px)'],
                duration: duration,
                easing: "easeOutQuad"
            });
        });
    }

    public start(): void {
        this.active = true;
        this.loop();
    }

    private loop(): void {
        if (!this.active) return;
        Math.random() < GLITCH_CONFIG.GLITCH_CHANCE ? this.glitchOnce(true) : this.glitchOnce(false);
        this.timer = window.setTimeout(() => this.loop(), 300 + Math.random() * 2000);
    }

    public stop(): void {
        this.active = false;
        if (this.timer) clearTimeout(this.timer);
        // Reset transforms
        [this.layers.r, this.layers.g, this.layers.b].forEach(el => {
            el.style.transform = "translate(0,0)";
            el.style.filter = "none";
        });
    }
} // <<< End of ChromaGlitchController class



/**
 * TEXT GLITCH ENGINE
 * Encapsulates text corruption logic. 
 * Can be attached to any HTMLElement (Button, Subtitle, etc.)
 */
export class TextGlitcher {
		// 1. Explicitly declare the property at the top
    private element: HTMLElement;

    private originalText: string;
    private timer: number | null = null;
    private isActive: boolean = true;

    constructor( element: HTMLElement) {
				// 2. Assign it manually
        this.element = element;
        this.originalText = element.textContent || "";
    }

    private getRandomChar(): string {
        const pool = GLITCH_CONFIG.GLITCH_POOLS[Math.floor(Math.random() * GLITCH_CONFIG.GLITCH_POOLS.length)];
        return pool[Math.floor(Math.random() * pool.length)];
    }

    /** Corrupts text for a single frame */
    private applyGlitchFrame(): void {
        const chars = this.originalText.split("");
        const glitchCount = Math.floor(Math.random() * 4) + 1;

        for (let i = 0; i < glitchCount; i++) {
            const idx = Math.floor(Math.random() * chars.length);
            if (chars[idx] === " " || GLITCH_CONFIG.PROTECTED_CHARS.test(chars[idx])) continue;
            chars[idx] = this.getRandomChar();
        }
        this.element.textContent = chars.join("");
    }

    /** Triggers a quick burst of glitching then restores original text */
    public burst(): void {
        let iterations = 0;
        const max = 6;

        const step = () => {
            if (iterations >= max) {
                this.element.textContent = this.originalText;
                return;
            }
            this.applyGlitchFrame();
            iterations++;
            setTimeout(step, 40 + Math.random() * 40);
        };
        step();
    }

    public startLoop(): void {
        if (!this.isActive) return;
        this.burst();
        const next = 1000 + Math.random() * 3000;
        this.timer = window.setTimeout(() => this.startLoop(), next);
    }

    public stop(): void {
        this.isActive = false;
        if (this.timer) clearTimeout(this.timer);
        this.element.textContent = this.originalText;
    }
} // <<< End of TextGlitcher class
