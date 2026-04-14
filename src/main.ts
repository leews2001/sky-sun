
import {animate} from 'animejs';
import './style.css'
import { RenderSkySun } from './ts/renderSkySun';

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
        // Cleanup UI effects
        visualGlitches.stop();
        btnGlitcher.stop();
        subtitleGlitcher.stop();
        
        startBtn.disabled = true;
        startBtn.style.pointerEvents = "none";

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
        visualGlitches.start();
        btnGlitcher.startLoop();
        subtitleGlitcher.startLoop();
        startBreathing();

        startBtn.addEventListener("click", handleTransition);
    }

    window.addEventListener('resize', () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        renderer?.resize(canvas.width, canvas.height);
    });
}

// Entry Point
main().catch(console.error);