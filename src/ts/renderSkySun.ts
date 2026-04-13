import * as THREE from 'three';
import GUI from 'lil-gui';
import { setupKeyControls } from './utils/KeyControls';
import { MovementController } from './utils/MovementController';
import { RenderManager } from './renderMng';
import { AtmosphereUI } from './uiSkySun';


// Define your control set as a constant or class property
const CONTROL_KEYS = ['w', 'a', 's', 'd', 'q', 'e', 'r', 'f', '[', ']', "'", '/', ';', '.'];

 
export class RenderSkySun {
    private renderer: THREE.WebGLRenderer;
    private camera: THREE.OrthographicCamera;
    private scene: THREE.Scene;
    private quad: THREE.Mesh;
    private gui: GUI = new GUI();
    private ui!: AtmosphereUI;

    private timer = new THREE.Timer();
    
    private passes = new RenderManager();
    private movController = new MovementController();
    
    private keysPressed: Record<string, boolean> = {};
    private activeKeyCount: number = 0; // Track how many control keys are currently pressed
 

    // Unified and Clean
    private settings = {
        // --- atmosphere
        enableMultipleScattering: true,
        aerosol: 1.0,
        enableDust: true,
        windIntensity: 0.5,

        // --- sun
        enableRefract: true,
        enableHeatHaze: true,
        enableLimbDarken: true,
        sunElevation: 5.0,
        
        // --- lens
        enableFlare: true,
        enableLensDirt: false,
        lensDirtWeight: 0.7,
        lensDirtStep0: 0.7,
        lensDirtStep1: 3.2,

        // --- camera   
        enablebreathing: false,
        camPitch: 0, 
        camYaw: 0, 
        camRoll: 0,
        camFov: 80.0,
        eyeAttitude: 0.05,
        
        // --- post-process
        enableDither: true,
        enableGrain: true,
        grainWeight: 0.9,

        // --- tone mapping
        enableACES: true,

        // --- debug
        enableCheckerboard: false,
        checkerboardScale: 2.0,
         

        // --- INTERNAL SYSTEM FLAGS (Prefix with underscore or keep in a 'sys' sub-object)
        _lastAerosol: -1,
        _lastElevation: -1,
        _lastAttitude: -1,

        _prevRoll: 0,
        _prevPitch: 0,
        _prevYaw: 0,

        _needsLutUpdate: true,
        _needsScatteringUpdate: true,
        _needsScatteringReset: false,       
    };
 
 

    private constructor(canvas: HTMLCanvasElement, helpMenu: HTMLElement) {
        this.renderer = new THREE.WebGLRenderer({
            canvas,
            context: canvas.getContext('webgl2')!,
            antialias: false // Optimization: Post-process quads don't need native MSAA
        });

        this.renderer.autoClear = false;
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.scene = new THREE.Scene();
        this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
        this.scene.add(this.quad);

        this.setupEventListeners(helpMenu);
    }

    static async init(canvas: HTMLCanvasElement, helpMenu: HTMLElement): Promise<RenderSkySun> {
        const instance = new RenderSkySun(canvas, helpMenu);
        await instance.passes.init(canvas.width, canvas.height, canvas);

        setupKeyControls((v) => {
            instance.passes.materials.get('skyImage')!.uniforms.u_keyPressed.value = v;
        });

        // Initialize UI Logic
        instance.ui = new AtmosphereUI(
            instance.gui, 
            instance.settings,  
            instance.movController
        );
        instance.ui.init();

        //instance.initGui();
        instance.syncAllUniforms();
        
        
        // Initialize previous camera rotation for delta calculations
 
        instance.settings._prevRoll = instance.settings.camRoll;
        instance.settings._prevPitch = instance.settings.camPitch;
        instance.settings._prevYaw = instance.settings.camYaw;

        return instance;
    }

    /**
     * Centralized Uniform Sync. 
     * Ensures all materials get the latest GUI/State values in one pass.
     */
    private syncAllUniforms(): void {
        const mats = this.passes.materials;
        const  sky = mats.get('skyImage')?.uniforms;
        const scat = mats.get('scattering')?.uniforms;
        const trans = mats.get('transmittance')?.uniforms;
        const bokeh = mats.get('bokehImage')?.uniforms;

        if (!sky || !scat || !trans || !bokeh) {
            console.warn("One or more shader uniforms are missing. Cannot sync GUI settings.");
            return;
        }
        // Apply GUI Settings
        sky.bEnableACES.value = this.settings.enableACES;

        sky.fCameraPitch.value = this.settings.camPitch;
        sky.fCameraFov.value = this.settings.camFov;

        sky.bEnableLensDirt.value = this.settings.enableLensDirt;
        sky.fLensDirtWeight.value = this.settings.lensDirtWeight;
        sky.fLensDirtStep0.value = this.settings.lensDirtStep0;
        sky.fLensDirtStep1.value = this.settings.lensDirtStep1;
        sky.bEnableDust.value = this.settings.enableDust;
        sky.bEnableRefract.value = this.settings.enableRefract;
        sky.bEnableHeatHaze.value = this.settings.enableHeatHaze;
        sky.bEnableLimbDarken.value = this.settings.enableLimbDarken;
        sky.bEnableFlare.value = this.settings.enableFlare;
        sky.bEnableCheckerboard.value = this.settings.enableCheckerboard;
        sky.fCheckerboardScale.value = this.settings.checkerboardScale;

        scat.bEnableMultipleScattering.value = this.settings.enableMultipleScattering;
        scat.fWindIntensity.value = this.settings.windIntensity;
        sky.fWindIntensity.value = this.settings.windIntensity;

        bokeh.bEnableDither.value = this.settings.enableDither;
        bokeh.bEnableGrain.value = this.settings.enableGrain;
        bokeh.fGrainWeight.value = this.settings.grainWeight;

        // Apply Engine State
        //this.updateStateUniforms();

        [sky, scat, trans].forEach(u => u.fAerosolTurbidity.value = this.settings.aerosol);
        [sky, scat].forEach(u => u.fSunElevationDeg.value = this.settings.sunElevation);
        [sky, scat].forEach(u => u.fEyeAttitude.value = this.settings.eyeAttitude);
         
 
        sky.fCameraFov.value = this.settings.camFov;
    
        //-- Directly setting the value to the mat3 (Float32Array)
        sky.uCameraMat.value = this.movController.cameraMat3;
    }
 

    private setupEventListeners(helpMenu: HTMLElement): void {

        window.addEventListener('keydown', (e) => {
            const key = e.key.toLowerCase();
            if (CONTROL_KEYS.includes(key) && !this.keysPressed[key]) {
                this.keysPressed[key] = true;
                this.activeKeyCount++;
                if (key === 'escape') {
                    helpMenu.classList.toggle('hidden');
                }
            }
        });


        window.addEventListener('keyup', (e) => {
            const key = e.key.toLowerCase();
            if (CONTROL_KEYS.includes(key) && this.keysPressed[key]) {
                this.keysPressed[key] = false;
                this.activeKeyCount--;
            }
        });
        return;
    }

    public render(): void {
        this.timer.update();
        const dt = this.timer.getDelta();

        // 1. Process Input & Motion
        this.handleInput(dt);

        if (this.settings.enablebreathing) {
            this.movController.applyIdleMotion(dt);
        }

        // 2. LUT Optimization Logic

        
        this.settings._needsScatteringReset = (this.settings._needsScatteringUpdate  == true) && (this.settings.windIntensity <= 0.1);
        // because we have wind, we need to update the scattering LUT every frame to keep it animating
        this.settings._needsScatteringUpdate = true;// (this.guiSettings.WindIntensity > 0.1);
    

        const aerosolChanged = Math.abs(this.settings.aerosol - this.settings._lastAerosol) > 0.001;
        //console.log(`>>>   Aerosol Changed: ${aerosolChanged}, Current: ${this.state.aerosol.toFixed(2)}, Last: ${this.state.lastAerosol.toFixed(2)}`); 
       
        const viewChanged = Math.abs(this.settings.sunElevation - this.settings._lastElevation) > 0.001 || 
                            Math.abs(this.settings.eyeAttitude - this.settings._lastAttitude) > 0.001;

        if (aerosolChanged || this.settings._needsLutUpdate) {
            this.renderToTarget('transmittance');
            this.settings._needsLutUpdate = false;
        }

        if (aerosolChanged || viewChanged || this.settings._needsScatteringUpdate) {
            this.renderToTarget('scattering');
            this.settings._needsScatteringUpdate = false;
        }

        // if (this.state.needsScatteringReset) {
        //     console.log("Resetting scattering LUT to clear wind animation...");
        //     this.renderToTarget('scattering');
        //     this.state.needsScatteringReset = false;
        // }

        // Cache state
        this.settings._lastAerosol = this.settings.aerosol;
        this.settings._lastElevation = this.settings.sunElevation;
        this.settings._lastAttitude = this.settings.eyeAttitude;

        //------
        this.syncAllUniforms(); // Ensure all uniforms are up-to-date before the main render

        // 3. Main Dynamic Pass 
        this.passes.globalUniforms.iTime.value = this.timer.getElapsed();
        this.passes.globalUniforms.iFrame.value++;

        this.renderToTarget('skyImage');

        // 4. Final Display (Bokeh/Post)
        this.quad.material = this.passes.materials.get('bokehImage')!;
        this.renderer.setRenderTarget(null);
        this.renderer.render(this.scene, this.camera);

        return;
    }

    private renderToTarget(name: string): void {
        const mat = this.passes.materials.get(name);
        const target = this.passes.renderTargets.get(name as any);
        if (!mat || !target) return;

        this.quad.material = mat;
        this.renderer.setRenderTarget(target);
        this.renderer.render(this.scene, this.camera);

        return;
    }



    private handleInput(dt: number): void {

        if (this.activeKeyCount <= 0) return;


        console.log(">>> Processing input... keypressed: ", this.keysPressed);

        // Camera Rotation
        const dP = ((this.keysPressed['w'] ? 1 : 0) - (this.keysPressed['s'] ? 1 : 0)) * 1.5 * dt;
        const dY = ((this.keysPressed['d'] ? 1 : 0) - (this.keysPressed['a'] ? 1 : 0)) * 1.5 * dt;
        const dR = ((this.keysPressed['q'] ? 1 : 0) - (this.keysPressed['e'] ? 1 : 0)) * 1.5 * dt;
        
    
        const dAlt = (this.keysPressed["r"] ? 1 : 0) - (this.keysPressed["f"] ? 1 : 0);
        const dFov = (this.keysPressed["]"] ? 1 : 0) - (this.keysPressed["["] ? 1 : 0);

        this.movController.camFOV += dFov * 20.0 * dt;
        this.movController.camFOV = Math.min(170.0, Math.max(5.0, this.movController.camFOV)); // clamp FOV
        this.settings.camFov = this.movController.camFOV;

        let yStep = 1.0;
        if (this.movController.camYPos > 10.0) yStep = 10.0;
        else if (this.movController.camYPos > 30.0) yStep = 25.0;
        else if (this.movController.camYPos > 50.0) yStep = 50.0;
        this.movController.camYPos += dAlt * yStep * dt;
        this.movController.camYPos = Math.max(0.02, this.movController.camYPos); // prevent going below ground

        this.settings.eyeAttitude = this.movController.camYPos; // Sync state for uniform updates
         
        console.log("> [Key] deltas - Pitch: " + dP.toFixed(2) + ", Yaw: " + dY.toFixed(2) + ", Roll: " + dR.toFixed(2));
        console.log(`    [Key] PrevPitch: ${this.settings._prevPitch.toFixed(1)}, PrevYaw: ${this.settings._prevYaw.toFixed(2)}, prevRoll: ${this.settings._prevRoll.toFixed(1)}`);

        const euler = this.movController.update(dP, dY, dR);
 
        //console.log(`+++ [Key] PrevRoll: ${this.settings._prevRoll.toFixed(1)}, Post: dR: ${dR.toFixed(2)}, Roll: ${euler.roll.toFixed(1)}`);
        this.settings._prevRoll = euler.roll;
        this.settings._prevPitch = euler.pitch;
        this.settings._prevYaw = euler.yaw;
         
        this.settings.camPitch = euler.pitch;
        this.settings.camRoll = euler.roll;
        this.settings.camYaw = euler.yaw;

        // Environment
        const elDelta = ((this.keysPressed["'"] ? 1 : 0) - (this.keysPressed["/"] ? 1 : 0)) * 5.0 * dt;
        this.settings.sunElevation = THREE.MathUtils.clamp(this.settings.sunElevation + elDelta, -20, 89);

        const aerosolDelta = (this.keysPressed[";"] ? 1 : 0) - (this.keysPressed["."] ? 1 : 0);
        this.settings.aerosol = 
            Math.min(30.0, Math.max(0.1, this.settings.aerosol + aerosolDelta * 2.0 * dt));
        //console.log(`> [Key] Sun Elevation Delta: ${elDelta.toFixed(2)}, New Elevation: ${this.state.sunElevation.toFixed(1)}°`);
        // console.log(`> [Key] Aerosol Delta: ${aerosolDelta}, New Aerosol: ${this.settings.aerosol.toFixed(1)}`);

        //this.guiSettings.AerosolTurbidity = this.settings.aerosol; // Sync GUI slider with key input

        return;
    }

    public resize(w: number, h: number): void {
        this.renderer.setSize(w, h);
        this.passes.resize(w, h);
        this.settings._needsLutUpdate = true;
        this.settings._needsScatteringUpdate = true;

        return;
    }
} // << export class RenderSkySun
