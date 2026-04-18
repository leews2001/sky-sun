
import {animate} from 'animejs';
import './style.css'
import { getElement } from './ts/utils/Utils';
import { RenderSkySun } from './ts/renderSkySun';
import { VCRNoiseController, ChromaGlitchController , type GlitchLayer, TextGlitcher} from './ts/utils/Vfx';

 
/** * CONFIGURATION & CONSTANTS
 * Keeping magic numbers and strings in one place makes maintenance easier.
 */
const CONFIG = {
    SKIP_TITLE: false,
};


/**
 * MAIN APPLICATION ENTRY POINT
 * Initializes the title screen, sets up event listeners, and transitions to the main renderer on button click.
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
        r: getElement<HTMLElement>(".layer.r"),
        g: getElement<HTMLElement>(".layer.g"),
        b: getElement<HTMLElement>(".layer.b"),
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
} // <<< End of main function

//----------------------------------
// Entry Point

main().catch(console.error);