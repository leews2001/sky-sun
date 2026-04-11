import * as THREE from 'three';
import GUI from 'lil-gui';
import { setupKeyControls } from './utils/KeyControls';
import { MovementController } from './utils/MovementController';
import { RenderManager } from './renderMng';


// Define your control set as a constant or class property
const CONTROL_KEYS = ['w', 'a', 's', 'd', 'q', 'e', 'r', 'f', '[', ']', "'", '/', ';', '.'];


/** --- SHADER FLAGS (Bitmasks) --- */
const FLAGS = {
    DIRTY_LENS: 1 << 1,
    LENSFLARE:  1 << 2,
    CHROMA:     1 << 4,
    VIGNETTE:   1 << 5,
    PHASE:      1 << 6,
    SHADOW:     1 << 7
};

export class RenderSkySun {
    private renderer: THREE.WebGLRenderer;
    private camera: THREE.OrthographicCamera;
    private scene: THREE.Scene;
    private quad: THREE.Mesh;
    private gui: GUI = new GUI();
    private timer = new THREE.Timer();
    
    private passes = new RenderManager();
    private movController = new MovementController();
    
    private keysPressed: Record<string, boolean> = {};
    private activeKeyCount: number = 0; // Track how many control keys are currently pressed

    //private shaderFlags: number = 0;

    // State tracking for LUT updates (Optimization)
    private state = {
        sunElevation: 5.0,
        aerosol: 1.0,
        eyeAttitude: 0.05,
        lastAerosol: -1,
        lastElevation: -1,
        lastAttitude: -1,
        needsLutUpdate: true,
        needsScatteringUpdate: true,
        needsScatteringReset: false,
        prevRoll: 0.,
        prevPitch: 0.,
        prevYaw: 0.
    };

    private guiSettings = {
        AerosolTurbidity: 1.0,
        WindIntensity: 0.5,
        bEnableDust: true,
        bEnableBreathing: false,
        bEnableRefract: true,
        bEnableHeatHaze: true,
        bEnableLimbDarken: true,
        bEnableFlare: true,
        bEnableACES: true,
        bEnableLensDirt: false,
        fLensDirtWeight: 0.7,
        fLensDirtStep0: 0.7,
        fLensDirtStep1: 3.2,
        bEnableDither: true,
        bEnableGrain: true,
        GrainWeight: 0.9,
        bEnableMultipleScattering: true,
        CamPitch: 0, CamYaw: 0, CamRoll: 0,
        CameraFov: 80.0,
        bEnableCheckerboard: false,
        fCheckerboardScale: 2.0
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

        instance.initGui();
        instance.syncAllUniforms();
        
        // Initialize previous camera rotation for delta calculations
        instance.state.prevRoll = instance.guiSettings.CamRoll;
        instance.state.prevPitch = instance.guiSettings.CamPitch;
        instance.state.prevYaw = instance.guiSettings.CamYaw;
        
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
        sky.bEnableACES.value = this.guiSettings.bEnableACES;
        sky.bEnableLensDirt.value = this.guiSettings.bEnableLensDirt;
        sky.fLensDirtWeight.value = this.guiSettings.fLensDirtWeight;
        sky.fLensDirtStep0.value = this.guiSettings.fLensDirtStep0;
        sky.fLensDirtStep1.value = this.guiSettings.fLensDirtStep1;
        sky.bEnableDust.value = this.guiSettings.bEnableDust;
        sky.bEnableRefract.value = this.guiSettings.bEnableRefract;
        sky.bEnableHeatHaze.value = this.guiSettings.bEnableHeatHaze;
        sky.bEnableLimbDarken.value = this.guiSettings.bEnableLimbDarken;
        sky.bEnableFlare.value = this.guiSettings.bEnableFlare;
        sky.bEnableCheckerboard.value = this.guiSettings.bEnableCheckerboard;
        sky.fCheckerboardScale.value = this.guiSettings.fCheckerboardScale;

        scat.bEnableMultipleScattering.value = this.guiSettings.bEnableMultipleScattering;
        scat.fWindIntensity.value = this.guiSettings.WindIntensity;
        sky.fWindIntensity.value = this.guiSettings.WindIntensity;

        bokeh.bEnableDither.value = this.guiSettings.bEnableDither;
        bokeh.bEnableGrain.value = this.guiSettings.bEnableGrain;
        bokeh.fGrainWeight.value = this.guiSettings.GrainWeight;

        // Apply Engine State
        this.updateStateUniforms();
    }

    private updateStateUniforms(): void {
        const mats = this.passes.materials;
        const sky = mats.get('skyImage')?.uniforms;
        const scat = mats.get('scattering')?.uniforms;
        const trans = mats.get('transmittance')?.uniforms;

        if (!sky || !scat || !trans) return;

        [sky, scat, trans].forEach(u => u.fAerosolTurbidity.value = this.state.aerosol);
        [sky, scat].forEach(u => u.fSunElevationDeg.value = this.state.sunElevation);
        [sky, scat].forEach(u => u.fEyeAttitude.value = this.state.eyeAttitude);
        
 
        sky.fCameraYaw.value = this.guiSettings.CamYaw;
        sky.fCameraPitch.value = this.guiSettings.CamPitch;
        sky.fCameraFov.value = this.guiSettings.CameraFov;
        // sky.uCameraMat.value.copy(this.movController.cameraMat3);
        if (sky) {
            // Directly setting the value to the mat3 (Float32Array)
            sky.uCameraMat.value = this.movController.cameraMat3;
        }
    }
 
    private autoId(name:string, controller: any): any {
    const input = controller.domElement.querySelector('input, select, checkbox');
    if (input) {
        // Use the property name as a unique ID
        const id = `gui-${controller._property}-${name.replace(/\s+/g, '-').toLowerCase()}`;
        input.id = id;
        input.setAttribute('name', id);
    }
    return controller; // Return for chaining
}


    private initGui(): void {

        //--- ATMOSPHERE CONTROLS
        const atm = this.gui.addFolder('ATMOSPHERE');
        atm.add(this.guiSettings, 'bEnableMultipleScattering').name(' ▪ m. scatter').onChange(this.syncAllUniforms.bind(this));

        // atm.add(this.guiSettings, 'AerosolTurbidity', 0.1, 30.0, 0.1).decimals(1).name(' ▪ aerosol')
        //     .listen()
        //     .onChange((val: number) => {
        //         this.state.aerosol = val;   
        //         this.updateStateUniforms();
        //     });
        this.autoId(
            'aerosol',
            atm.add(this.guiSettings, 'AerosolTurbidity', 0.1, 30.0, 0.1)
                .decimals(1)
                .name(' ▪ aerosol')
                .listen()
                .onChange((val: number) => {
                    this.state.aerosol = val;   
                    this.updateStateUniforms();
                })
        );

        atm.add(this.guiSettings, 'bEnableDust').name(' ▪ dust').onChange(this.syncAllUniforms.bind(this));

        this.autoId(
            'windintensity',
            atm.add(this.guiSettings, 'WindIntensity', .0, 1.0, 0.02)
                .decimals(2)
                .name(' ▪ wind')
                .listen()
                .onChange((val: number) => { 
                    this.updateStateUniforms();
                })
        );

        //---
        const sun = this.gui.addFolder('SUN EFFECT');
        sun.add(this.guiSettings, 'bEnableRefract').name(' ▪ refract').onChange(this.syncAllUniforms.bind(this));
        sun.add(this.guiSettings, 'bEnableHeatHaze').name(' ▪ heat haze').onChange(this.syncAllUniforms.bind(this));
        sun.add(this.guiSettings, 'bEnableLimbDarken').name(' ▪ limb dark').onChange(this.syncAllUniforms.bind(this));

        this.autoId( 'sunelev',
            sun.add(this.state, 'sunElevation', -20, 89,0.1)
                .decimals(1).name(' ▪ elev (deg)')
                .listen().onChange(this.updateStateUniforms.bind(this))
        );
        
        //--- 
        const lens = this.gui.addFolder('LENS EFFECT');
        lens.add(this.guiSettings, 'bEnableFlare').name(' ▪ flare').onChange(this.syncAllUniforms.bind(this));
        lens.add(this.guiSettings, 'bEnableLensDirt').name(' ▪ dirt').onChange(this.syncAllUniforms.bind(this));

        this.autoId('lensdirtweight',
            lens.add(this.guiSettings, 'fLensDirtWeight', 0, 2, 0.1)
                .decimals(1)
                .name(' ▪ dirt wgt.')
                .onChange(this.syncAllUniforms.bind(this))
        );
        this.autoId('lensdirtstep0',
            lens.add(this.guiSettings, 'fLensDirtStep0', 0, 1, 0.1)
                .decimals(1)
                .name(' ▪ dirt step0')
                .onChange(this.syncAllUniforms.bind(this))
        );
        this.autoId('lensdirtstep1',
            lens.add(this.guiSettings, 'fLensDirtStep1', 0, 5, 0.1)
                .decimals(1)
                .name(' ▪ dirt step1')
                .onChange(this.syncAllUniforms.bind(this))
        );

        //---
        const cam = this.gui.addFolder('CAMERA');
        cam.add(this.guiSettings, 'bEnableBreathing').name(' ▪ breathing');

        this.autoId('camroll',
        cam.add(this.guiSettings, 'CamRoll', -180, 180, 0.1)
            .decimals(1)
            .name(' ▪ roll')
            .listen()
            .onChange((val: number) => {
                // 1. Calculate the delta from the LAST KNOWN STATE
                let delta = val - this.state.prevRoll;
                
                console.log(`[silder] roll: ${val.toFixed(1)}°, prev. roll: ${this.state.prevRoll.toFixed(1)}°, delta: ${delta.toFixed(1)}°`);
                
                // 2. Handle the -180/180 wrap-around for the slider
                if (delta > 180) delta -= 360;
                if (delta < -180) delta += 360;
            
                
                // 3. Update the controller (The math core)
                const euler = this.movController.update(0, 0, delta* Math.PI/180.0); // apply delta in radians
    
                console.log(`[slider] Updated camera  Roll: ${euler.roll.toFixed(2)}`);

                // 4. Update the GUI state and the comparison value
                // We sync EVERYTHING back to the controller's output
                
                this.guiSettings.CamPitch = euler.pitch;
                this.guiSettings.CamRoll = euler.roll;
                this.guiSettings.CamYaw = euler.yaw;

                // This is the anchor for the NEXT delta calculation
                this.state.prevRoll = euler.roll; // update stored value
                this.state.prevPitch = euler.pitch; // update stored value
                this.state.prevYaw = euler.yaw; // update stored value

                // 5. Actually trigger the uniform update
                this.updateStateUniforms();

            })
        );

        this.autoId('camyaw',
            cam.add(this.guiSettings, 'CamYaw', -180, 180, 0.1).decimals(1).name(' ▪ yaw').listen()
                .onChange((val: number) => {
                    let delta = val - this.state.prevYaw;
                    // Normalize delta into [-180, 180]
                    if (delta > 180) delta -= 360;
                    if (delta < -180) delta += 360;

                
                    const euler = this.movController.update( 0, delta* Math.PI/180.0, 0); 

                    this.guiSettings.CamPitch = euler.pitch;
                    this.guiSettings.CamRoll = euler.roll;
                    this.guiSettings.CamYaw = euler.yaw;

                    // This is the anchor for the NEXT delta calculation
                    this.state.prevRoll = euler.roll; // update stored value
                    this.state.prevPitch = euler.pitch; // update stored value
                    this.state.prevYaw = euler.yaw; // update stored value

                    // 5. Actually trigger the uniform update
                    this.updateStateUniforms();
                })
            );
        
        this.autoId('campitch',
            cam.add(this.guiSettings, 'CamPitch', -180, 180, 0.1).decimals(1).name(' ▪ pitch').listen()
                .onChange((val: number) => {
                    let delta = val - this.state.prevPitch;

                    console.log(`[slider] Raw pitch input: ${val.toFixed(1)}°, Previous pitch: ${this.state.prevPitch.toFixed(1)}°, Delta: ${delta.toFixed(1)}°`);
                    // Normalize delta into [-180, 180]
                    if (delta > 180) delta -= 360;
                    if (delta < -180) delta += 360;

                    
                    const euler = this.movController.update( -delta* Math.PI/180.0, 0, 0); // apply delta in radians
                    console.log(`[slider] Updated camera Pitch: ${euler.pitch.toFixed(2)}`);

    
                    this.guiSettings.CamPitch = euler.pitch;
                    this.guiSettings.CamRoll = euler.roll;
                    this.guiSettings.CamYaw = euler.yaw;

                    // This is the anchor for the NEXT delta calculation
                    this.state.prevRoll = euler.roll; // update stored value
                    this.state.prevPitch = euler.pitch; // update stored value
                    this.state.prevYaw = euler.yaw; // update stored value

                    // 5. Actually trigger the uniform update
                    this.updateStateUniforms();
                })
            );
            

        this.autoId('camfov',
            cam.add(this.guiSettings, 'CameraFov', 5, 170).name(' ▪ fOV').decimals(0).listen()
                .onChange( (val: number) => {
                    this.updateStateUniforms.bind(this);
                    this.movController.camFOV = val;
            })
        );

        this.autoId('eyeattitude',
            cam.add(this.state, 'eyeAttitude', 0.02, 64, 0.1).decimals(2).name(' ▪ altitude').listen()
                .onChange( (val: number) => {
                    this.movController.camYPos = val;
                    this.updateStateUniforms.bind(this);
            })
        );

        //---
        const pp = this.gui.addFolder('POST-PROCESS');
        pp.add(this.guiSettings, 'bEnableDither').name(' ▪ dither').onChange(this.syncAllUniforms.bind(this));
        pp.add(this.guiSettings, 'bEnableGrain').name(' ▪ grain').onChange(this.syncAllUniforms.bind(this));

        this.autoId('grainweight',
            pp.add(this.guiSettings, 'GrainWeight', 0, 3, 0.1).name(' ▪ grain wgt.').decimals(1).onChange(this.syncAllUniforms.bind(this))
        );
        //---
        const tone= this.gui.addFolder('TONE MAPPING');
        tone.add(this.guiSettings, 'bEnableACES').name(' ▪ aces').onChange(this.syncAllUniforms.bind(this));

        //---

        const debug = this.gui.addFolder('DEBUG');
        debug.add(this.guiSettings, 'bEnableCheckerboard').name(' ▪ checkerboard').onChange(this.syncAllUniforms.bind(this));
        
        this.autoId('checkerboardscale',
            debug.add(this.guiSettings, 'fCheckerboardScale', 1.0, 200.0, 1).decimals(0).name(' ▪ scale').listen().onChange(this.syncAllUniforms.bind(this))
        );

        //---
        return;
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
                // // Bitmask toggles
                // if (key === 'b') this.shaderFlags ^= FLAGS.DIRTY_LENS;
                // if (key === 'l') this.shaderFlags ^= FLAGS.LENSFLARE;
            }
        });

        //window.addEventListener('keyup', (e) => this.keysPressed[e.key.toLowerCase()] = false);

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

        if (this.guiSettings.bEnableBreathing) {
            this.movController.applyIdleMotion(dt);
        }

        // 2. LUT Optimization Logic

        
        this.state.needsScatteringReset = (this.state.needsScatteringUpdate  == true) && (this.guiSettings.WindIntensity <= 0.1);
        // because we have wind, we need to update the scattering LUT every frame to keep it animating
        this.state.needsScatteringUpdate = true;// (this.guiSettings.WindIntensity > 0.1);
    

        const aerosolChanged = Math.abs(this.state.aerosol - this.state.lastAerosol) > 0.001;
        //console.log(`>>>   Aerosol Changed: ${aerosolChanged}, Current: ${this.state.aerosol.toFixed(2)}, Last: ${this.state.lastAerosol.toFixed(2)}`); 
       
        const viewChanged = Math.abs(this.state.sunElevation - this.state.lastElevation) > 0.001 || 
                            Math.abs(this.state.eyeAttitude - this.state.lastAttitude) > 0.001;

        if (aerosolChanged || this.state.needsLutUpdate) {
            this.renderToTarget('transmittance');
            this.state.needsLutUpdate = false;
        }

        if (aerosolChanged || viewChanged || this.state.needsScatteringUpdate) {
            this.renderToTarget('scattering');
            this.state.needsScatteringUpdate = false;
        }

        // if (this.state.needsScatteringReset) {
        //     console.log("Resetting scattering LUT to clear wind animation...");
        //     this.renderToTarget('scattering');
        //     this.state.needsScatteringReset = false;
        // }

        // Cache state
        this.state.lastAerosol = this.state.aerosol;
        this.state.lastElevation = this.state.sunElevation;
        this.state.lastAttitude = this.state.eyeAttitude;

        // 3. Main Dynamic Pass
        this.updateStateUniforms();
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

        // O(1) check - extremely fast
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
        this.guiSettings.CameraFov = this.movController.camFOV;

        let yStep = 1.0;
        if (this.movController.camYPos > 10.0) yStep = 10.0;
        else if (this.movController.camYPos > 30.0) yStep = 25.0;
        else if (this.movController.camYPos > 50.0) yStep = 50.0;
        this.movController.camYPos += dAlt * yStep * dt;
        this.movController.camYPos = Math.max(0.02, this.movController.camYPos); // prevent going below ground

        this.state.eyeAttitude = this.movController.camYPos; // Sync state for uniform updates
         
        console.log("> [Key] deltas - Pitch: " + dP.toFixed(2) + ", Yaw: " + dY.toFixed(2) + ", Roll: " + dR.toFixed(2));
        console.log(`    [Key] PrevPitch: ${this.state.prevPitch.toFixed(1)}, PrevYaw: ${this.state.prevYaw.toFixed(2)}, prevRoll: ${this.state.prevRoll.toFixed(1)}`);

        const euler = this.movController.update(dP, dY, dR);
 
        //console.log(`+++ [Key] PrevRoll: ${this.state.prevRoll.toFixed(1)}, Post: dR: ${dR.toFixed(2)}, Roll: ${euler.roll.toFixed(1)}`);
        this.state.prevRoll = euler.roll;
        this.state.prevPitch = euler.pitch;
        this.state.prevYaw = euler.yaw;
         
        this.guiSettings.CamPitch = euler.pitch;
        this.guiSettings.CamRoll = euler.roll;
        this.guiSettings.CamYaw = euler.yaw;

        // Environment
        const elDelta = ((this.keysPressed["'"] ? 1 : 0) - (this.keysPressed["/"] ? 1 : 0)) * 5.0 * dt;
        this.state.sunElevation = THREE.MathUtils.clamp(this.state.sunElevation + elDelta, -20, 89);

         const aerosolDelta = (this.keysPressed[";"] ? 1 : 0) - (this.keysPressed["."] ? 1 : 0);
        this.state.aerosol = Math.min(30.0, Math.max(0.1, this.state.aerosol + aerosolDelta * 2.0 * dt));
        //console.log(`> [Key] Sun Elevation Delta: ${elDelta.toFixed(2)}, New Elevation: ${this.state.sunElevation.toFixed(1)}°`);
        console.log(`> [Key] Aerosol Delta: ${aerosolDelta}, New Aerosol: ${this.state.aerosol.toFixed(1)}`);

        this.guiSettings.AerosolTurbidity = this.state.aerosol; // Sync GUI slider with key input

        return;
    }

    public resize(w: number, h: number): void {
        this.renderer.setSize(w, h);
        this.passes.resize(w, h);
        this.state.needsLutUpdate = true;
        this.state.needsScatteringUpdate = true;

        return;
    }
} // << export class RenderSkySun


// import * as THREE from 'three';
// import GUI from 'lil-gui';
// import { setupKeyControls } from './utils/KeyControls'; 
// import { MovementController } from './utils/MovementController';
// import { RenderManager } from './renderMng';
// // import { max } from 'three/tsl';



// const DEF_WIND_INTENSITY = 0.5;
// const DEF_SUN_ELEVATION_DEG = 5.0;
// const DEF_CAM_FOV = 80.0;

// //#region --- Shader Feature Flags (bitmasks) 
// // const FLAG_SHAKING = 1 << 0;
// const FLAG_ENABLE_DIRTY_LENS = 1 << 1;
// const FLAG_ENABLE_LENSFLARE = 1 << 2;
// // const FLAG_CRT = 1 << 3;
// const FLAG_ENABLE_CHROMA_ABERRATION = 1 << 4;
// const FLAG_ENABLE_VIGNETTE = 1 << 5;
// const FLAG_ENABLE_PHASE_SCATTER = 1 << 6; // New flag for phase scattering
// const FLAG_ENABLE_SHADOW = 1 << 7; // New flag for crepuscular shadow effect    
 

// const DEFAULT_GRAIN_WEIGHT = 0.9;


// let shaderFlags = 0;

// function setFlag(flag: number, enabled: boolean) {
//     shaderFlags = enabled ? (shaderFlags | flag) : (shaderFlags & ~flag);
// }

// function toggleFlag(flag: number) {
//     shaderFlags ^= flag;
// }
// //#endregion --- Shader Feature Flags (bitmasks) 



// export class RenderSkySun {
//     private gui: GUI = new GUI();
//     private guiSettings!: {
//         bEnableCheckerboard: boolean;
//         fCheckerboardScale: number;
//         WindIntensity: number;
//         bEnableDust: boolean,
//         bEnableBreathing: boolean,
//         bEnableRefract: boolean;
//         bEnableHeatHaze: boolean;
//         bEnableLimbDarken: boolean;
//         bEnableFlare: boolean;
//         bEnableACES: boolean;
//         bEnableLensDirt: boolean;
//         fLensDirtWeight: number;
//         fLensDirtStep0: number;
//         fLensDirtStep1: number;
//         bEnableDither: boolean;
//         bEnableGrain: boolean;
//         GrainWeight: number;
//         CamPitch: number;
//         CamYaw: number;
//         CamRoll: number;
//         bEnableMultipleScattering: boolean;
//         EyeAttitude: number;
//         SunElevationDeg: number;
//         CameraFov: number;
//         AerosolTurbidity: number;
//     };

     
//     private prevRoll: number = 0.;
//     private prevPitch: number = 0.;
//     private prevYaw: number = 0.;


//     private movController: MovementController = new MovementController();
//     private keysPressed: Record<string, boolean> = {};
//     private anyKeysPressed: boolean = false;

//     private eyeAttitude: number = 0.05; // Camera height above ground, in kilometers. Affects atmospheric scattering calculations.
//     private lastEyeAttitude: number = 0.05;

//     private sunElevationDeg: number = DEF_SUN_ELEVATION_DEG;
//     private lastSunElevationDeg: number = DEF_SUN_ELEVATION_DEG; 
    
//     private aerosolTurbidity: number= 1.;
//     private lastAerosol: number = 1.;
//     private needsLutUpdate: boolean = true; // Flag to indicate if transmittance LUT needs updating
//     private needsScatteringUpdate: boolean = true; // Flag to indicate if scattering LUT needs updating


//     private renderer: THREE.WebGLRenderer;
//     private camera: THREE.OrthographicCamera;
//     private scene: THREE.Scene;
//     private quad: THREE.Mesh;

//     private timer = new THREE.Timer();

//     private passes = new RenderManager();


//     private constructor(canvas: HTMLCanvasElement, helpMenu: HTMLElement) {

//         this.renderer = new THREE.WebGLRenderer({
//             canvas,
//             context: canvas.getContext('webgl2')!,
//         });

//         this.renderer.autoClear = false;
//         this.renderer.setSize(canvas.width, canvas.height);

//         this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
//         this.scene = new THREE.Scene();
//         this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
//         this.scene.add(this.quad);

//         //this.initStats();
        
//         this.setupEventListeners(helpMenu);   
//     }


//     private setupEventListeners(helpMenu: HTMLElement) {
//         window.addEventListener('keydown', (e) => {
//             const key = e.key.toLowerCase();

//             //console.log("key: ", key);

//             this.keysPressed[key] = true;
//             this.anyKeysPressed = true;
             
//             if (key === 'escape') helpMenu.classList.toggle('hidden');
//             else if (key === 'b') toggleFlag(FLAG_ENABLE_DIRTY_LENS); 
//             else if (key === 'v') toggleFlag(FLAG_ENABLE_VIGNETTE);
//             else if (key === 'z') toggleFlag(FLAG_ENABLE_CHROMA_ABERRATION);
//             else if (key === 'l') toggleFlag(FLAG_ENABLE_LENSFLARE);
//             else if( key === '0') toggleFlag(FLAG_ENABLE_PHASE_SCATTER);
//             else if( key === '9') toggleFlag(FLAG_ENABLE_SHADOW); 
//         });

//         window.addEventListener('keyup', (e) => {
//             this.keysPressed[e.key.toLowerCase()] = false;
//             this.anyKeysPressed = false;
//         });
//     }


//     /**
//      * Initializes the RenderSkySun instance, sets up passes, and GUI controls.
//      * @param canvas The HTML canvas element to render on.
//      * @returns A promise that resolves to the RenderSkySun instance.
//      */
//     static async init( canvas: HTMLCanvasElement, helpMenu: HTMLElement): Promise<RenderSkySun> 
//     {
        
//         console.log('>> Initializing RenderSkySun...');

//         const instance = new RenderSkySun(canvas, helpMenu);
//         await instance.passes.init(canvas.width, canvas.height, canvas);

//         console.log('>> RenderSkySun 01');
//         setupKeyControls((value) => {
//             instance.passes.materials.get('skyImage')!.uniforms.u_keyPressed.value = value;
//         });

//         // Assume this uniform exists in your shader
//         const scatteringUniforms = instance.passes.materials.scattering.uniforms;
//         const transmittanceUniforms = instance.passes.materials.get('transmittance')?.uniforms;
//         const skyImageUniforms = instance.passes.materials.get('skyImage')!.uniforms;
//         const bokehImageUniforms = instance.passes.materials.bokehImage.uniforms;

//         // Set initial value for safety

//         scatteringUniforms.fEyeAttitude= scatteringUniforms.fEyeAttitude || { value: 0.05 };
//         scatteringUniforms.fAerosolTurbidity =  scatteringUniforms.fAerosolTurbidity || { value: 1.0 };
//         scatteringUniforms.bEnableMultipleScattering = scatteringUniforms.bEnableMultipleScattering|| { value: true };
//         scatteringUniforms.fSunElevationDeg = scatteringUniforms.fSunElevationDeg || { value: DEF_SUN_ELEVATION_DEG };
//         scatteringUniforms.fWindIntensity = scatteringUniforms.fWindIntensity || { value: DEF_WIND_INTENSITY };


//         transmittanceUniforms.fAerosolTurbidity = transmittanceUniforms.fAerosolTurbidity || { value: 1.0 };

        
//         skyImageUniforms.bEnableACES = skyImageUniforms.bEnableACES || { value: true };
//         skyImageUniforms.bEnableLensDirt = skyImageUniforms.bEnableLensDirt || {value: false};
//         skyImageUniforms.fLensDirtWeight = skyImageUniforms.fLensDirtWeight || {value: 0.7};
//         skyImageUniforms.fLensDirtStep0 = skyImageUniforms.fLensDirtStep0 || {value: 0.7};
//         skyImageUniforms.fLensDirtStep1 = skyImageUniforms.fLensDirtStep1 || {value: 3.2};
//         skyImageUniforms.bEnableCheckerboard = skyImageUniforms.bEnableCheckerboard || { value: false };
//         skyImageUniforms.fCheckerboardScale = skyImageUniforms.fCheckerboardScale || { value: 2.0 }; // Default scale for checkerboard pattern
//         skyImageUniforms.bEnableDust = skyImageUniforms.bEnableDust || { value: true};
//         skyImageUniforms.fWindIntensity = skyImageUniforms.fWindIntensity || { value: DEF_WIND_INTENSITY };
//         skyImageUniforms.bEnableRefract = skyImageUniforms.bEnableRefract|| {value: true};
//         skyImageUniforms.bEnableHeatHaze = skyImageUniforms.bEnableHeatHaze || {value: true};
//         skyImageUniforms.bEnableLimbDarken = skyImageUniforms.bEnableLimbDarken || { value: true};
//         skyImageUniforms.bEnableFlare = skyImageUniforms.bEnableFlare || { value: true };
//         skyImageUniforms.fEyeAttitude= skyImageUniforms.fEyeAttitude || { value: 0.05 };
//         skyImageUniforms.fSunElevationDeg = skyImageUniforms.fSunElevationDeg || { value: DEF_SUN_ELEVATION_DEG };
//         skyImageUniforms.fAerosolTurbidity = skyImageUniforms.fAerosolTurbidity || { value: 1.0 };

//         skyImageUniforms.uCameraMat.value.copy(instance.movController.cameraMat3);
//         skyImageUniforms.fCameraFov = skyImageUniforms.fCameraFov || { value: DEF_CAM_FOV };

//         bokehImageUniforms.bEnableDither = bokehImageUniforms.bEnableDither || { value: true};
//         bokehImageUniforms.bEnableGrain = bokehImageUniforms.bEnableGrain || { value: true };
        
//         // Create a settings object to link to GUI

//         instance.guiSettings = {
//             WindIntensity: scatteringUniforms.fWindIntensity.value || DEF_WIND_INTENSITY,
//             bEnableCheckerboard: skyImageUniforms.bEnableCheckerboard.value|| false,
//             fCheckerboardScale: skyImageUniforms.fCheckerboardScale.value || 2.0,
//             bEnableDust: skyImageUniforms.bEnableDust.value,
//             bEnableBreathing: true,
//             bEnableRefract: skyImageUniforms.bEnableRefract.value,
//             bEnableHeatHaze: skyImageUniforms.bEnableHeatHaze.value,
//             bEnableLimbDarken: skyImageUniforms.bEnableLimbDarken.value,
//             bEnableFlare: skyImageUniforms.bEnableFlare.value,
//             bEnableACES: skyImageUniforms.bEnableACES.value,
//             bEnableLensDirt: skyImageUniforms.bEnableLensDirt.value,
//             fLensDirtWeight: skyImageUniforms.fLensDirtWeight.value,
//             fLensDirtStep0: skyImageUniforms.fLensDirtStep0.value,
//             fLensDirtStep1: skyImageUniforms.fLensDirtStep1.value,
//             bEnableDither: bokehImageUniforms.bEnableDither? bokehImageUniforms.bEnableDither.value: false,
//             bEnableGrain: bokehImageUniforms.bEnableGrain ? bokehImageUniforms.bEnableGrain.value : false,
//             GrainWeight: DEFAULT_GRAIN_WEIGHT,
//             bEnableMultipleScattering: scatteringUniforms.bEnableMultipleScattering.value,
//             CamPitch: 0.,
//             CamYaw: 0.,
//             CamRoll: 0.0,
//             CameraFov: skyImageUniforms.fCameraFov.value || DEF_CAM_FOV,
//             EyeAttitude: scatteringUniforms.fEyeAttitude.value || 0.05,
//             SunElevationDeg: scatteringUniforms.fSunElevationDeg?.value || DEF_SUN_ELEVATION_DEG,
//             AerosolTurbidity: transmittanceUniforms.fAerosolTurbidity.value || 1.0

//         };

//         instance.prevRoll = instance.guiSettings.CamRoll;
//         instance.prevPitch = instance.guiSettings.CamPitch;
//         instance.prevYaw = instance.guiSettings.CamYaw;

//         //-----------------------------------------------------------------
//         {
//             const folder_atm = instance.gui.addFolder( 'ATMOSPHERE' );  
//             folder_atm.add(instance.guiSettings, 'bEnableMultipleScattering')
//                 .name(' ▪ m. scatter')
//                 .onChange((val: boolean) => {
//                     scatteringUniforms.bEnableMultipleScattering.value = val;
//                 });

//             folder_atm.add(instance.guiSettings, 'AerosolTurbidity', 0.1, 30.0, 0.1).decimals(2)
//                 .name(' ▪ aerosol')
//                 .listen()
//                 .onChange((val: number) => {
                    
//                     transmittanceUniforms.fAerosolTurbidity.value = val;
//                     scatteringUniforms.fAerosolTurbidity.value = val;
//                     skyImageUniforms.fAerosolTurbidity.value = val;
//                     instance.aerosolTurbidity = val;
                    
//                 });

//             folder_atm.add(instance.guiSettings, 'bEnableDust')
//             .name(' ▪ dust')
//             .onChange((val: boolean) => {
//                 skyImageUniforms.bEnableDust.value = val;
//             });

//             folder_atm.add(instance.guiSettings, 'WindIntensity', .0, 1.0, 0.05).decimals(2)
//                 .name(' ▪ wind int.')
//                 .listen()
//                 .onChange((val: number) => { 
//                     scatteringUniforms.fWindIntensity.value = val;
//                     skyImageUniforms.fWindIntensity.value = val;
//                 });

//         }
//         //-----------------------------------------------------------------


//         //-----------------------------------------------------------------
//         {
//             const folder_sun = instance.gui.addFolder( 'SUN EFFECT' );  
//             folder_sun.add(instance.guiSettings, 'bEnableRefract')
//                 .name(' ▪ refract')
//                 .onChange((val: boolean) => {
//                     skyImageUniforms.bEnableRefract.value = val;
//                 });

//             folder_sun.add(instance.guiSettings, 'bEnableHeatHaze')
//                 .name(' ▪ heat haze')
//                 .onChange((val: boolean) => {
//                     skyImageUniforms.bEnableHeatHaze.value = val;
//                 });

//             folder_sun.add(instance.guiSettings, 'bEnableLimbDarken')
//                 .name(' ▪ limb dark')
//                 .onChange((val: boolean) => {
//                     skyImageUniforms.bEnableLimbDarken.value = val;
//                 });

//             folder_sun.add(instance.guiSettings, 'SunElevationDeg', -20.0, 89.0, 0.1).decimals(1)
//                 .name(' ▪ elev. (deg)')
//                 .listen()
//                 .onChange((val: number) => { 
//                     skyImageUniforms.fSunElevationDeg.value = val;
//                     scatteringUniforms.fSunElevationDeg.value = val;
//                     instance.sunElevationDeg = val;
//             });
//         }
//         //-----------------------------------------------------------------

        


//         //-----------------------------------------------------------------
//         {
//             const folder_lensdirt = instance.gui.addFolder( 'LENS EFFECT' );

//             folder_lensdirt.add(instance.guiSettings, 'bEnableFlare')
//                 .name(' ▪ flare')
//                 .onChange((val: boolean) => {
//                     skyImageUniforms.bEnableFlare.value = val;
//                 });

//             folder_lensdirt.add(instance.guiSettings,'bEnableLensDirt')
//                 .name(' ▪ dirt')
//                 .onChange((val: boolean) => {
//                     skyImageUniforms.bEnableLensDirt.value = val;
//                 });

//             folder_lensdirt.add(instance.guiSettings, 'fLensDirtWeight', .0, 2., 0.1).decimals(1)
//                 .name(' ▪ dirt weight')
//                 .listen()
//                 .onChange((val: number) => { 
//                     skyImageUniforms.fLensDirtWeight.value = val;
//                 });

//             folder_lensdirt.add(instance.guiSettings, 'fLensDirtStep0', .0, 1., 0.1).decimals(1)
//                 .name(' ▪ dirt st0')
//                 .listen()
//                 .onChange((val: number) => { 
//                     skyImageUniforms.fLensDirtStep0.value = val;
//                 });

//             folder_lensdirt.add(instance.guiSettings, 'fLensDirtStep1', .0, 5., 0.1).decimals(1)
//                 .name(' ▪ dirt st1')
//                 .listen()
//                 .onChange((val: number) => { 
//                     skyImageUniforms.fLensDirtStep1.value = val;
//             });
//         }
//         //-----------------------------------------------------------------


//         //-----------------------------------------------------------------
//         {
//             const folder_cam = instance.gui.addFolder( 'CAMERA' );


//             folder_cam.add(instance.guiSettings, 'bEnableBreathing')
//                 .name(' ▪ breath')
//             //     .onChange((val: boolean) => {
//             //         //skyImageUniforms.bEnableRefract.value = val;
//             // });

//             folder_cam.add(instance.guiSettings, 'CamRoll', -180.0, 180.0, 0.1).decimals(1)
//                 .name(' ▪ roll')
//                 .listen()
//                 .onChange((val: number) => {

//                     let delta = val - instance.prevRoll;

//                     // Normalize delta into [-180, 180]
//                     if (delta > 180) delta -= 360;
//                     if (delta < -180) delta += 360;


//                     instance.prevRoll = val; // update stored value
//                     instance.movController.update(0, 0, delta* Math.PI/180.0); // apply delta in radians
//                     instance.passes.materials.get('skyImage')!.uniforms.uCameraMat.value.copy(instance.movController.cameraMat3); 
//                     return;
//                 });

//             folder_cam.add(instance.guiSettings, 'CamPitch', -90.0, 90.0, 1.0).decimals(1)
//                 .name(' ▪ pitch')
//                 .listen()
//                 .onChange((val: number) => {
//                     let delta = val - instance.prevPitch;
//                     // Normalize delta into [-180, 180]
//                     if (delta > 180) delta -= 360;
//                     if (delta < -180) delta += 360;

//                     //skyImageUniforms.fCameraPitch.value = val;
//                     instance.prevPitch = val; // update stored value
//                     instance.movController.update( delta* Math.PI/180.0, 0, 0); // apply delta in radians
//                     instance.passes.materials.get('skyImage')!.uniforms.uCameraMat.value.copy(instance.movController.cameraMat3); 
//                 });
//             folder_cam.add(instance.guiSettings, 'CamYaw', -180.0, 180.0,1.0).decimals(1)
//                 .name(' ▪ yaw')
//                 .listen()
//                 .onChange((val: number) => {
//                     let delta = val - instance.prevYaw
//                     // Normalize delta into [-180, 180]
//                     if (delta > 180) delta -= 360;
//                     if (delta < -180) delta += 360;
                

//                     //skyImageUniforms.fCameraYaw.value = val;
//                     instance.prevYaw = val; // update stored value
//                     instance.movController.update( 0, delta* Math.PI/180.0, 0); // apply delta in radians
//                     instance.passes.materials.get('skyImage')!.uniforms.uCameraMat.value.copy(instance.movController.cameraMat3); 
//                 });

//             folder_cam.add(instance.guiSettings, 'CameraFov', 1.0, 170.0, 0.1).decimals(1)
//                 .name(' ▪ fov')
//                 .listen()
//                 .onChange((val: number) => {
//                     // console.log('onchange, FOV:', val.toFixed(1));
//                     skyImageUniforms.fCameraFov.value = val;
//                     instance.movController.camFOV = val; 
//                 });

//             folder_cam.add(instance.guiSettings, 'EyeAttitude', 0.0, 80.0, 0.05).decimals(2)
//                 .name(' ▪ attitude')
//                 .listen()
//                 .onChange((val: number) => {
//                     val = Math.max( val, 0.01);
//                     scatteringUniforms.fEyeAttitude.value = val;
//                     skyImageUniforms.fEyeAttitude.value = val;
//                     instance.movController.camYPos = val;
//                     instance.eyeAttitude = val;
//                     //instance.guiSettings.EyeAttitude = val;
//                 });
//         }
        
//         //-----------------------------------------------------------------
//         {
//             const folder_pp = instance.gui.addFolder( 'POST-PROCESSING' );



//             folder_pp.add(instance.guiSettings, 'bEnableDither')
//                 .name(' ▪ de-band')
//                 .onChange((val: boolean) => {
//                     bokehImageUniforms.bEnableDither.value = val;
//                 });

//             folder_pp.add(instance.guiSettings, 'bEnableGrain')
//                 .name(' ▪ film grain')
//                 .onChange((val: boolean) => {
//                     bokehImageUniforms.bEnableGrain.value = val;
//                 });

//             folder_pp.add(instance.guiSettings, 'GrainWeight', .0, 2.5, 0.1).decimals(1)
//                 .name(' ▪ grain wgt.')
//                 .listen()
//                 .onChange((val: number) => { 
//                     bokehImageUniforms.fGrainWeight.value = val;
//                 });

//         }

//         {
//             const folder_tone = instance.gui.addFolder( 'TONE MAPPING' );

//              folder_tone.add(instance.guiSettings, 'bEnableACES')
//                 .name(' ▪ aces')
//                 .onChange((val: boolean) => {
//                     skyImageUniforms.bEnableACES.value = val;
//             });
//         }

//         {
//             const folder_debug = instance.gui.addFolder( 'DEBUG' );

//             folder_debug.add(instance.guiSettings, 'bEnableCheckerboard')
//                 .name(' ▪ checkerboard')
//                 .onChange((val: boolean) => {
//                     skyImageUniforms.bEnableCheckerboard.value = val;
//             });

//             folder_debug.add(instance.guiSettings, 'fCheckerboardScale', 1.0, 200.0, 1.).decimals(0)
//                 .name(' ▪ scale')
//                 .listen()
//                 .onChange((val: number) => { 
//                     skyImageUniforms.fCheckerboardScale.value = val; 
//             });

//         }
//          //-----------------------------------------------------------------

//         console.log('<< Initializing RenderSkySun...');
//         return instance; 
//     } // init <<<----


//     /**
//      * Renders the given material to the specified render target.
//      * @param material The shader material to render.
//      * @param target The WebGL render target to render to.
//      */
//     private async renderToTarget(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget) {
//         this.quad.material = material;
//         this.renderer.setRenderTarget(target);
//         this.renderer.render(this.scene, this.camera);
//         this.renderer.setRenderTarget(null);
//     } // renderToTarget <<<---
    
//     private setFinalDisplayMaterial() {
//         //this.quad.material = this.passes.materials.skyImage;
//         this.quad.material = this.passes.materials.get('bokehImage');
//     }

 

//         /** Update camera orientation based on keypresses */
//     // dt: number, delta time since last frame
//     private updateCameraOrientation(dt: number) 
//     {

//         const pitchDelta = (this.keysPressed["w"] ? 1 : 0) - (this.keysPressed["s"] ? 1 : 0);
//         const yawDelta   = (this.keysPressed["d"] ? 1 : 0) - (this.keysPressed["a"] ? 1 : 0);
//         const rollDelta  = (this.keysPressed["q"] ? 1 : 0) - (this.keysPressed["e"] ? 1 : 0);
//         const camYDelta = (this.keysPressed["r"] ? 1 : 0) - (this.keysPressed["f"] ? 1 : 0);
//         const camFOVDelta = (this.keysPressed["]"] ? 1 : 0) - (this.keysPressed["["] ? 1 : 0);


//         const dPitch = pitchDelta * 1.5 * dt;
//         const dYaw   = yawDelta   * 1.5 * dt;
//         const dRoll  = rollDelta  * 1.5 * dt;

//         const euler = this.movController.update(dPitch, dYaw, dRoll);

//         this.movController.camFOV += camFOVDelta * 20.0 * dt;
//         this.movController.camFOV = Math.min(170.0, Math.max(5.0, this.movController.camFOV)); // clamp FOV

        

//         let yStep = 1.0;
//         if (this.movController.camYPos > 10.0) yStep = 10.0;
//         else if (this.movController.camYPos > 30.0) yStep = 25.0;
//         else if (this.movController.camYPos > 50.0) yStep = 50.0;
//         this.movController.camYPos += camYDelta * yStep * dt;
//         this.movController.camYPos = Math.max(0.01, this.movController.camYPos); // prevent going below ground

 

        
//         this.passes.materials.scattering.uniforms.fEyeAttitude.value = this.movController.camYPos;

//         this.passes.materials.get('skyImage')!.uniforms.fCameraFov.value = this.movController.camFOV;
//         this.passes.materials.get('skyImage')!.uniforms.fEyeAttitude.value = this.movController.camYPos;
//         this.passes.materials.get('skyImage')!.uniforms.uCameraMat.value.copy(this.movController.cameraMat3); 
        
//         this.eyeAttitude = this.movController.camYPos;


//         this.prevRoll = euler.roll;
//         this.guiSettings.CamPitch = euler.pitch;
//         this.guiSettings.CamRoll = euler.roll;
//         this.guiSettings.CamYaw = euler.yaw; 
//         this.guiSettings.CameraFov = this.movController.camFOV;
//         this.guiSettings.EyeAttitude = this.movController.camYPos;
//         // this.updateSamplePt();
//         return;
//     }


//      private updateEnvironmentParams(dt: number) {
//         const sunELDelta = (this.keysPressed["'"] ? 1 : 0) - (this.keysPressed["/"] ? 1 : 0);
//         const aerosolDelta = (this.keysPressed[";"] ? 1 : 0) - (this.keysPressed["."] ? 1 : 0);

      
//         let elStep = 1.0;
//         if (this.sunElevationDeg > 3.0) elStep = 5.0;
//         else if(this.sunElevationDeg > 10.0) elStep = 20.0;
//         else if(this.sunElevationDeg > 20.0) elStep = 50.0;
//         else if(this.sunElevationDeg > 40.0) elStep = 100.0;

//         this.sunElevationDeg += sunELDelta * elStep * dt; 

//         this.sunElevationDeg = Math.min(89.0, Math.max(-20.0, this.sunElevationDeg)); // clamp
//         this.guiSettings.SunElevationDeg = this.sunElevationDeg;
        
//         this.aerosolTurbidity += aerosolDelta * 2.0 * dt;
//         this.aerosolTurbidity = Math.min(30.0, Math.max(0.1, this.aerosolTurbidity)); // clamp
//         this.guiSettings.AerosolTurbidity = this.aerosolTurbidity;
         

//         this.passes.materials.get('scattering')!.uniforms.fSunElevationDeg.value = this.sunElevationDeg;
//         this.passes.materials.get('scattering')!.uniforms.fAerosolTurbidity.value = this.aerosolTurbidity;
//         this.passes.materials.get('transmittance')!.uniforms.fAerosolTurbidity.value = this.aerosolTurbidity;
//         this.passes.materials.get('skyImage')!.uniforms.fAerosolTurbidity.value = this.aerosolTurbidity;
//         this.passes.materials.get('skyImage')!.uniforms.fSunElevationDeg.value = this.sunElevationDeg;
    

//         return;
//     }


//     /**
//      * Renders the scene using the renderer, updating uniforms and rendering passes.
//      * This method is called in the animation loop to continuously render the sky.
//      */

//     public render() {
//         // this.stats.begin();
//         this.needsScatteringUpdate = true

//         this.timer.update();
//         const dt = this.timer.getDelta();   // << Use delta for smooth motion
        

//         if( this.anyKeysPressed) {
            
//             this.updateCameraOrientation(dt);    // << Update orientation
//             this.updateEnvironmentParams(dt);      // << Update time of day
//         }
//         if (this.guiSettings.bEnableBreathing)
//         {
//             this.movController.applyIdleMotion(dt);
//             this.passes.materials.get('skyImage')!.uniforms.uCameraMat.value.copy(this.movController.cameraMat3); 
//         }

//         // 1. Check for "Dirty" state
//         // If the atmospheric parameters haven't changed, we skip the transmittance bake
//         if (Math.abs( this.aerosolTurbidity - this.lastAerosol) > 0.01 || this.needsLutUpdate) {
//             this.renderToTarget(this.passes.materials.transmittance, this.passes.renderTargets.transmittance!);
            
//             //this.lastAerosol = this.aerosolTurbidity
//             this.needsLutUpdate = false;
//             //console.log("Transmittance LUT updated."); 
//         }

//         if ( Math.abs( this.aerosolTurbidity - this.lastAerosol) > 0.01 ||
//             Math.abs(this.sunElevationDeg - this.lastSunElevationDeg) > 0.01 ||
//             Math.abs(this.eyeAttitude - this.lastEyeAttitude) > 0.01 ||
//             this.needsScatteringUpdate) {

//             this.lastEyeAttitude = this.eyeAttitude;
//             this.renderToTarget(this.passes.materials.scattering, this.passes.renderTargets.scattering!);
//             this.needsScatteringUpdate = false;
//             //console.log("Scattering LUT updated."); 
//         }

//         this.lastAerosol = this.aerosolTurbidity
 
//         // 2. Update Global Uniforms for dynamic passes
//         const elapsed = this.timer.getElapsed();
        
        
//         this.passes.globalUniforms.iTime.value = elapsed;
//         this.passes.globalUniforms.iFrame.value++; // Increment global frame counter 

//         // 3. Dynamic Passes (These still run every frame because sun/camera move)
//         this.renderToTarget(this.passes.materials.skyImage, this.passes.renderTargets.skyImage!);

//         // 4. Final Composition
//         // explicitly set the quad’s material before rendering the scene,
//         // This ensures the quad isn’t left with an intermediate material 
//         // (like transmittance or ing) after an offscreen render pass.
//         this.setFinalDisplayMaterial();
//         this.renderer.render(this.scene, this.camera);
    
//         // this.stats.end();
//     }

//     /**
//      * 
//      * @param width 
//      * @param height 
//      */
//     public resize(width: number, height: number) {

//         this.renderer.setSize(width, height);
//         this.passes.resize(width, height);
//         this.needsLutUpdate = true; // Mark LUT as needing update on resize, since resolution changes can affect it
//         this.needsScatteringUpdate = true; // Mark scattering LUT as needing update as well, since it may depend on resolution or other parameters
//         return;
//     }

   


// }