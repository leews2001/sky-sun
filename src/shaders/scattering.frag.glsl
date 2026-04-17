/*
 * Buffer B: Sky texture
 *
  * We render the sky to a texture instead of raymarching on the entire screen.
 * This is not very useful in Shadertoy, but very useful for someone looking
 * to implement this on a real application.
 *
 * It is important to note that quality decreases significantly when rendering
 * space views. To avoid this, the compute_inscattering() function can be used
 * directly when rendering to a fullscreen quad.
 *
 * References:
 * "A Scalable and Production Ready Sky and Atmosphere Rendering Technique", Sébastien Hillaire (2020).
 * "Physically Based Sky", Frostbite
 */
 

uniform float iTime;
uniform int iFrame;
uniform bool bEnableMultipleScattering; // if true, use spectral rendering
uniform float fEyeAttitude; // in km
uniform float fSunElevationDeg; // in degrees, -10.0 - 90.0
uniform float fAerosolTurbidity; // aerosol turbidity, 0.0 - 1.0

uniform sampler2D uBlueNoiseTex; // 512x512 Blue Noise Texture
uniform float fWindIntensity;   // 0.0 to 1.0

uniform vec2 iResolution;
uniform sampler2D iChannel0; // from Buffer A , Trnsmittance LUT


#include "atmosphere.glsl"
#include "math.glsl"


// --- NEW: Procedural Volumetric Dust/Fog ---
// Reusing the triangle noise logic we discussed for "swirling" sand/dust
float tri(in float x){return abs(fract(x)-.5);}
vec3 tri3(in vec3 p){return vec3( tri(p.z+tri(p.y)), tri(p.z+tri(p.x)), tri(p.y+tri(p.x)));}

float getDustTurbulence(vec3 p) {
    
    p *= 0.002; // Scale of the dust clumps
    //float speed = iTime * 0.067* fWindIntensity * fWindIntensity; // Speed of dust movement. Adjust as needed.
    //float speed = iTime *  (0.05+ smoothstep(0.0, 10., fWindIntensity));
    // if (fWindIntensity < 0.1) {
    //     return 0.0; // No dust if wind is negligible
    // }

    float factor = 1.0;/// exp(0.05 * fEyeAttitude);/// max(1.0, 2.0*log2(fEyeAttitude));


    float speed = iTime * 0.057* smoothstep(-0.15, 1.15, fWindIntensity * factor); // Dust moves slower at higher altitudes, and faster with stronger winds. Adjust parameters as needed.
    float rz = 0.;
    float z = 1.43;
    for (float i=0.; i<3.; i++ ) { // 3 octaves is enough for background dust
        vec3 dg = tri3(p * 2.0);
        p += (dg + speed);
        rz += (tri(p.x + tri(p.y + tri(p.z)))) / z;
        z *= 1.5; p *= 1.2;
    }
   
    return rz;
}


/**
 *   
 */
vec4 compute_inscattering(
    vec3 ray_origin, 
    vec3 ray_dir, 
    float t_max,
    float dither )
{
    vec3 sun_dir = get_sun_direction_from_elevation(fSunElevationDeg);

    /**
    * Calculate the scattering angle.
    *
    * Why -ray_dir?
    * ray_dir points AWAY from the eye into the scene.
    * sun_dir points AWAY from the Earth toward the sun.
    * To find the 'Scattering Angle' (the angle light travels to reach our eye),
    * we need the angle between the incoming light (sun_dir) and the direction
    * TOWARD the eye (-ray_dir).
    *
    * Result: 1.0 = Looking at the sun (Forward Scattering / Bright Glow)
    * -1.0 = Looking away from the sun (Back Scattering)
    */

    float cos_scattering_angle = dot(-ray_dir, sun_dir);

    // Phase functions are constant for the whole ray
    float phase_mol = molecular_phase_function(cos_scattering_angle);
    float phase_aero = aerosol_phase_function_schlick(cos_scattering_angle);

    float dt = t_max / float(IN_SCATTERING_STEPS);
    vec3 step_vec = ray_dir * dt; 
    vec4 accumulation = vec4(0.0);
    vec4 total_transmittance = vec4(1.0);

    //dither = 128.;
    //dither = dither/ 255.0; // Disable jitter for now to compare with reference. Re-enable for better quality (removes banding)
    //dither = dither-0.5; // Center around zero so we jitter both forward and backward along the ray
    for (int i = 0; i < IN_SCATTERING_STEPS; ++i) 
    {
        // 1. JITTERED SAMPLING (The secret to removing banding)
        // We use the Blue Noise dither to offset the sample position along the ray
        //float t = (float(i+1) + dither) * dt;

        vec3 current_pos = ray_origin + step_vec * (float(i) + 0.5);
        //vec3 current_pos = ray_origin + ray_dir * t;


        float r = length(current_pos);
        float altitude = r - EARTH_RADIUS;
        vec3 up = current_pos / r;

        // 1. Get local atmosphere properties
        vec4 aero_abs, aero_scatt;
        vec4 mole_abs, mole_scatt;
        vec4 extinction;

        get_atmosphere_collision_coefficients(
            max(0.0, altitude), 
            fAerosolTurbidity, 
            aero_abs, 
            aero_scatt, 
            mole_abs, 
            mole_scatt, 
            extinction);

        // --- DUST INTEGRATION ---
        if (fWindIntensity > 0.1) {
            float dustHeightFade = smoothstep(1.5,.0, altitude); // Dust stays near ground (1.5km)
            float noise = getDustTurbulence(current_pos);
            //noise = noise * 2.0 - 1.5; // Normalize to [-1, 1]
            vec4 dustExt = vec4(0.2, 0.3, 0.4, 1.0) * fWindIntensity * noise * dustHeightFade;
            extinction += dustExt;
            aero_scatt += dustExt * 0.7; // Dust scatters partially
        }

        // 2. Sample Transmittance from LUT (Sun to current point)
        float sun_cos_theta = dot(up, sun_dir);
        float norm_alt = altitude / ATMOSPHERE_THICKNESS;
        vec4 light_transmittance = transmittance_from_lut(iChannel0, sun_cos_theta, norm_alt);

        // 3. Multiple Scattering (Precomputed or approximated)
        vec4 multi_scatter = vec4(0.0);
        if (bEnableMultipleScattering) {
            multi_scatter = get_multiple_scattering(true, iChannel0, sun_cos_theta, norm_alt, r);
        }

        // 4. Calculate Scattering S (The "Source Term")
        // Note: MS is isotropic, so it is NOT multiplied by the phase function.
        vec4 direct_s = (mole_scatt * phase_mol + aero_scatt * phase_aero) * light_transmittance;
        vec4 indirect_s = (mole_scatt + aero_scatt) * multi_scatter;
        vec4 S = (direct_s + indirect_s) * sun_spectral_irradiance;
        // float t = (float(i) + 0.5) * dt;
        // vec3 x_t = ray_origin + ray_dir * t;

        // 5. Analytical Integration for current segment
        vec4 step_transmittance = exp(-extinction * dt);

        // Avoid division by zero in vacuum
        vec4 S_int = (S - S * step_transmittance) / max(extinction, 1e-7);
        
        accumulation += total_transmittance * S_int;
        total_transmittance *= step_transmittance; 
    }

    return accumulation;
}


//------------------------------------------------------------------------------
void main()
{
    vec2 uv = gl_FragCoord.xy / iResolution.xy;


    // --- BLUE NOISE SETUP ---
    // We use the Golden Ratio boiling dither we discussed
    float goldenRatio = 1.61803398875;
    vec2 noiseOffset = fract(vec2(float(iFrame) * goldenRatio, float(iFrame) * goldenRatio * goldenRatio)) * 512.0;
    float blueNoise = texture(uBlueNoiseTex, (gl_FragCoord.xy + noiseOffset) / 512.0).r;


    // Mapping UV to Spherical Coordinates
    float azimuth = 2.0 * PI * uv.x;
    // Apply a non-linear transformation to the elevation to dedicate more
    // texels to the horizon, where having more detail matters.
    float l = uv.y * 2.0 - 1.0;
    float elev = l*l * sign(l) * PI * 0.5; // [-pi/2, pi/2], Non-linear elevation mapping

    vec3 ray_dir = vec3(cos(elev) * cos(azimuth),
                        cos(elev) * sin(azimuth),
                        sin(elev));
                        

    float r_eye = EARTH_RADIUS + fEyeAttitude; // Distance from Earth center to the eye in km
    vec3 ray_origin = vec3(0.0, 0.0, r_eye);

    // Atmosphere Boundaries
    float t_atmos = ray_sphere_intersection(ray_origin, ray_dir, ATMOSPHERE_RADIUS);
    float t_ground = ray_sphere_intersection(ray_origin, ray_dir, EARTH_RADIUS);

    // Robust Ray-Capping
    float t_min = 0.0;
    float t_max = t_atmos;

    // If we are in space, we must hit the atmosphere first
    if (fEyeAttitude > ATMOSPHERE_THICKNESS) {
        if (t_atmos < 0.0) { 
            discard; 
        } // Doesn't even hit the air
        
        t_min = t_atmos; // Start integration at the edge of the air
    }

    // If we hit the ground, stop there
    if (t_ground > 0.0) {
        t_max = min(t_max, t_ground);
    }

    // Adjust origin for space views
    vec3 start_pos = ray_origin + ray_dir * t_min;
    float total_dist = t_max - t_min;

    if (total_dist <= 0.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }

    // Run inscattering with blue noise jitter
    vec4 L = compute_inscattering(start_pos, ray_dir, total_dist, blueNoise);

    // Final Color Output

    vec3 color;
#if ENABLE_SPECTRAL == 1
    color = linear_srgb_from_spectral_samples(L);
#else
    color = L.rgb;
#endif

    // --- FINAL OUTPUT DITHERING ---
    // This removes 8-bit quantization banding in the dark sky gradients
    //color += (blueNoise - 0.5) * (1.0 / 255.0);

    gl_FragColor = vec4(color, 1.0);

    return;
}