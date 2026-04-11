
import * as THREE from 'three';
import { createRenderTarget, createShaderMaterial, injectIncludes, loadShader } from './utils/GLSUtils';
import { loadRGBA64DitherTexture, createFallbackTexture} from './utils/TextureUtils';

/** --- CONSTANTS --- */
const SETTINGS = {
	 ENABLE_DUST: true,
    WIND_INTENSITY: 0.5,
    SUN_ELEVATION: 5.0,
    CAM_FOV: 80.0,
    GRAIN_WEIGHT: 0.9,
    LENS_DIRT_PATH: '/assets/textures/Texturelabs_LensFX_217S_med.jpg',
    BLUE_NOISE_PATH: '/assets/textures/bn_mask_512_512.png'
};

const RT_KEYS = ['transmittance', 'scattering', 'skyImage'] as const;
type RenderTargetName = typeof RT_KEYS[number];

/**
 * Manages the WebGL Post-Processing and Atmosphere Pipeline.
 * Organized by execution order: Textures -> Shaders -> Materials -> RenderTargets.
 */
export class RenderManager {
    // Global state shared across all shaders
    public readonly globalUniforms = {
        iTime: { value: 0 },
        iFrame: { value: 0 },
        iResolution: { value: new THREE.Vector3() }
    };

    private canvas!: HTMLCanvasElement;
    private texAspect: number = 1.0;

    // Registry for easy access and resizing
    public readonly materials: Map<string, THREE.ShaderMaterial> = new Map();
    public readonly renderTargets: Map<RenderTargetName, THREE.WebGLRenderTarget> = new Map();

    /**
     * Entry point for the rendering pipeline.
     */
    async init(width: number, height: number, canvas: HTMLCanvasElement): Promise<void> {
        this.canvas = canvas;
        this.globalUniforms.iResolution.value.set(width, height, 1);

        try {
            const textures = await RenderManager.loadAssets();
            const shaderSources = await this.loadShaderSources();
            
            this.setupPipeline(width, height, shaderSources, textures);
            
            // Set initial aspect ratio for lens effects
            this.texAspect = (textures.lensDirt.image as HTMLImageElement).width / 
                             (textures.lensDirt.image as HTMLImageElement).height;
            this.updateLensDirtScale();

            console.log('>> RenderManager: Pipeline initialized successfully');
        } catch (error) {
            console.error('>> RenderManager: Initialization failed', error);
            throw error;
        }
    }

    /**
     * Orchestrates the creation of materials and their links (channels).
     */
    private setupPipeline(
        width: number, 
        height: number, 
        shaders: Record<string, string>, 
        textures: { lensDirt: THREE.Texture, blueNoise: THREE.Texture }
    ): void {
        const includeMap = {
            'atmosphere.glsl': shaders.common,
            'math.glsl': shaders.math,
            'noise.glsl': shaders.noise,
            'tonemapping.glsl': shaders.tonemapping,
            'img-patterns.glsl': shaders.patterns,
            'dust_fog.glsl': shaders.dust
        };

        // 1. Setup Render Targets
        RT_KEYS.forEach(key => {
            this.renderTargets.set(key, createRenderTarget(width, height));
        });

        // 2. Build Materials
        // Transmittance Pass
        const matTrans = createShaderMaterial(
            'Transmittance', width, height, 
            injectIncludes(shaders.transmittance, includeMap),
            { fAerosolTurbidity: { value: 1.0 } },
            this.globalUniforms
        );
        this.materials.set('transmittance', matTrans);

        // Scattering Pass
        const matScat = createShaderMaterial(
            'Scattering', width, height, 
            injectIncludes(shaders.scattering, includeMap),
            {
                bEnableMultipleScattering: { value: true },
                fEyeAttitude: { value: 0.05 },
                fSunElevationDeg: { value: SETTINGS.SUN_ELEVATION },
                fAerosolTurbidity: { value: 1.0 },
                fWindIntensity: { value: SETTINGS.WIND_INTENSITY },
                uBlueNoiseTex: { value: textures.blueNoise },
                iChannel0: { value: this.renderTargets.get('transmittance')?.texture }
            },
            this.globalUniforms
        );
        this.materials.set('scattering', matScat);

        // Final Composition (SkyImage)
        const matSky = createShaderMaterial(
            'SkyImage', width, height, 
            injectIncludes(shaders.skyImage, includeMap),
            {
					uUVScale: { value: new THREE.Vector2(1.0, 1.0) },
					uCameraMat: { value: new THREE.Matrix3() },
					iChannel0: { value: this.renderTargets.get('scattering')?.texture },
					iChannel1: { value: this.renderTargets.get('transmittance')?.texture },
					iChannel2: { value: textures.lensDirt },
					fCameraPitch: { value: -7.0 },
					fCameraYaw: { value: 0.0 },
					fCameraFov: { value: SETTINGS.CAM_FOV },
					fAerosolTurbidity: { value: 1.0 },
					bEnableDust: { value: SETTINGS.ENABLE_DUST },
					fWindIntensity: { value: SETTINGS.WIND_INTENSITY },
					bEnableRefract: { value: true },
					bEnableHeatHaze: { value: true },
					bEnableLimbDarken: { value: true },
					bEnableFlare: { value: true },	
					bEnableLensDirt: { value: false },
					bEnableACES: { value: true },
					fLensDirtWeight: {value: 0.7},
					fLensDirtStep0: {value: 0.7},
					fLensDirtStep1: {value: 3.2},
					fEyeAttitude: {value: 0.05}, 
					fSunElevationDeg: { value: SETTINGS.SUN_ELEVATION },
					bEnableCheckerboard: { value: false },
					fCheckerboardScale: { value: 1.0 },
					u_keyPressed: { value: 0 }
            },
            this.globalUniforms
        );
        this.materials.set('skyImage', matSky);

        // Bokeh/Post-process Pass
        const matBokeh = createShaderMaterial(
            'BokehImage', width, height, 
            injectIncludes(shaders.bokeh, includeMap),
            {
                 
                uBlueNoiseTex: { value: textures.blueNoise },
                iChannel0: { value: this.renderTargets.get('skyImage')?.texture },
					 bEnableDither: { value: true },
					bEnableGrain: { value: true },
					fGrainWeight: { value: SETTINGS.GRAIN_WEIGHT },

            },
            this.globalUniforms
        );
        this.materials.set('bokehImage', matBokeh);
    }

    /**
     * Resizes all internal buffers. Called on window resize.
     */
    public resize(width: number, height: number): void {
        this.globalUniforms.iResolution.value.set(width, height, 1);
        
        this.materials.forEach(mat => {
            mat.uniforms.iResolution.value.set(width, height, 1);
        });

        this.renderTargets.forEach(rt => {
            rt.setSize(width, height);
        });

        this.updateLensDirtScale();
    }

    /**
     * Updates UV scaling to maintain texture aspect ratio (Letterboxing/Fitting).
     */
    private updateLensDirtScale(): void {
        const mat = this.materials.get('skyImage');
        if (!mat) return;

        const screenAspect = this.canvas.width / this.canvas.height;
        const scale = new THREE.Vector2(1.0, 1.0);

        if (screenAspect > this.texAspect) {
            scale.y = this.texAspect / screenAspect;
        } else {
            scale.x = screenAspect / this.texAspect;
        }

        mat.uniforms.uUVScale.value.copy(scale);
    }

    /** --- ASSET LOADERS --- */

    private async loadShaderSources() {
        const [common, math, noise, tonemapping, patterns, dust, transmittance, scattering, skyImage, bokeh] = 
        await Promise.all([
            loadShader('src/shaders/atmosphere.glsl'),
            loadShader('src/shaders/math.glsl'),
            loadShader('src/shaders/noise.glsl'),
            loadShader('src/shaders/tonemapping.glsl'),
            loadShader('src/shaders/img-patterns.glsl'),
            loadShader('src/shaders/dust_fog.glsl'),
            loadShader('src/shaders/transmittance.frag.glsl'),
            loadShader('src/shaders/scattering.frag.glsl'),
            loadShader('src/shaders/skyImage.frag.glsl'),
            loadShader('src/shaders/bokehImage.frag.glsl')
        ]);

        return { common, math, noise, tonemapping, patterns, dust, transmittance, scattering, skyImage, bokeh };
    }

    private static async loadAssets(): Promise<{ lensDirt: THREE.Texture, blueNoise: THREE.Texture }> {
        const load = async (path: string, name: string) => {
            try {
                return await loadRGBA64DitherTexture(path);
            } catch (e) {
                console.warn(`Failed to load ${name}, using fallback.`);
                return createFallbackTexture();
            }
        };

        const [lensDirt, blueNoise] = await Promise.all([
            load(SETTINGS.LENS_DIRT_PATH, 'Lens Dirt'),
            load(SETTINGS.BLUE_NOISE_PATH, 'Blue Noise')
        ]);

        return { lensDirt, blueNoise };
    }
}
//----------------------------
// const DEF_WIND_INTENSITY = 0.5;
// const DEF_SUN_ELEVATION_DEG = 5.0;
// const DEF_CAM_FOV = 80.;

// const RT_KEYS = ['transmittance', 'scattering', 'skyImage'] as const;
// type RenderTargetName = typeof RT_KEYS[number];


// const DEFAULT_GRAIN_WEIGHT = 0.9;

// /**
//  * RenderManager is responsible for managing the rendering process of the sky system.
//  * It initializes the necessary materials and render targets, and provides methods to resize them.
//  */
// export class RenderManager {
 
//     globalUniforms = {
//         iTime: { value: 0 },
//         iFrame: { value: 0 }
//     };

//     private canvas!: HTMLCanvasElement;
//     private texAspect: number = 1.0; 

//     /**
//      * A map of shader materials used in the rendering process.
//      * Each key corresponds to a specific rendering pass.
//      */
//     materials: Record<string, THREE.ShaderMaterial> = {};
//     renderTargets: Partial<Record<RenderTargetName, THREE.WebGLRenderTarget>> = {};

//     /**
//      * 
//      * @param width 
//      * @param height 
//      * @param canvas 
//      */
//     async init(width: number, height: number, canvas: HTMLCanvasElement): Promise<void> {

//         console.log('>> RenderManager init');
//         this.canvas = canvas;

//         const {  lensDirtTex512, blueNoise512 } = 
//             await RenderManager.loadTextures();

        
//         console.log('>> RenderManager init - Textures Loaded');
//         const [
//             commonGLSL,
//             commonMathGLSL,
//             commonNoiseGLSL,
//             tonemappingGLSL,
//             imgPatternsGLSL,
//             dustFogGLSL,
//             transmittanceGLSL,
//             scatteringGLSL,
//             skyImageGLSL,
//             bokehImageGLSL
//         ] = await Promise.all([
//             loadShader('src/shaders/atmosphere.glsl'),
//             loadShader('src/shaders/math.glsl'),
//             loadShader('src/shaders/noise.glsl'),
//             loadShader('src/shaders/tonemapping.glsl'),
//             loadShader('src/shaders/img-patterns.glsl'),
//             loadShader('src/shaders/dust_fog.glsl'),
//             loadShader('src/shaders/transmittance.frag.glsl'),
//             loadShader('src/shaders/scattering.frag.glsl'),
//             loadShader('src/shaders/skyImage.frag.glsl'),
//             loadShader('src/shaders/bokehImage.frag.glsl')
//         ]);
//         console.log('>> RenderManager init - Shaders Loaded');

//         const includeMap = { 
//             'atmosphere.glsl': commonGLSL,
//             'math.glsl': commonMathGLSL,
//             'noise.glsl': commonNoiseGLSL,
//             'tonemapping.glsl': tonemappingGLSL,
//             'img-patterns.glsl': imgPatternsGLSL,
//             'dust_fog.glsl': dustFogGLSL
//         };

//         // Transmittance
//         this.materials.transmittance = 
//             createShaderMaterial(
//                 'Transmittance',
//                 width, 
//                 height, 
//                 injectIncludes(transmittanceGLSL, includeMap),
//                 { fAerosolTurbidity: { value: 1.0 } },
//                 this.globalUniforms
//             );

//         this.renderTargets.transmittance = createRenderTarget(width, height);

//         // Sky Texture
//         this.materials.scattering = 
//             createShaderMaterial(
//                 'Scattering',
//                 width, height, injectIncludes(scatteringGLSL, includeMap),
//                 { 
//                     bEnableMultipleScattering: { value: true },
//                     fEyeAttitude: {value: 0.05}, 
//                     fSunElevationDeg: { value: DEF_SUN_ELEVATION_DEG },
//                     fAerosolTurbidity: { value: 1.0 }, 
//                     fWindIntensity: { value: DEF_WIND_INTENSITY },
//                     uBlueNoiseTex: { value: blueNoise512}
//                 },
//                 this.globalUniforms
//             );

//         this.materials.scattering.uniforms.iChannel0.value = this.renderTargets.transmittance.texture;
//         this.renderTargets.scattering = createRenderTarget(width, height);

//         // Final Sky Image
//         this.materials.skyImage = createShaderMaterial(
//             'SkyImage',
//             width, height, injectIncludes(skyImageGLSL, includeMap),
//             { 
//                 uUVScale: { value: new THREE.Vector2(1.0, 1.0) },
//                 iChannel2: { value: lensDirtTex512 },
//                 bEnableACES: { value: true },
//                 bEnableLensDirt: {value: false},
//                 fLensDirtWeight: {value: 0.7},
//                 fLensDirtStep0: {value: 0.7},
//                 fLensDirtStep1: {value: 3.2},
//                 fEyeAttitude: {value: 0.05}, 
//                 fSunElevationDeg: { value: DEF_SUN_ELEVATION_DEG },
//                 uCameraMat: { value: new THREE.Matrix3() },
//                 fCameraPitch: {value:-7.0}, 
//                 fCameraYaw: { value: 0.0 },
//                 fCameraFov: { value: DEF_CAM_FOV },
//                 u_keyPressed: { value: 0 } 
//             },
//             this.globalUniforms
//         );

//         this.renderTargets.skyImage = createRenderTarget(width, height);

//         // Bokeh Image
//         this.materials.bokehImage = createShaderMaterial(
//             'BokehImage', width, height, injectIncludes(bokehImageGLSL, includeMap),
//             { 
//                 fGrainWeight: { value: DEFAULT_GRAIN_WEIGHT },
//                 uBlueNoiseTex: { value: blueNoise512}
//             },
//             this.globalUniforms
//         );


//         this.materials.skyImage.uniforms.iChannel0.value = this.renderTargets.scattering.texture;
//         this.materials.skyImage.uniforms.iChannel1.value = this.renderTargets.transmittance.texture;

//         this.materials.bokehImage.uniforms.iChannel0.value = this.renderTargets.skyImage.texture;

//         // THREE.TextureLoader creates a generic Texture<unknown> object, 
//         // and TypeScript cannot guarantee that the image property is an HTMLImageElement 
//         // before it is fully loaded.
//         this.texAspect = (lensDirtTex512.image as HTMLImageElement).width/ (lensDirtTex512.image as HTMLImageElement).height;
//         this.updateLensDirtScale(); 

//         // // Keyboard events
//         // this.setupEventListeners();
//     }

//     /**
//      * 
//      * @param width 
//      * @param height 
//      */
//     resize( width: number, height: number) {
//         for (const key in this.materials) {
//             this.materials[key].uniforms.iResolution.value.set(width, height, 1);
//             console.log(`Resizing material ${key} to ${width}x${height}`);
//         }
//         for (const key in this.renderTargets) {
//             this.renderTargets[key as RenderTargetName]?.setSize(width, height);
//         }

//         this.updateLensDirtScale(); 
//     }

//     //#region --- Init Helpers
//     // private static async loadTextures(): Promise<{ lensDirtTex512: THREE.Texture }> { 

//     //     const lensDirtTex512 = await loadRGBA64DitherTexture('/assets/textures/Texturelabs_LensFX_217S_med.jpg');
//     //     return { lensDirtTex512 };
//     // }


//     private static async loadTextures(): Promise<{ lensDirtTex512: THREE.Texture, blueNoise512 : THREE.Texture}> 
//     {
//         // const size = 64;
//         // console.log('>> Generating blue noise texture...');
//         // const noiseData = generateBlueNoise(size);

//         // console.log('>> Blue noise texture generated');
//         // const blueNoiseTexture = new THREE.DataTexture(
//         //     noiseData,
//         //     size,
//         //     size,
//         //     THREE.RGBAFormat,       // We only need one channel (R)
//         //     THREE.UnsignedByteType
//         // );

//         //saveDataTextureAsPNG(blueNoiseTexture, 'blue_noise.png'); // Save the generated blue noise texture for inspection
//         //-----

//         let lensDirtTex512: THREE.Texture;
        

//         try {
//             lensDirtTex512 = await loadRGBA64DitherTexture(  '/assets/textures/Texturelabs_LensFX_217S_med.jpg'  );
//         } catch (err) {
//             console.warn('Lens dirt texture failed to load, using fallback.', err);

//             // simple fallback texture
//             lensDirtTex512 = createFallbackTexture();
//         }

//         let blueNoise512: THREE.Texture;

//         try{
//             //bn_mask_512_512.png is a pre-generated blue noise texture that is 512x512 in size, with RGBA channels.
//             blueNoise512 = await loadRGBA64DitherTexture('/assets/textures/bn_mask_512_512.png');
//         } catch(err) {
//             console.warn('Blue noise texture failed to load, using fallback.', err);
//             blueNoise512 = createFallbackTexture();
//         }

//         return { lensDirtTex512, blueNoise512};
//     }

//     private updateLensDirtScale() {
//         const screenAspect = this.canvas.width / this.canvas.height;
//         let scaleX = 1.0, scaleY = 1.0;

//         if (screenAspect > this.texAspect) {
//             scaleY = this.texAspect / screenAspect;
//         } else {
//             scaleX = screenAspect / this.texAspect;
//         }

//         this.materials.skyImage.uniforms.uUVScale.value.set(scaleX, scaleY);
//     }

// }

