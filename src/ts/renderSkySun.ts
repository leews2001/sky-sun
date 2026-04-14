import * as THREE from 'three';
import GUI from 'lil-gui';
import { setupKeyControls } from './utils/KeyControls';
import { MovementController } from './utils/MovementController';
import { RenderManager } from './renderMng';
import { AtmosphereUI } from './uiSkySun';
//import { UniformProxy } from './utils/UniformProxy';

//: Define your control set as a constant or class property
const CONTROL_KEYS = ['w', 'a', 's', 'd', 'q', 'e', 'r', 'f', '[', ']', "'", '/', ';', '.'];

// Define a type for clarity
//type MappingSchema = Record<string, THREE.IUniform[]>;
 
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

    
    //private uniformMapping!: MappingSchema;

    private skyUniforms: any;
    private scatUniforms: any;
    private transUniforms: any;
    private bokehUniforms: any;

    //: Unified and centralized state object for all GUI settings and internal flags. 
    //: This makes it easier to manage and sync state across the app.
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
 
 
    //: The constructor is private to enforce async initialization through the static init() method
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

        // const mats = this.passes.materials;
        // this.skyUniforms = mats.get('skyImage')?.uniforms;
        // this.scatUniforms = mats.get('scattering')?.uniforms;
        // this.transUniforms = mats.get('transmittance')?.uniforms;
        // this.bokehUniforms = mats.get('bokehImage')?.uniforms;

        // if (!this.skyUniforms || !this.scatUniforms || !this.transUniforms || !this.bokehUniforms) {
        //     console.warn("01 One or more shader uniforms are missing. Cannot sync GUI settings.");
        //     console.warn("02 skyUniforms: ", this.skyUniforms);
        //     console.warn("03 scatUniforms: ", this.scatUniforms);
        //     console.warn("04 transUniforms: ", this.transUniforms);
        //     console.warn("05 bokehUniforms: ", this.bokehUniforms);
        // }

    }

    //: Factory method to handle async initialization
    static async init(canvas: HTMLCanvasElement, helpMenu: HTMLElement): Promise<RenderSkySun> {

        const instance = new RenderSkySun(canvas, helpMenu);
        await instance.passes.init(canvas.width, canvas.height, canvas);
        // 2. CRITICAL: Cache the uniforms AFTER passes.init is complete
        instance.cacheUniformReferences();
        //instance.initUniformMapping();
        
        setupKeyControls((v) => {
            instance.passes.materials.get('skyImage')!.uniforms.u_keyPressed.value = v;
        });

        instance.ui = new AtmosphereUI(
            instance.gui, 
            instance.settings,  
            instance.movController );

        instance.ui.init();
  
        instance.syncAllUniforms();
 
        instance.settings._prevRoll = instance.settings.camRoll;
        instance.settings._prevPitch = instance.settings.camPitch;
        instance.settings._prevYaw = instance.settings.camYaw;

        instance.settings._lastAerosol = instance.settings.aerosol;
        instance.settings._lastElevation = instance.settings.sunElevation;
        instance.settings._lastAttitude = instance.settings.eyeAttitude;

        // const mats = instance.passes.materials;
        // instance.skyUniforms = mats.get('skyImage')?.uniforms;
        // instance.scatUniforms = mats.get('scattering')?.uniforms;
        // instance.transUniforms = mats.get('transmittance')?.uniforms;
        // instance.bokehUniforms = mats.get('bokehImage')?.uniforms;

        // if (!instance.skyUniforms || !instance.scatUniforms || !instance.transUniforms || !instance.bokehUniforms) {
        //     console.warn("02 One or more shader uniforms are missing. Cannot sync GUI settings.");
        //         console.warn("skyUniforms: ", instance.skyUniforms);
        //         console.warn("scatUniforms: ", instance.scatUniforms);
        //         console.warn("transUniforms: ", instance.transUniforms);
        //         console.warn("bokehUniforms: ", instance.bokehUniforms);
        // }

        return instance;
    }


    // private initUniformProxy(): void {
    //     const sky = this.skyUniforms;
    //     const scat = this.scatUniforms;
    //     const trans = this.transUniforms;

    //     const mapping: UniformMap = {
    //         // Syntax: settingsKey: [Array of uniforms to update]
    //         aerosol: [sky.fAerosolTurbidity, scat.fAerosolTurbidity, trans.fAerosolTurbidity],
    //         sunElevation: [sky.fSunElevationDeg, scat.fSunElevationDeg],
    //         eyeAttitude: [sky.fEyeAttitude, scat.fEyeAttitude],
    //         windIntensity: [sky.fWindIntensity, scat.fWindIntensity],
    //         enableACES: [sky.bEnableACES],
    //         camFov: [sky.fCameraFov],
    //         // ... add others as needed
    //     };

    //     // Re-assign settings to the Proxied version
    //     this.settings = UniformProxy.create(this.settings, mapping);
    // }

    /**
     * Grabs references once so we don't use .get() in the render loop
     */
    private cacheUniformReferences(): void {
        const mats = this.passes.materials;
        this.skyUniforms = mats.get('skyImage')?.uniforms;
        this.scatUniforms = mats.get('scattering')?.uniforms;
        this.transUniforms = mats.get('transmittance')?.uniforms;
        this.bokehUniforms = mats.get('bokehImage')?.uniforms;

        if (!this.skyUniforms || !this.scatUniforms) {
            console.error("Critical Failure: Could not cache shader uniforms. Check RenderManager pass names.");
        }
    }

    // private initUniformMapping(): void {
    //     const sky = this.skyUniforms;
    //     const scat = this.scatUniforms;
    //     const trans = this.transUniforms;
    //     const bokeh = this.bokehUniforms;

    //     this.uniformMapping = {
    //         // Format: settingKey: [uniform1, uniform2, ...]
            
    //         // --- Atmosphere
    //         aerosol: [sky.fAerosolTurbidity, scat.fAerosolTurbidity, trans.fAerosolTurbidity],
    //         enableMultipleScattering: [scat.bEnableMultipleScattering],
    //         windIntensity: [scat.fWindIntensity, sky.fWindIntensity],
            
    //         // --- Sun
    //         sunElevation: [sky.fSunElevationDeg, scat.fSunElevationDeg],
    //         enableRefract: [sky.bEnableRefract],
    //         enableHeatHaze: [sky.bEnableHeatHaze],
    //         enableLimbDarken: [sky.bEnableLimbDarken],
            
    //         // --- Camera
    //         camFov: [sky.fCameraFov],
    //         eyeAttitude: [sky.fEyeAttitude, scat.fEyeAttitude, trans.fEyeAttitude],
            
    //         // --- Lens
    //         enableFlare: [sky.bEnableFlare],
    //         enableLensDirt: [sky.bEnableLensDirt],
    //         lensDirtWeight: [sky.fLensDirtWeight],
            
    //         // --- Post-Process
    //         enableDither: [bokeh.bEnableDither],
    //         enableGrain: [bokeh.bEnableGrain],
    //         grainWeight: [bokeh.fGrainWeight],
    //         enableACES: [sky.bEnableACES],

    //         // --- Debug
    //         enableCheckerboard: [sky.bEnableCheckerboard],
    //         checkerboardScale: [sky.fCheckerboardScale]
    //     };

    //     // Now wrap your settings in the Proxy using this schema
    //     this.settings = UniformProxy.create(this.settings, this.uniformMapping);
    // }

    //: This method resizes the renderer and all render targets, and flags LUTs for update if necessary
    public resize(w: number, h: number): void {

        this.renderer.setSize(w, h);
        this.passes.resize(w, h);
        this.settings._needsLutUpdate = true;
        this.settings._needsScatteringUpdate = true;

        return;
    }

    //: Main render loop. Handles input, updates state, manages LUT updates, syncs uniforms, and executes render passes.
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
        //: Pull-based Synchronization. Instead of having different sliders and keys "pushing" data to the GPU at random times, 
        //: the renderer "pulls" the current state of the world once per frame, right before the draw call.

        this.syncAllUniforms(); // Ensure all uniforms are up-to-date before the main render


        // The "Pull": Only sync what actually changed this frame
        // UniformProxy.sync(this.settings, this.uniformMapping);

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

    // --- Private Helper Methods ---

  /**
     * Centralized Uniform Sync. 
     * Ensures all materials get the latest GUI/State values in one pass.
     */
    private syncAllUniforms(): void {
 

        const sky = this.skyUniforms;
        const scat = this.scatUniforms;
        const trans = this.transUniforms;
        const bokeh = this.bokehUniforms;

        if (!sky || !scat || !trans || !bokeh) {
            console.warn("One or more shader uniforms are missing. Cannot sync GUI settings.");
            return;
        }

        //: Apply GUI Settings
        
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
 
    //: Sets up global keydown and keyup listeners to track control key states and toggle the help menu with Escape.
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

    //: Renders a specific pass to its target. This is used for LUT updates and the main sky render.
    private renderToTarget(name: string): void {
        const mat = this.passes.materials.get(name);
        const target = this.passes.renderTargets.get(name as any);
        if (!mat || !target) return;

        this.quad.material = mat;
        this.renderer.setRenderTarget(target);
        this.renderer.render(this.scene, this.camera);

        return;
    }

    //: This method processes the current input state to update camera orientation, position, sun elevation, and aerosol levels. 
    //: It also handles clamping and state synchronization for smooth control.
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

        //: For altitude changes, we apply a non-linear step based on the current altitude 
        //: to allow for finer control at lower altitudes and faster movement at higher altitudes.
        let yStep = 1.0;
        if (this.movController.camYPos > 10.0) yStep = 10.0;
        else if (this.movController.camYPos > 30.0) yStep = 25.0;
        else if (this.movController.camYPos > 50.0) yStep = 50.0;

        this.movController.camYPos += dAlt * yStep * dt;
        this.movController.camYPos = Math.max(0.02, this.movController.camYPos); // prevent going below ground

        this.settings.eyeAttitude = this.movController.camYPos; 
         

        //: Update camera orientation based on input deltas. The MovementController handles the math and state internally, 
        //: and we just sync the resulting Euler angles back to our settings for uniform updates and GUI display.
        const euler = this.movController.update(dP, dY, dR);
 
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


        return;
    }


} // << export class RenderSkySun
