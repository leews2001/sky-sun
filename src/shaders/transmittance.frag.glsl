/*
 * Buffer A: Transmittance LUT
 *
 * Precomputes the optical depth between two points in the atmosphere.
 * 
 * 
 *
 * Ref: "Precomputed Atmospheric Scattering", Eric Bruneton and Fabrice Neyret (2008).
 */


uniform float fAerosolTurbidity;
uniform vec2 iResolution;

#include "atmosphere.glsl"
#include "math.glsl"

void main()
{
    vec2 uv = gl_FragCoord.xy / iResolution.xy;

    // 1. Parameter Mapping
    // Map X to [-1, 1] for the cosine of the sun/view zenith angle
    float cos_theta = uv.x * 2.0 - 1.0;
    float sin_theta = sqrt(max(0.0, 1.0 - cos_theta * cos_theta));

    // Map Y to altitude r (distance from earth center)
    // Range: [EARTH_RADIUS, ATMOSPHERE_RADIUS]
    float r = mix(EARTH_RADIUS, ATMOSPHERE_RADIUS, uv.y);

    // 2. Ray Setup
    // Position x_0 is at (0, 0, r), direction v is in the XZ plane
    // Remark:
    // In atmospheric scattering, the atmosphere is a sphere. 
    // Because a sphere is symmetrical, the physics of a ray depends only on its altitude 
    // and its angle relative to the vertical. It doesn't matter if you are looking North,
    // South, East, or West—the air looks the same.

    vec3 ray_origin = vec3(0.0, 0.0, r);
    vec3 ray_dir    = vec3(sin_theta, 0.0, cos_theta);

    // 3. Integration Setup
    float t_max = ray_sphere_intersection(ray_origin, ray_dir, ATMOSPHERE_RADIUS);
    float dt    = t_max / float(TRANSMITTANCE_STEPS);

    // Optimization: Calculate the increment vector to avoid 'origin + dir * t' in loop
    vec3 step_vec = ray_dir * dt;
    vec3 current_pos = ray_origin + step_vec * 0.5; // Midpoint integration

    vec4 total_extinction = vec4(0.0);

    // 4. Integration Loop
    // We use a fixed-step integration to calculate the Optical Depth (Tau)
    for (int i = 0; i < TRANSMITTANCE_STEPS; ++i) 
    {
        // Optimization: Use length(current_pos) directly. 
        // Since we only move in the XZ plane, this is very stable.
        float current_r = length(current_pos);
        float altitude  = current_r - EARTH_RADIUS;
         
        // These are likely pre-multiplied by their respective densities inside the helper
        vec4 aero_abs, aero_scat, mol_abs, mol_scat, extinction;
        
        get_atmosphere_collision_coefficients(
            max(0.0, altitude), // Guard against precision-based negative altitudes
            fAerosolTurbidity,
            aero_abs, aero_scat, 
            mol_abs, mol_scat, 
            extinction
        );

        total_extinction += extinction;
        current_pos      += step_vec;
    }

    // 5. Final Transmittance
    // Beer-Lambert Law: T = exp(-OpticalDepth)
    // dt is factored out of the loop for a single multiplication
    gl_FragColor = exp(-total_extinction * dt);

    return;
}
