
import {animate} from 'animejs';
import './style.css'
import { RenderSkySun } from './ts/renderSkySun';



// -------------------------

class VCRNoiseController {
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
}

//----------------------------------------------------------------

/** * CONFIGURATION & CONSTANTS
 * Keeping magic numbers and strings in one place makes maintenance easier.
 */
const CONFIG = {
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
type GlitchLayer = { r: HTMLElement; g: HTMLElement; b: HTMLElement };

/**
 * TEXT GLITCH ENGINE
 * Encapsulates text corruption logic. 
 * Can be attached to any HTMLElement (Button, Subtitle, etc.)
 */
class TextGlitcher {
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
        const pool = CONFIG.GLITCH_POOLS[Math.floor(Math.random() * CONFIG.GLITCH_POOLS.length)];
        return pool[Math.floor(Math.random() * pool.length)];
    }

    /** Corrupts text for a single frame */
    private applyGlitchFrame(): void {
        const chars = this.originalText.split("");
        const glitchCount = Math.floor(Math.random() * 4) + 1;

        for (let i = 0; i < glitchCount; i++) {
            const idx = Math.floor(Math.random() * chars.length);
            if (chars[idx] === " " || CONFIG.PROTECTED_CHARS.test(chars[idx])) continue;
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
}

/**
 * VISUAL GLITCH CONTROLLER (RGB Split Effect)
 */
class ChromaGlitchController {
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
        Math.random() < CONFIG.GLITCH_CHANCE ? this.glitchOnce(true) : this.glitchOnce(false);
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
}
//----------------------------------------------------------------
// function getRandomInt(min:number, max:number): number {
//   min = Math.ceil(min);
//   max = Math.floor(max);
//   return Math.floor(Math.random() * (max - min + 1)) + min;
// }

// function renderTail(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {

//     const n = getRandomInt(1, 50);

//     const dirs = [1, -1];
//     let rd = radius;
//     const dir = dirs[Math.floor(Math.random() * dirs.length)];
//     for (let i = 0; i < n; i++) {
//       const step = 0.01;
//       let r = getRandomInt((rd -= step), radius);
//       let dx = getRandomInt(1, 4);

//       radius -= 0.1;

//       dx *= dir;

//       ctx.fillRect((x += dx), y, r, r);
//       ctx.fill();
//     }
//   } 

// function  renderTrackingNoise(ctx: CanvasRenderingContext2D,radius = 2, xmax: number, ymax: number) {
    
//     // const canvas = this.effects.vcr.node;
//     // const ctx = this.effects.vcr.ctx;
//     // const config = this.effects.vcr.config;


//     let posy1 = vcr_tracking || 0;
//     let posy2 = canvas.height;
//     let posy3 = vcr_tracking2 || 0;
//     const num = tape_age|| 20;
    
//     if ( xmax === undefined ) {
//       xmax = canvas.width;
//     }
    
//     if ( ymax === undefined ) {
//       ymax = canvas.height;
//     }     
    
//     //canvas.style.filter = `blur(${config.blur}px)`;
//     ctx.clearRect(0, 0, canvas.width, canvas.height);
//     ctx.fillStyle = `#fff`;

//     ctx.beginPath();
//     for (let i = 0; i <= num; i++) {
//       var x = Math.random() * xmax;
//       var y1 = getRandomInt(posy1+=3, posy2);
//       var y2 = getRandomInt(0, posy3-=3);
//       ctx.fillRect(x, y1, radius, radius);
//       ctx.fillRect(x, y2, radius, radius);
//       ctx.fill();

//       renderTail(ctx, x, y1, radius);
//       renderTail(ctx, x, y2, radius);
//     }
//     ctx.closePath();
//   }


/**
 * MAIN APPLICATION LOGIC
 */
async function main() {
    // 1. DOM Selections with strict null checks
    const canvas = document.getElementById('webgl') as HTMLCanvasElement;
    const titleScreen = document.getElementById("title-screen");
    const startBtn = document.getElementById("start-btn") as HTMLButtonElement;
    const subtitle = document.getElementById("subtitle");
    const helpMenu = document.getElementById("help-menu-sky");

    if (!canvas || !titleScreen || !startBtn || !subtitle || !helpMenu) {
        console.error("Required DOM elements not found");
        return;
    }

    // 2. Initialize Controllers
    const layers: GlitchLayer = {
        r: document.querySelector(".layer.r")!,
        g: document.querySelector(".layer.g")!,
        b: document.querySelector(".layer.b")!
    };

    const visualGlitches = new ChromaGlitchController(layers);
    const btnGlitcher = new TextGlitcher(startBtn);
    const subtitleGlitcher = new TextGlitcher(subtitle);

    const vcrNoise = new VCRNoiseController(titleScreen!);

    let renderer: RenderSkySun | null = null;

    // 3. Helper Functions
    const startBreathing = () => {
        animate(startBtn, {
            scale: [1, 1.2, 1],
            duration: 3800 + Math.random() * 400,
            easing: "easeInOutSine",
            loop: true
        });
    };

    const initializeRenderer = async () => {
        renderer = await RenderSkySun.init(canvas, helpMenu);
        const tick = () => {
            if (renderer) {
                renderer.render();
                requestAnimationFrame(tick);
            }
        };
        tick();
    };

    const handleTransition = async () => {

        // 1. Disable interaction immediately
        startBtn.disabled = true;
        startBtn.style.pointerEvents = "none";

        // Cleanup UI effects
        vcrNoise.stop(); // Stop the VCR effect on transition
        visualGlitches.stop();
        btnGlitcher.stop();
        subtitleGlitcher.stop();
        
   

        await initializeRenderer();
        renderer?.resize(window.innerWidth, window.innerHeight);

        // Visual Fades
        animate(canvas, { opacity: 1, duration: 600, easing: "easeInOutQuad" });
        animate(titleScreen, {
            opacity: 0,
            duration: 400,
            easing: "easeInOutQuad",
            complete: () => titleScreen.style.display = "none"
        });
    };

    // 4. Execution & Event Listeners
    if (CONFIG.SKIP_TITLE) {
        titleScreen.style.display = "none";
        canvas.style.opacity = "1";
        await initializeRenderer();
    } else {
        vcrNoise.start(); // Start VCR noise
        visualGlitches.start();
        btnGlitcher.startLoop();
        subtitleGlitcher.startLoop();
        startBreathing();

        // 2. The Button Click (Transition only)
        startBtn.addEventListener("click", (e) => {
            e.stopPropagation(); // Prevent the titleScreen click from firing too
            handleTransition();
        });
    }

    window.addEventListener('resize', () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        vcrNoise.resize();
        renderer?.resize(canvas.width, canvas.height);
    });

    // 1. The Background Click (Interference only)
    titleScreen.addEventListener("click", (e) => {
        // Check if the click was DIRECTLY on the background or a non-button element
        const isButton = (e.target as HTMLElement).closest("#start-btn");
        
        if (!isButton) {
            const randomDuration = 800 + Math.random() * 500; // 0.8s to 1.5s
            vcrNoise.impact(randomDuration);
            
            // // Optional: Add a subtle audio-visual "thud" effect
            // animate(titleScreen, {
            //     translateX: [Math.random() * 10 - 5, 0],
            //     duration: 100,
            //     easing: "easeOutExpo"
            // });
            console.log("Background clicked - potential interference!");
        }
    });
}

// Entry Point
main().catch(console.error);