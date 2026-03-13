import * as THREE from 'three';


import { createRenderTarget, createShaderMaterial, injectIncludes, loadShader } from './utils/GLSUtils';


import { loadRGBA64DitherTexture, createFallbackTexture} from './utils/TextureUtils';

const RT_KEYS = ['transmittance', 'scattering', 'skyImage'] as const;
type RenderTargetName = typeof RT_KEYS[number];


/**
 * RenderManager is responsible for managing the rendering process of the sky system.
 * It initializes the necessary materials and render targets, and provides methods to resize them.
 */
export class RenderManager {
 
    private canvas!: HTMLCanvasElement;
    private texAspect: number = 1.0; 

    /**
     * A map of shader materials used in the rendering process.
     * Each key corresponds to a specific rendering pass.
     */
    materials: Record<string, THREE.ShaderMaterial> = {};
    renderTargets: Partial<Record<RenderTargetName, THREE.WebGLRenderTarget>> = {};

    /**
     * 
     * @param width 
     * @param height 
     * @param canvas 
     */
    async init(width: number, height: number, canvas: HTMLCanvasElement): Promise<void> {

        console.log('>> RenderManager init');
        this.canvas = canvas;

        const {  lensDirtTex512 } = 
            await RenderManager.loadTextures();
        console.log('>> RenderManager init - Textures Loaded');
        const [
            commonGLSL,
            commonMathGLSL,
            commonNoiseGLSL,
            tonemappingGLSL,
            transmittanceGLSL,
            scatteringGLSL,
            skyImageGLSL,
            bokehImageGLSL,
        ] = await Promise.all([
            loadShader('src/shaders/atmosphere.glsl'),
            loadShader('src/shaders/math.glsl'),
            loadShader('src/shaders/noise.glsl'),
            loadShader('src/shaders/tonemapping.glsl'),
            loadShader('src/shaders/transmittance.frag.glsl'),
            loadShader('src/shaders/scattering.frag.glsl'),
            loadShader('src/shaders/skyImage.frag.glsl'),
            loadShader('src/shaders/bokehImage.frag.glsl'),
        ]);
        console.log('>> RenderManager init - Shaders Loaded');

        const includeMap = { 
            'atmosphere.glsl': commonGLSL,
            'math.glsl': commonMathGLSL,
            'noise.glsl': commonNoiseGLSL,
            'tonemapping.glsl': tonemappingGLSL
        };

        // Transmittance
        this.materials.transmittance = 
            createShaderMaterial(
                'Transmittance',
                width, 
                height, 
                injectIncludes(transmittanceGLSL, includeMap),
                { fAerosolTurbidity: { value: 1.0 } }
            );

        this.renderTargets.transmittance = createRenderTarget(width, height);

        // Sky Texture
        this.materials.scattering = 
            createShaderMaterial(
                'Scattering',
                width, height, injectIncludes(scatteringGLSL, includeMap),
                { 
                    bEnableMultipleScattering: { value: true },
                    fEyeAttitude: {value: 0.05}, 
                    fSunElevationDeg: { value: 0.0 },
                    fAerosolTurbidity: { value: 1.0 } }
            );

        this.materials.scattering.uniforms.iChannel0.value = this.renderTargets.transmittance.texture;
        this.renderTargets.scattering = createRenderTarget(width, height);

        // Final Sky Image
        this.materials.skyImage = createShaderMaterial(
            'SkyImage',
            width, height, injectIncludes(skyImageGLSL, includeMap),
            { 
                uUVScale: { value: new THREE.Vector2(1.0, 1.0) },
                iChannel2: { value: lensDirtTex512 },
                bEnableACES: { value: true },
                fEyeAttitude: {value: 0.05}, 
                fSunElevationDeg: { value: 0.0 },
                uCameraMat: { value: new THREE.Matrix3() },
                fCameraPitch: {value:-7.0}, 
                fCameraYaw: { value: 0.0 },
                fCameraFov: { value: 80.0 },
                u_keyPressed: { value: 0 } }
        );

        this.renderTargets.skyImage = createRenderTarget(width, height);

        // Bokeh Image
        this.materials.bokehImage = createShaderMaterial(
            'BokehImage', width, height, injectIncludes(bokehImageGLSL, includeMap),
            { 
                //iChannel0: { value: this.renderTargets.skyImage.texture },
            }
        );


        this.materials.skyImage.uniforms.iChannel0.value = this.renderTargets.scattering.texture;
        this.materials.skyImage.uniforms.iChannel1.value = this.renderTargets.transmittance.texture;

        this.materials.bokehImage.uniforms.iChannel0.value = this.renderTargets.skyImage.texture;

        // THREE.TextureLoader creates a generic Texture<unknown> object, 
        // and TypeScript cannot guarantee that the image property is an HTMLImageElement 
        // before it is fully loaded.
        this.texAspect = (lensDirtTex512.image as HTMLImageElement).width/ (lensDirtTex512.image as HTMLImageElement).height;
        this.updateLensDirtScale(); 

        // // Keyboard events
        // this.setupEventListeners();
    }

    /**
     * 
     * @param width 
     * @param height 
     */
    resize( width: number, height: number) {
        for (const key in this.materials) {
            this.materials[key].uniforms.iResolution.value.set(width, height, 1);
            console.log(`Resizing material ${key} to ${width}x${height}`);
        }
        for (const key in this.renderTargets) {
            this.renderTargets[key as RenderTargetName]?.setSize(width, height);
        }

        this.updateLensDirtScale(); 
    }

    //#region --- Init Helpers
    // private static async loadTextures(): Promise<{ lensDirtTex512: THREE.Texture }> { 

    //     const lensDirtTex512 = await loadRGBA64DitherTexture('/assets/textures/Texturelabs_LensFX_217S_med.jpg');
    //     return { lensDirtTex512 };
    // }


    private static async loadTextures(): Promise<{ lensDirtTex512: THREE.Texture }> 
    {

        let lensDirtTex512: THREE.Texture;

        try {
            lensDirtTex512 = await loadRGBA64DitherTexture(
            '/assets/textures/Texturelabs_LensFX_217S_med.jpg'
            );
        } catch (err) {
            console.warn('Lens dirt texture failed to load, using fallback.', err);

            // simple fallback texture
            lensDirtTex512 = createFallbackTexture();
        }

        return { lensDirtTex512 };
    }

    private updateLensDirtScale() {
        const screenAspect = this.canvas.width / this.canvas.height;
        let scaleX = 1.0, scaleY = 1.0;

        if (screenAspect > this.texAspect) {
            scaleY = this.texAspect / screenAspect;
        } else {
            scaleX = screenAspect / this.texAspect;
        }

        this.materials.skyImage.uniforms.uUVScale.value.set(scaleX, scaleY);
    }

}

