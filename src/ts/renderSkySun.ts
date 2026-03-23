
import * as THREE from 'three';
import GUI from 'lil-gui';
import { setupKeyControls } from './utils/KeyControls'; 
import { MovementController } from './utils/MovementController';
import { RenderManager } from './renderMng';



//#region --- Shader Feature Flags (bitmasks) 
// const FLAG_SHAKING = 1 << 0;
const FLAG_ENABLE_DIRTY_LENS = 1 << 1;
const FLAG_ENABLE_LENSFLARE = 1 << 2;
// const FLAG_CRT = 1 << 3;
const FLAG_ENABLE_CHROMA_ABERRATION = 1 << 4;
const FLAG_ENABLE_VIGNETTE = 1 << 5;
const FLAG_ENABLE_PHASE_SCATTER = 1 << 6; // New flag for phase scattering
const FLAG_ENABLE_SHADOW = 1 << 7; // New flag for crepuscular shadow effect    
 

const DEFAULT_GRAIN_WEIGHT = 0.9;


let shaderFlags = 0;

function setFlag(flag: number, enabled: boolean) {
    shaderFlags = enabled ? (shaderFlags | flag) : (shaderFlags & ~flag);
}

function toggleFlag(flag: number) {
    shaderFlags ^= flag;
}
//#endregion --- Shader Feature Flags (bitmasks) 



export class RenderSkySun {
    private gui: GUI = new GUI();
    private guiSettings!: {
        bEnableRefract: boolean;
        bEnableHeatHaze: boolean;
        bEnableLimbDarken: boolean;
        bEnableFlare: boolean;
        bEnableACES: boolean;
        bEnableLensDirt: boolean;
        bEnableDither: boolean;
        bEnableGrain: boolean;
        GrainWeight: number;
        CamPitch: number;
        CamYaw: number;
        CamRoll: number;
        bEnableMultipleScattering: boolean;
        EyeAttitude: number;
        SunElevationDeg: number;
        CameraFov: number;
        AerosolTurbidity: number;
    };

    
    private prevRoll: number = 0.;
    private prevPitch: number = 0.;
    private prevYaw: number = 0.;


    private movController: MovementController = new MovementController();
    private keysPressed: Record<string, boolean> = {};
    private anyKeysPressed: boolean = false;

    private eyeAttitude: number = 0.05; // Camera height above ground, in kilometers. Affects atmospheric scattering calculations.
    private lastEyeAttitude: number = 0.05;

    private sunElevationDeg: number = 0.;
    private lastSunElevationDeg: number = 0.; 
    
    private aerosolTurbidity: number= 1.;
    private lastAerosol: number = 1.;
    private needsLutUpdate: boolean = true; // Flag to indicate if transmittance LUT needs updating
    private needsScatteringUpdate: boolean = true; // Flag to indicate if scattering LUT needs updating


    private renderer: THREE.WebGLRenderer;
    private camera: THREE.OrthographicCamera;
    private scene: THREE.Scene;
    private quad: THREE.Mesh;

    private timer = new THREE.Timer();

    private passes = new RenderManager();


    private constructor(canvas: HTMLCanvasElement, helpMenu: HTMLElement) {

        this.renderer = new THREE.WebGLRenderer({
            canvas,
            context: canvas.getContext('webgl2')!,
        });

        this.renderer.autoClear = false;
        this.renderer.setSize(canvas.width, canvas.height);

        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.scene = new THREE.Scene();
        this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
        this.scene.add(this.quad);

        //this.initStats();
        
        this.setupEventListeners(helpMenu);   
    }


    private setupEventListeners(helpMenu: HTMLElement) {
        window.addEventListener('keydown', (e) => {
            const key = e.key.toLowerCase();

            //console.log("key: ", key);

            this.keysPressed[key] = true;
            this.anyKeysPressed = true;
             
            if (key === 'escape') helpMenu.classList.toggle('hidden');
            else if (key === 'b') toggleFlag(FLAG_ENABLE_DIRTY_LENS); 
            else if (key === 'v') toggleFlag(FLAG_ENABLE_VIGNETTE);
            else if (key === 'z') toggleFlag(FLAG_ENABLE_CHROMA_ABERRATION);
            else if (key === 'l') toggleFlag(FLAG_ENABLE_LENSFLARE);
            else if( key === '0') toggleFlag(FLAG_ENABLE_PHASE_SCATTER);
            else if( key === '9') toggleFlag(FLAG_ENABLE_SHADOW); 
        });

        window.addEventListener('keyup', (e) => {
            this.keysPressed[e.key.toLowerCase()] = false;
            this.anyKeysPressed = false;
        });
    }


    /**
     * Initializes the RenderSkySun instance, sets up passes, and GUI controls.
     * @param canvas The HTML canvas element to render on.
     * @returns A promise that resolves to the RenderSkySun instance.
     */
    static async init( canvas: HTMLCanvasElement, helpMenu: HTMLElement): Promise<RenderSkySun> 
    {
        
        console.log('>> Initializing RenderSkySun...');

        const instance = new RenderSkySun(canvas, helpMenu);
        await instance.passes.init(canvas.width, canvas.height, canvas);

        console.log('>> RenderSkySun 01');
        setupKeyControls((value) => {
            instance.passes.materials.skyImage.uniforms.u_keyPressed.value = value;
        });

        // Assume this uniform exists in your shader
        const scatteringUniforms = instance.passes.materials.scattering.uniforms;
        const transmittanceUniforms = instance.passes.materials.transmittance.uniforms;
        const skyImageUniforms = instance.passes.materials.skyImage.uniforms;
        const bokehImageUniforms = instance.passes.materials.bokehImage.uniforms;

        // Set initial value for safety

        scatteringUniforms.fEyeAttitude= scatteringUniforms.fEyeAttitude || { value: 0.05 };
        scatteringUniforms.fAerosolTurbidity =  scatteringUniforms.fAerosolTurbidity || { value: 1.0 };
        scatteringUniforms.bEnableMultipleScattering = scatteringUniforms.bEnableMultipleScattering|| { value: true };
        scatteringUniforms.fSunElevationDeg = scatteringUniforms.fSunElevationDeg || { value: 0.0 };

        transmittanceUniforms.fAerosolTurbidity = transmittanceUniforms.fAerosolTurbidity || { value: 1.0 };

        
        skyImageUniforms.bEnableACES = skyImageUniforms.bEnableACES || { value: true };
        skyImageUniforms.bEnableLensDirt = skyImageUniforms.bEnableLensDirt || {value: true};
        skyImageUniforms.bEnableRefract = skyImageUniforms.bEnableRefract|| {value: true};
        skyImageUniforms.bEnableHeatHaze = skyImageUniforms.bEnableHeatHaze || {value: true};
        skyImageUniforms.bEnableLimbDarken = skyImageUniforms.bEnableLimbDarken || { value: true};
        skyImageUniforms.bEnableFlare = skyImageUniforms.bEnableFlare || { value: true };
        skyImageUniforms.fEyeAttitude= skyImageUniforms.fEyeAttitude || { value: 0.05 };
        skyImageUniforms.fSunElevationDeg = skyImageUniforms.fSunElevationDeg || { value: 0.0 };
        skyImageUniforms.fAerosolTurbidity = skyImageUniforms.fAerosolTurbidity || { value: 1.0 };

        skyImageUniforms.uCameraMat.value.copy(instance.movController.cameraMat3);
        skyImageUniforms.fCameraFov = skyImageUniforms.fCameraFov || { value: 80.0 };

        bokehImageUniforms.bEnableDither = bokehImageUniforms.bEnableDither || { value: true};
        bokehImageUniforms.bEnableGrain = bokehImageUniforms.bEnableGrain || { value: true };
        
        // Create a settings object to link to GUI

        instance.guiSettings = {
            bEnableRefract: skyImageUniforms.bEnableRefract.value,
            bEnableHeatHaze: skyImageUniforms.bEnableHeatHaze.value,
            bEnableLimbDarken: skyImageUniforms.bEnableLimbDarken.value,
            bEnableFlare: skyImageUniforms.bEnableFlare.value,
            bEnableACES: skyImageUniforms.bEnableACES.value,
            bEnableLensDirt: skyImageUniforms.bEnableLensDirt.value,
            bEnableDither: bokehImageUniforms.bEnableDither? bokehImageUniforms.bEnableDither.value: false,
            bEnableGrain: bokehImageUniforms.bEnableGrain ? bokehImageUniforms.bEnableGrain.value : false,
            GrainWeight: DEFAULT_GRAIN_WEIGHT,
            bEnableMultipleScattering: scatteringUniforms.bEnableMultipleScattering.value,
            CamPitch: 0.,
            CamYaw: 0.,
            CamRoll: 0.0,
            CameraFov: skyImageUniforms.fCameraFov.value || 80.0,
            EyeAttitude: scatteringUniforms.fEyeAttitude.value || 0.05,
            SunElevationDeg: scatteringUniforms.fSunElevationDeg?.value || 0.0,
            AerosolTurbidity: transmittanceUniforms.fAerosolTurbidity.value || 1.0

        };

        instance.prevRoll = instance.guiSettings.CamRoll;
        instance.prevPitch = instance.guiSettings.CamPitch;
        instance.prevYaw = instance.guiSettings.CamYaw;

        instance.gui.add(instance.guiSettings, 'bEnableRefract')
            .name('Refract')
            .onChange((val: boolean) => {
                skyImageUniforms.bEnableRefract.value = val;
            });

        instance.gui.add(instance.guiSettings, 'bEnableHeatHaze')
            .name('Heat Haze')
            .onChange((val: boolean) => {
                skyImageUniforms.bEnableHeatHaze.value = val;
            });

        instance.gui.add(instance.guiSettings, 'bEnableLimbDarken')
            .name('Limb Dark')
            .onChange((val: boolean) => {
                skyImageUniforms.bEnableLimbDarken.value = val;
            });

        instance.gui.add(instance.guiSettings, 'bEnableFlare')
            .name('Lens Flare')
            .onChange((val: boolean) => {
                skyImageUniforms.bEnableFlare.value = val;
            });
        
        instance.gui.add(instance.guiSettings, 'bEnableACES')
            .name('ACES')
            .onChange((val: boolean) => {
                skyImageUniforms.bEnableACES.value = val;
            });

        instance.gui.add(instance.guiSettings,'bEnableLensDirt')
            .name('Lens Dirt')
            .onChange((val: boolean) => {
                skyImageUniforms.bEnableLensDirt.value = val;
            });

        instance.gui.add(instance.guiSettings, 'bEnableMultipleScattering')
            .name('M.Scatter')
            .onChange((val: boolean) => {
                scatteringUniforms.bEnableMultipleScattering.value = val;
            });

        instance.gui.add(instance.guiSettings, 'bEnableDither')
            .name('DeBand')
            .onChange((val: boolean) => {
                bokehImageUniforms.bEnableDither.value = val;
            });

        instance.gui.add(instance.guiSettings, 'bEnableGrain')
            .name('Film Grain')
            .onChange((val: boolean) => {
                bokehImageUniforms.bEnableGrain.value = val;
            });

        instance.gui.add(instance.guiSettings, 'GrainWeight', .0, 2.5, 0.1).decimals(1)
            .name('Grain Wgt.')
            .listen()
            .onChange((val: number) => { 
                bokehImageUniforms.fGrainWeight.value = val;
            });

        instance.gui.add(instance.guiSettings, 'CamRoll', -180.0, 180.0, 0.1).decimals(1)
            .name('Cam. Roll')
            .listen()
            .onChange((val: number) => {

                let delta = val - instance.prevRoll;

                // Normalize delta into [-180, 180]
                if (delta > 180) delta -= 360;
                if (delta < -180) delta += 360;


                instance.prevRoll = val; // update stored value
                instance.movController.update(0, 0, delta* Math.PI/180.0); // apply delta in radians
                instance.passes.materials.skyImage.uniforms.uCameraMat.value.copy(instance.movController.cameraMat3); 
                return;
            });

        instance.gui.add(instance.guiSettings, 'CamPitch', -90.0, 90.0, 1.0).decimals(1)
            .name('Cam. Pitch')
            .listen()
            .onChange((val: number) => {
                let delta = val - instance.prevPitch;
                // Normalize delta into [-180, 180]
                if (delta > 180) delta -= 360;
                if (delta < -180) delta += 360;

                //skyImageUniforms.fCameraPitch.value = val;
                instance.prevPitch = val; // update stored value
                instance.movController.update( delta* Math.PI/180.0, 0, 0); // apply delta in radians
                instance.passes.materials.skyImage.uniforms.uCameraMat.value.copy(instance.movController.cameraMat3); 
            });
        instance.gui.add(instance.guiSettings, 'CamYaw', -180.0, 180.0,1.0).decimals(1)
            .name('Cam. Yaw')
            .listen()
            .onChange((val: number) => {
                let delta = val - instance.prevYaw
                // Normalize delta into [-180, 180]
                if (delta > 180) delta -= 360;
                if (delta < -180) delta += 360;
               

                //skyImageUniforms.fCameraYaw.value = val;
                instance.prevYaw = val; // update stored value
                instance.movController.update( 0, delta* Math.PI/180.0, 0); // apply delta in radians
                instance.passes.materials.skyImage.uniforms.uCameraMat.value.copy(instance.movController.cameraMat3); 
            });

        instance.gui.add(instance.guiSettings, 'CameraFov', 1.0, 170.0, 0.1).decimals(1)
            .name('Cam. FOV')
            .listen()
            .onChange((val: number) => {
                // console.log('onchange, FOV:', val.toFixed(1));
                skyImageUniforms.fCameraFov.value = val;
                instance.movController.camFOV = val; 
            });

        instance.gui.add(instance.guiSettings, 'EyeAttitude', 0.00, 80.0, 0.05).decimals(2)
            .name('Attitude')
            .listen()
            .onChange((val: number) => {
                scatteringUniforms.fEyeAttitude.value = val;
                skyImageUniforms.fEyeAttitude.value = val;
                instance.movController.camYPos = val;
                instance.eyeAttitude = val;
                //instance.guiSettings.EyeAttitude = val;
            });

        instance.gui.add(instance.guiSettings, 'SunElevationDeg', -20.0, 89.0, 0.2).decimals(1)
            .name('Sun El.')
            .listen()
            .onChange((val: number) => { 
                skyImageUniforms.fSunElevationDeg.value = val;
                scatteringUniforms.fSunElevationDeg.value = val;
                instance.sunElevationDeg = val;
            });

        instance.gui.add(instance.guiSettings, 'AerosolTurbidity', 0.1, 30.0, 0.1).decimals(1)
            .name('Aerosol')
            .listen()
            .onChange((val: number) => {
                 
                transmittanceUniforms.fAerosolTurbidity.value = val;
                scatteringUniforms.fAerosolTurbidity.value = val;
                skyImageUniforms.fAerosolTurbidity.value = val;
                instance.aerosolTurbidity = val;
                
            });

        console.log('<< Initializing RenderSkySun...');
        return instance; 
    } // init <<<----


    /**
     * Renders the given material to the specified render target.
     * @param material The shader material to render.
     * @param target The WebGL render target to render to.
     */
    private async renderToTarget(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget) {
        this.quad.material = material;
        this.renderer.setRenderTarget(target);
        this.renderer.render(this.scene, this.camera);
        this.renderer.setRenderTarget(null);
    } // renderToTarget <<<---
    
    private setFinalDisplayMaterial() {
        //this.quad.material = this.passes.materials.skyImage;
        this.quad.material = this.passes.materials.bokehImage;
    }

 

        /** Update camera orientation based on keypresses */
    // dt: number, delta time since last frame
    private updateCameraOrientation(dt: number) 
    {

        const pitchDelta = (this.keysPressed["w"] ? 1 : 0) - (this.keysPressed["s"] ? 1 : 0);
        const yawDelta   = (this.keysPressed["d"] ? 1 : 0) - (this.keysPressed["a"] ? 1 : 0);
        const rollDelta  = (this.keysPressed["q"] ? 1 : 0) - (this.keysPressed["e"] ? 1 : 0);
        const camYDelta = (this.keysPressed["r"] ? 1 : 0) - (this.keysPressed["f"] ? 1 : 0);
        const camFOVDelta = (this.keysPressed["]"] ? 1 : 0) - (this.keysPressed["["] ? 1 : 0);


        const dPitch = pitchDelta * 1.5 * dt;
        const dYaw   = yawDelta   * 1.5 * dt;
        const dRoll  = rollDelta  * 1.5 * dt;

        const euler = this.movController.update(dPitch, dYaw, dRoll);

        this.movController.camFOV += camFOVDelta * 20.0 * dt;
        this.movController.camFOV = Math.min(170.0, Math.max(5.0, this.movController.camFOV)); // clamp FOV

        

        let yStep = 1.0;
        if (this.movController.camYPos > 10.0) yStep = 10.0;
        else if (this.movController.camYPos > 30.0) yStep = 25.0;
        else if (this.movController.camYPos > 50.0) yStep = 50.0;
        this.movController.camYPos += camYDelta * yStep * dt;
        this.movController.camYPos = Math.max(0.01, this.movController.camYPos); // prevent going below ground

 

        
        this.passes.materials.scattering.uniforms.fEyeAttitude.value = this.movController.camYPos;

        this.passes.materials.skyImage.uniforms.fCameraFov.value = this.movController.camFOV;
        this.passes.materials.skyImage.uniforms.fEyeAttitude.value = this.movController.camYPos;
        this.passes.materials.skyImage.uniforms.uCameraMat.value.copy(this.movController.cameraMat3); 
        
        this.eyeAttitude = this.movController.camYPos;


        this.prevRoll = euler.roll;
        this.guiSettings.CamPitch = euler.pitch;
        this.guiSettings.CamRoll = euler.roll;
        this.guiSettings.CamYaw = euler.yaw; 
        this.guiSettings.CameraFov = this.movController.camFOV;
        this.guiSettings.EyeAttitude = this.movController.camYPos;
        // this.updateSamplePt();
        return;
    }


     private updateEnvironmentParams(dt: number) {
        const sunELDelta = (this.keysPressed["'"] ? 1 : 0) - (this.keysPressed["/"] ? 1 : 0);
        const aerosolDelta = (this.keysPressed[";"] ? 1 : 0) - (this.keysPressed["."] ? 1 : 0);

      
        let elStep = 1.0;
        if (this.sunElevationDeg > 3.0) elStep = 5.0;
        else if(this.sunElevationDeg > 10.0) elStep = 20.0;
        else if(this.sunElevationDeg > 20.0) elStep = 50.0;
        else if(this.sunElevationDeg > 40.0) elStep = 100.0;

        this.sunElevationDeg += sunELDelta * elStep * dt; 

        this.sunElevationDeg = Math.min(89.0, Math.max(-20.0, this.sunElevationDeg)); // clamp
        this.guiSettings.SunElevationDeg = this.sunElevationDeg;
        
        this.aerosolTurbidity += aerosolDelta * 2.0 * dt;
        this.aerosolTurbidity = Math.min(30.0, Math.max(0.1, this.aerosolTurbidity)); // clamp
        this.guiSettings.AerosolTurbidity = this.aerosolTurbidity;
         

        this.passes.materials.scattering.uniforms.fSunElevationDeg.value = this.sunElevationDeg;
        this.passes.materials.scattering.uniforms.fAerosolTurbidity.value = this.aerosolTurbidity;
        this.passes.materials.transmittance.uniforms.fAerosolTurbidity.value = this.aerosolTurbidity;
        this.passes.materials.skyImage.uniforms.fAerosolTurbidity.value = this.aerosolTurbidity;
        this.passes.materials.skyImage.uniforms.fSunElevationDeg.value = this.sunElevationDeg;
    

        return;
    }


    /**
     * Renders the scene using the renderer, updating uniforms and rendering passes.
     * This method is called in the animation loop to continuously render the sky.
     */

    public render() {
        // this.stats.begin();

        this.timer.update();
        const dt = this.timer.getDelta();   // << Use delta for smooth motion
        

        if( this.anyKeysPressed) {
            
            this.updateCameraOrientation(dt);    // << Update orientation
            this.updateEnvironmentParams(dt);      // << Update time of day
        }
        {
            this.movController.applyIdleMotion(dt);
            this.passes.materials.skyImage.uniforms.uCameraMat.value.copy(this.movController.cameraMat3); 
        }

        // 1. Check for "Dirty" state
        // If the atmospheric parameters haven't changed, we skip the transmittance bake
        if (Math.abs( this.aerosolTurbidity - this.lastAerosol) > 0.01 || this.needsLutUpdate) {
            this.renderToTarget(this.passes.materials.transmittance, this.passes.renderTargets.transmittance!);
            
            //this.lastAerosol = this.aerosolTurbidity
            this.needsLutUpdate = false;
            console.log("Transmittance LUT updated."); 
        }

        if ( Math.abs( this.aerosolTurbidity - this.lastAerosol) > 0.01 ||
            Math.abs(this.sunElevationDeg - this.lastSunElevationDeg) > 0.01 ||
            Math.abs(this.eyeAttitude - this.lastEyeAttitude) > 0.01 ||
            this.needsScatteringUpdate) {

            this.lastEyeAttitude = this.eyeAttitude;
            this.renderToTarget(this.passes.materials.scattering, this.passes.renderTargets.scattering!);
            this.needsScatteringUpdate = false;
            console.log("Scattering LUT updated."); 
        }

        this.lastAerosol = this.aerosolTurbidity
 
        // 2. Update Global Uniforms for dynamic passes
        const elapsed = this.timer.getElapsed();
        
        
        this.passes.globalUniforms.iTime.value = elapsed;
        this.passes.globalUniforms.iFrame.value++; // Increment global frame counter 

        // 3. Dynamic Passes (These still run every frame because sun/camera move)
        this.renderToTarget(this.passes.materials.skyImage, this.passes.renderTargets.skyImage!);

        // 4. Final Composition
        // explicitly set the quad’s material before rendering the scene,
        // This ensures the quad isn’t left with an intermediate material 
        // (like transmittance or ing) after an offscreen render pass.
        this.setFinalDisplayMaterial();
        this.renderer.render(this.scene, this.camera);
    
        // this.stats.end();
    }

    /**
     * 
     * @param width 
     * @param height 
     */
    public resize(width: number, height: number) {

        this.renderer.setSize(width, height);
        this.passes.resize(width, height);
        this.needsLutUpdate = true; // Mark LUT as needing update on resize, since resolution changes can affect it
        this.needsScatteringUpdate = true; // Mark scattering LUT as needing update as well, since it may depend on resolution or other parameters
        return;
    }

   


}