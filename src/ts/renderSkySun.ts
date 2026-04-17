import * as THREE from 'three';
import GUI from 'lil-gui';
import { setupKeyControls } from './utils/KeyControls';
import { MovementController } from './utils/MovementController';
import { RenderManager } from './renderMng';
import { AtmosphereUI } from './uiSkySun';
import { UniformProxy } from './utils/UniformProxy';

//: Define your control set as a constant or class property
const CONTROL_KEYS = ['w', 'a', 's', 'd', 'q', 'e', 'r', 'f', '[', ']', "'", '/', ';', '.'];


// Define the shape of your settings for better type safety
interface EngineSettings {

     // --- atmosphere
     
    enableMultipleScattering: boolean;
    aerosol: number;
    enableDust: boolean;
    windIntensity: number;

    // --- sun
    enableRefract: boolean;
    enableHeatHaze: boolean;
    enableLimbDarken: boolean;
    sunElevation: number;
    
    // --- lens
    enableFlare: boolean;
    enableLensDirt: boolean;
    lensDirtWeight: number;
    lensDirtStep0: number;
    lensDirtStep1: number;
    // --- camera   
    enablebreathing: boolean;
    camPitch: number; 
    camYaw: number; 
    camRoll: number;
    camFov: number,
    eyeAttitude: number;
    
    // --- post-process
    enableDither: boolean;
    enableGrain: boolean;
    grainWeight: number;

    // --- tone mapping
    enableACES: boolean;

    // --- debug
    enableCheckerboard: boolean;
    checkerboardScale: number;
    
    //: Allows for additional internal flags
    [key: string]: any; 

} // << EngineSettings interface


// Define a type for clarity
type MappingSchema = Record<string, THREE.IUniform[]>;
 

// --- The main application class that encapsulates the entire rendering system, UI, and state management.

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

   
    private scatMaterial!: THREE.ShaderMaterial;
    private transMaterial!: THREE.ShaderMaterial;
    private skyImageMaterial!: THREE.ShaderMaterial;
    private bokehImageMaterial!: THREE.ShaderMaterial;
    
    private skyImageTarget!: THREE.WebGLRenderTarget;
    private scatTarget!: THREE.WebGLRenderTarget;
    private transTarget!: THREE.WebGLRenderTarget;
    //private bokehTarget!: THREE.WebGLRenderTarget;

    private skyUniforms: any;
    private scatUniforms: any;
    private transUniforms: any;
    private bokehUniforms: any;

    //: Unified and centralized state object for all GUI settings and internal flags. 
    //: This makes it easier to manage and sync state across the app.
    private settings: EngineSettings = {
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

    }; // << settings:EngineSettings 
 
    private uniformMapping!: MappingSchema;
 
    //--- Constructor and Initialization ------------------------------------

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

    }

    //: Factory method to handle async initialization
    static async init(canvas: HTMLCanvasElement, helpMenu: HTMLElement): Promise<RenderSkySun> {

        const instance = new RenderSkySun(canvas, helpMenu);
        await instance.passes.init(canvas.width, canvas.height, canvas);


        //: 1. Cache uniform references for direct access. 
        //: This avoids the overhead of Map lookups in the render loop 
        //: and allows us to use the UniformProxy effectively.
        instance.cacheUniformReferences();

        //: 2. Initialize the uniform mapping and wrap the settings object with the Proxy.
        instance.initUniformMapping();
        
        setupKeyControls((v) => {
            instance.passes.materials.get('skyImage')!.uniforms.u_keyPressed.value = v;
        });

        //: 3. Initialize UI (which now talks to the Proxy)
        instance.ui = new AtmosphereUI(
            instance.gui,   instance.settings,  instance.movController );

        instance.ui.init();
   
        //: 4. Set initial uniform values that depend on non-primitive types or require special handling
        instance.skyUniforms.uCameraMat.value = instance.movController.cameraMat3; 

        instance.settings._prevRoll = instance.settings.camRoll;
        instance.settings._prevPitch = instance.settings.camPitch;
        instance.settings._prevYaw = instance.settings.camYaw;

        instance.settings._lastAerosol = instance.settings.aerosol;
        instance.settings._lastElevation = instance.settings.sunElevation;
        instance.settings._lastAttitude = instance.settings.eyeAttitude;

        return instance;

    } // << static init()


    //: This method resizes the renderer and all render targets, 
    //: and flags LUTs for update if necessary
    public resize(w: number, h: number): void {

        this.renderer.setSize(w, h);
        this.passes.resize(w, h);
        this.settings._needsLutUpdate = true;
        this.settings._needsScatteringUpdate = true;

        return;
    }

    //: Main render loop. Handles input, updates state, manages LUT updates, 
    //: syncs uniforms, and executes render passes.
    public render(): void {

        this.timer.update();
        const dt = this.timer.getDelta();

        // 1. Process Input & Motion
        this.handleInput(dt);

        if (this.settings.enablebreathing) {
            this.movController.applyIdleMotion(dt);
        }

        // 2. CHANGE DETECTION (Do this BEFORE updating 'last' values), for LUT Optimization Logic
        this.settings._needsScatteringReset = (this.settings._needsScatteringUpdate  == true) && (this.settings.windIntensity <= 0.1);
        
        //: HACK force to True for now, because we have wind, we need to update the scattering LUT 
        //: every frame to keep it animating
        //: In a more complex system, we might have a separate flag for "needsWindUpdate" 
        //: or something to avoid unnecessary LUT renders when the wind is off.
        //: Future work, we want to update the scattering LUT for every frame 
        //: where wind intensity is above 0.1, regardless of whether the user changed any settings, 
        //: to keep the animation smooth.
        //: When wind is turned off (intensity <= 0.1), 
        //: we can set a flag to reset and update the LUT to a static state to save performance.
        this.settings._needsScatteringUpdate = true;
    

        const aerosolChanged = Math.abs(this.settings.aerosol - this.settings._lastAerosol) > 0.01; 
       
        const viewChanged = Math.abs(this.settings.sunElevation - this.settings._lastElevation) > 0.001 || 
                            Math.abs(this.settings.eyeAttitude - this.settings._lastAttitude) > 0.001;


        //: 3. GPU SYNC (The "Pull")
        //: Pull-based Synchronization. Instead of having different sliders 
        //: and keys "pushing" data to the GPU at random times, 
        //: the renderer "pulls" the current state of the world once per frame, 
        //: right before the draw call.

        //: update the camera matrix uniform directly from the MovementController's internal state. 
        //: This is a special case since it's a mat3 and not a simple float/bool.
        this.skyUniforms.uCameraMat.value = this.movController.cameraMat3; 
    
        // The "Pull": Only sync what actually changed this frame
        UniformProxy.sync(this.settings, this.uniformMapping);

        // 4. CONDITIONAL LUT UPDATES
        // Now that uniforms are synced, we can render the LUTs if the flags say so
        if (aerosolChanged || this.settings._needsLutUpdate) {
            //this.renderToTarget('transmittance');
            this.renderToTarget(this.transMaterial, this.transTarget);
            this.settings._needsLutUpdate = false;
        }

        if (aerosolChanged || viewChanged || this.settings._needsScatteringUpdate) {
            //this.renderToTarget('scattering');
            this.renderToTarget(this.scatMaterial, this.scatTarget);
            this.settings._needsScatteringUpdate = false;
        }

        // 5. CACHE STATE FOR NEXT FRAME (Do this LAST)
        this.settings._lastAerosol = this.settings.aerosol;
        this.settings._lastElevation = this.settings.sunElevation;
        this.settings._lastAttitude = this.settings.eyeAttitude;

        // 6. FINAL OUTPUT PASSES
        this.passes.globalUniforms.iTime.value = this.timer.getElapsed();
        this.passes.globalUniforms.iFrame.value++;

        //this.renderToTarget('skyImage');
        this.renderToTarget(this.skyImageMaterial, this.skyImageTarget);

        // 7. Final Display (Bokeh/Post)
        this.quad.material = this.bokehImageMaterial;
        this.renderer.setRenderTarget(null);
        this.renderer.render(this.scene, this.camera);

        return;
    } // << render()

    // --- Private Helper Methods ------------------------------------

    /**
     * Grabs references once so we don't use .get() in the render loop
     * direct assignment is much faster than .get() in a loop
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

        // this.bokehMaterial = mats.get('bokehImage') as THREE.ShaderMaterial;
        this.bokehImageMaterial = mats.get('bokehImage')!;
        this.skyImageMaterial = mats.get('skyImage')!;
        this.scatMaterial = mats.get('scattering')!;
        this.transMaterial = mats.get('transmittance')!;
     
        const targets = this.passes.renderTargets;

        this.skyImageTarget = targets.get('skyImage' as any)!;
        this.scatTarget = targets.get('scattering' as any)!;
        this.transTarget = targets.get('transmittance' as any)!;

        return;

    } // << cacheUniformReferences()

    private initUniformMapping(): void {
        const sky = this.skyUniforms;
        const scat = this.scatUniforms;
        const trans = this.transUniforms;
        const bokeh = this.bokehUniforms;

        // 1. Map settings keys to the actual cached uniforms
        this.uniformMapping = {
            // Format: settingKey: [uniform1, uniform2, ...]
            
            // --- Atmosphere
            aerosol: [sky.fAerosolTurbidity, scat.fAerosolTurbidity, trans.fAerosolTurbidity],
            enableMultipleScattering: [scat.bEnableMultipleScattering],
            enableDust: [sky.bEnableDust],
            windIntensity: [scat.fWindIntensity, sky.fWindIntensity],
            
            // --- Sun
            sunElevation: [sky.fSunElevationDeg, scat.fSunElevationDeg],
            enableRefract: [sky.bEnableRefract],
            enableHeatHaze: [sky.bEnableHeatHaze],
            enableLimbDarken: [sky.bEnableLimbDarken],
            
            // --- Camera
            camFov: [sky.fCameraFov],
            eyeAttitude: [sky.fEyeAttitude, scat.fEyeAttitude],
            
            // --- Lens
            enableFlare: [sky.bEnableFlare],
            enableLensDirt: [sky.bEnableLensDirt],
            lensDirtWeight: [sky.fLensDirtWeight],
            
            // --- Post-Process
            enableDither: [bokeh.bEnableDither],
            enableGrain: [bokeh.bEnableGrain],
            grainWeight: [bokeh.fGrainWeight],
            enableACES: [sky.bEnableACES],

            // --- Debug
            enableCheckerboard: [sky.bEnableCheckerboard],
            checkerboardScale: [sky.fCheckerboardScale]
        };

        // 2. Wrap the settings object. 
        // From this point on, any write to this.settings marks it as 'dirty' for the next frame.
        this.settings = UniformProxy.create(this.settings, this.uniformMapping);

        return;
    } // << initUniformMapping()

    //: Renders a specific pass to its target. This is used for LUT updates and the main sky render.
    private renderToTarget(mat: THREE.Material, target: THREE.WebGLRenderTarget): void {

        this.quad.material = mat;
        this.renderer.setRenderTarget(target);
        this.renderer.render(this.scene, this.camera);

        return;
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
    } // << setupEventListeners

 
    //: This method processes the current input state to update camera orientation, 
    //: position, sun elevation, and aerosol levels. 
    //: It also handles clamping and state synchronization for smooth control.
    private handleInput(dt: number): void {

        if (this.activeKeyCount <= 0) return;

        //console.log(">>> Processing input... keypressed: ", this.keysPressed);

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
        this.movController.camYPos = Math.min(80., this.movController.camYPos); // cap max altitude for performance reasons
        this.settings.eyeAttitude = this.movController.camYPos; 
         

        //: Update camera orientation based on input deltas. 
        //: The MovementController handles the math and state internally, 
        //: and we just sync the resulting Euler angles back to our settings 
        //: for uniform updates and GUI display.
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
    } // << handleInput

} // << export class RenderSkySun
