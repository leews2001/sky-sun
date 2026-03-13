precision highp float;
// Configurable parameters
 

// 0=equirectangular, 1=fisheye, 2=projection
#define CAMERA_TYPE 2

// 0=Background, 1=Desert Dust, 2=Maritime Clean, 3=Maritime Mineral,
// 4=Polar Antarctic, 5=Polar Artic, 6=Remote Continental, 7=Rural, 8=Urban
#define AEROSOL_TYPE 9

const float SUN_ELEVATION_DEGREES = 0.0;    // 0=horizon, 90=zenith
const float EYE_ALTITUDE          = 50.5;    // km
const int   MONTH                 = 0;      // 0-11, January to December
const float AEROSOL_TURBIDITY     = 0.1;
const vec4  GROUND_ALBEDO         =  vec4(0.1,0.1, 0.1, .6);
//const vec4  GROUND_ALBEDO         = vec4(0.2,11.3, .3,1.);

// Ray marching steps. More steps mean better accuracy but worse performance
const int TRANSMITTANCE_STEPS     = 48;
const int IN_SCATTERING_STEPS     = 48;
// Camera settings
const float EXPOSURE              = -4.0;
// For the "projection" type camera
const float CAMERA_FOV   =  60.0;
const float CAMERA_YAW   =  -10.0;
const float CAMERA_PITCH = -12.0;
const float CAMERA_ROLL  =   0.0;
const float INF=1e17;

// Debug
#define ENABLE_SPECTRAL 1 // 0=RGB, 1=Spectral Rendering
#define ENABLE_AEROSOLS 1
#define SHOW_RELATIVE_LUMINANCE 0
#define TONEMAPPING_TECHNIQUE 0 // 0=ACES, 1=simple

//-----------------------------------------------------------------------------
// Constants

// All parameters that depend on wavelength (vec4) are sampled at
// 630, 560, 490, 430 nanometers
// Rayleigh volume-scattering coefficient for
// CAS wavelengths, in m^-1, as per
// https://www.shadertoy.com/view/43j3zm.
const vec3 CASrayleigh=vec3(7.2865e-6,1.2863e-5,2.7408e-5);

const float PI = 3.14159265358979323846;
const float INV_PI = 0.31830988618379067154;
const float INV_4PI = 0.25 * INV_PI;
const float PHASE_ISOTROPIC = INV_4PI;
const float RAYLEIGH_PHASE_SCALE = (3.0 / 16.0) * INV_PI;

 // Henyey-Greenstein phase function asymmetry parameter
const float HGPhaseAsymParam = 0.8;
const float HGP2 = HGPhaseAsymParam * HGPhaseAsymParam;

#define SUN_SCALE 2.0
const float SUN_RADIUS_DEGREES = 0.265; // Sun's angular radius in degrees
const float SUN_RADIUS_RADIANS = 0.004619; // Sun's angular radius in radians

const float EARTH_RADIUS = 6371.0; // km
const float ATMOSPHERE_THICKNESS = 100.0; // km
const float ATMOSPHERE_RADIUS = EARTH_RADIUS + ATMOSPHERE_THICKNESS;
const float EYE_DISTANCE_TO_EARTH_CENTER = EARTH_RADIUS + EYE_ALTITUDE;
const float SUN_ZENITH_COS_ANGLE = cos(radians(90.0 - SUN_ELEVATION_DEGREES));
const vec3 SUN_DIR = vec3(-sqrt(1.0 - SUN_ZENITH_COS_ANGLE*SUN_ZENITH_COS_ANGLE), 0.0, SUN_ZENITH_COS_ANGLE);

#if ENABLE_SPECTRAL == 1
// Extraterrestial Solar Irradiance Spectra, units W * m^-2 * nm^-1
// https://www.nrel.gov/grid/solar-resource/spectra.html
// E_{\lambda} =  W·m⁻²·nm⁻¹ at 630, 560, 490, 430 nm
// sun’s spectral radiance as:
// L_{\lambda} = \frac{E_{\lambda}}{\Omega_{\text{sun}}}
// Where:
// 	•	E_{\lambda} is the spectral irradiance in W·m⁻²·nm⁻¹.
// 	•	\Omega_{\text{sun}} \approx 6.8 \times 10^{-5} \,\text{sr} is the solid angle subtended by the Sun.

const vec4 sun_spectral_irradiance = vec4(1.679, 1.828, 1.986, 1.307);
// Rayleigh scattering coefficient at sea level, units km^-1
// "Rayleigh-scattering calculations for the terrestrial atmosphere"
// by Anthony Bucholtz (1995).
const vec4 molecular_scattering_coefficient_base = vec4(6.605e-3, 1.067e-2, 1.842e-2, 3.156e-2);
// Ozone absorption cross section, units m^2 / molecules
// "High spectral resolution ozone absorption cross-sections"
// by V. Gorshelev et al. (2014).
const vec4 ozone_absorption_cross_section = vec4(3.472e-21, 3.914e-21, 1.349e-21, 11.03e-23) * 1e-4f;
#else
// Same as above but for the following "RGB" wavelengths: 680, 550, 440 nm
// The Sun spectral irradiance is also multiplied by a constant factor to
// compensate for the fact that we use the spectral samples directly as RGB,
// which is incorrect.
const vec4 sun_spectral_irradiance = vec4(1.500, 1.864, 1.715, 0.0) * 150.0;
const vec4 molecular_scattering_coefficient_base = vec4(4.847e-3, 1.149e-2, 2.870e-2, 0.0);
const vec4 ozone_absorption_cross_section = vec4(3.36e-21f, 3.08e-21f, 20.6e-23f, 0.0) * 1e-4f;
#endif

// Mean ozone concentration in Dobson for each month of the year.
const float ozone_mean_monthly_dobson[] = float[](
    347.0, // January
    370.0, // February
    381.0, // March
    384.0, // April
    372.0, // May
    352.0, // June
    333.0, // July
    317.0, // August
    298.0, // September
    285.0, // October
    290.0, // November
    315.0  // December
);

/*
 * Every aerosol type expects 5 parameters:
 * - Scattering cross section
 * - Absorption cross section
 * - Base density (km^-3)
 * - Background density (km^-3)
 * - Height scaling parameter
 * These parameters can be sent as uniforms.
 *
 * This model for aerosols and their corresponding parameters come from
 * "A Physically-Based Spatio-Temporal Sky Model"
 * by Guimera et al. (2018).
 */
#if   AEROSOL_TYPE == 0 // Background
const vec4 aerosol_absorption_cross_section = vec4(4.5517e-19, 5.9269e-19, 6.9143e-19, 8.5228e-19);
const vec4 aerosol_scattering_cross_section = vec4(1.8921e-26, 1.6951e-26, 1.7436e-26, 2.1158e-26);
const float aerosol_base_density = 2.584e17;
const float aerosol_background_density = 2e6;
#elif AEROSOL_TYPE == 1 // Desert Dust
const vec4 aerosol_absorption_cross_section = vec4(4.6758e-16, 4.4654e-16, 4.1989e-16, 4.1493e-16);
const vec4 aerosol_scattering_cross_section = vec4(2.9144e-16, 3.1463e-16, 3.3902e-16, 3.4298e-16);
const float aerosol_base_density = 1.8662e18;
const float aerosol_background_density = 2e6;
const float aerosol_height_scale = 2.0;
#elif AEROSOL_TYPE == 2 // Maritime Clean
const vec4 aerosol_absorption_cross_section = vec4(6.3312e-19, 7.5567e-19, 9.2627e-19, 1.0391e-18);
const vec4 aerosol_scattering_cross_section = vec4(4.6539e-26, 2.721e-26, 4.1104e-26, 5.6249e-26);
const float aerosol_base_density = 2.0266e17;
const float aerosol_background_density = 2e6;
const float aerosol_height_scale = 0.9;
#elif AEROSOL_TYPE == 3 // Maritime Mineral
const vec4 aerosol_absorption_cross_section = vec4(6.9365e-19, 7.5951e-19, 8.2423e-19, 8.9101e-19);
const vec4 aerosol_scattering_cross_section = vec4(2.3699e-19, 2.2439e-19, 2.2126e-19, 2.021e-19);
const float aerosol_base_density = 2.0266e17;
const float aerosol_background_density = 2e6;
const float aerosol_height_scale = 2.0;
#elif AEROSOL_TYPE == 4 // Polar Antarctic
const vec4 aerosol_absorption_cross_section = vec4(1.3399e-16, 1.3178e-16, 1.2909e-16, 1.3006e-16);
const vec4 aerosol_scattering_cross_section = vec4(1.5506e-19, 1.809e-19, 2.3069e-19, 2.5804e-19);
const float aerosol_base_density = 2.3864e16;
const float aerosol_background_density = 2e6;
const float aerosol_height_scale = 30.0;
#elif AEROSOL_TYPE == 5 // Polar Arctic
const vec4 aerosol_absorption_cross_section = vec4(1.0364e-16, 1.0609e-16, 1.0193e-16, 1.0092e-16);
const vec4 aerosol_scattering_cross_section = vec4(2.1609e-17, 2.2759e-17, 2.5089e-17, 2.6323e-17);
const float aerosol_base_density = 2.3864e16;
const float aerosol_background_density = 2e6;
const float aerosol_height_scale = 30.0;
#elif AEROSOL_TYPE == 6 // Remote Continental
const vec4 aerosol_absorption_cross_section = vec4(4.5307e-18, 5.0662e-18, 4.4877e-18, 3.7917e-18);
const vec4 aerosol_scattering_cross_section = vec4(1.8764e-18, 1.746e-18, 1.6902e-18, 1.479e-18);
const float aerosol_base_density = 6.103e18;
const float aerosol_background_density = 2e6;
const float aerosol_height_scale = 0.73;
#elif AEROSOL_TYPE == 7 // Rural
const vec4 aerosol_absorption_cross_section = vec4(5.0393e-23, 8.0765e-23, 1.3823e-22, 2.3383e-22);
const vec4 aerosol_scattering_cross_section = vec4(2.6004e-22, 2.4844e-22, 2.8362e-22, 2.7494e-22);
const float aerosol_base_density = 8.544e18;
const float aerosol_background_density = 2e6;
const float aerosol_height_scale = 0.73;

#elif AEROSOL_TYPE == 8 // Urban
const vec4 aerosol_absorption_cross_section = vec4(2.8722e-24, 4.6168e-24, 7.9706e-24, 1.3578e-23);
const vec4 aerosol_scattering_cross_section = vec4(1.5908e-22, 1.7711e-22, 2.0942e-22, 2.4033e-22);
const float aerosol_base_density = 1.3681e20; 
const float aerosol_background_density = 2e6;
const float aerosol_height_scale =  0.73;

#elif AEROSOL_TYPE == 9 // test
const vec4 aerosol_absorption_cross_section = vec4(2.8722e-24, 4.6168e-24, 7.9706e-24, 1.3578e-23);
const vec4 aerosol_scattering_cross_section = vec4(1.5908e-22, 1.7711e-22, 2.0942e-22, 2.4033e-22);
const float aerosol_base_density = 1.3681e20; 
const float aerosol_background_density = 2e6;
const float aerosol_height_scale =  .4;
#endif
const float aerosol_background_divided_by_base_density = aerosol_background_density / aerosol_base_density;

//-----------------------------------------------------------------------------

vec3 get_sun_direction_from_elevation(float elevation_degrees)
{
 
    // Calculate the cosine of the zenith angle
    float cos_zenith =  cos(radians(90.0 - elevation_degrees));

    // Return the sun direction vector v2
   // return vec3(0., cos_zenith, sqrt(1.0 - cos_zenith*cos_zenith));
    return vec3(-sqrt(1.0 - cos_zenith*cos_zenith), 0.0, cos_zenith);
}

 
/*
 * Helper function to obtain the transmittance to the top of the atmosphere
 * from Buffer A.
     //float sun_cos_theta = uv.x * 2.0 - 1.0;
    float sun_cos_theta = uv.x * 1.5 - 0.5;
 */
vec4 transmittance_from_lut(sampler2D lut, float cos_theta, float normalized_altitude)
{
    float u = clamp(cos_theta * 0.5 + 0.5, 0.0, 1.0);
    //float u = clamp(cos_theta * 0.666667 + 0.3333333, 0.0, 1.0);

    float v = clamp(normalized_altitude, 0.0, 1.0);
    return texture(lut, vec2(u, v));
}



/*
 * Rayleigh phase function.
 */
float molecular_phase_function(float cos_theta)
{
    return RAYLEIGH_PHASE_SCALE * (1.0 + cos_theta*cos_theta);
}

/*
 * Henyey-Greenstrein phase function.
 */
float aerosol_phase_function(float cos_theta)
{
    float den = 1.0 + HGP2 + 2.0 * HGPhaseAsymParam * cos_theta;
    return INV_4PI * (1.0 - HGP2) / (den * sqrt(den));
}

// Precompute these once outside the loop or pass as constants 
const float one_minus_g2 = 1.0 - HGP2;

float aerosol_phase_function_opt(float cos_theta)
{
    // The "den" term: 1 + g^2 + 2g*cos(theta)
    float den = 1.0 + HGP2 + 2.0 * HGPhaseAsymParam * cos_theta; 
    
    // Using inversesqrt is often faster on modern hardware than 1.0 / (den * sqrt(den))
    // because GPUs have specialized hardware for inversesqrt.
    float inv_den_32 = inversesqrt(den * den * den);
    
    return INV_4PI * one_minus_g2 * inv_den_32;
}

/**
 * Schlick's Approximation of the Henyey-Greenstein Phase Function.
 * Much faster: replaces (den^1.5) with a simple square.
 * Ref: Blasi et al. (1993)
 * Ref: https://www.shadertoy.com/view/4ltGWl
 * Ref: http://patapom.com/topics/Revision2013/Revision%202013%20-%20Real-time%20Volumetric%20Rendering%20Course%20Notes.pdf
 */
float aerosol_phase_function_schlick(float cos_theta)
{
    // For Schlick, k is roughly the same as g (HGPhaseAsymParam)

    float den = 1.0 + HGPhaseAsymParam * cos_theta;
    
    // INV_4PI * (1 - k^2) / (1 + k*cos_theta)^2
    return (INV_4PI * one_minus_g2) / (den * den);
}


/*
 * Returns the multiple scattering contribution at a given point in the atmosphere.
 * This is a simplified model that combines a fit of Earth's multiple scattering
 * with a 2nd order scattering from the ground.
 */
vec4 get_multiple_scattering(
    bool bEnableMultipleScattering,
    sampler2D transmittance_lut, 
    float cos_theta, 
    float normalized_height, 
    float d)
{
    if( !bEnableMultipleScattering )
        return vec4(0.0);
 
    // Solid angle subtended by the planet from a point at d distance
    // from the planet center.
    float omega = 2.0 * PI * (1.0 - sqrt(d*d - EARTH_RADIUS*EARTH_RADIUS) / d);

    vec4 T_to_ground = transmittance_from_lut(transmittance_lut, cos_theta, 0.0);

    vec4 T_ground_to_sample =
        transmittance_from_lut(transmittance_lut, 1.0, 0.0) /
        transmittance_from_lut(transmittance_lut, 1.0, normalized_height);

    // 2nd order scattering from the ground
    vec4 L_ground = PHASE_ISOTROPIC * omega * (GROUND_ALBEDO / PI) * T_to_ground * T_ground_to_sample * cos_theta;

    // Fit of Earth's multiple scattering coming from other points in the atmosphere
    vec4 L_ms = 0.02 * vec4(0.217, 0.347, 0.594, 1.0) * (1.0 / (1.0 + 5.0 * exp(-17.92 * cos_theta)));

    return L_ms + L_ground;
}

/*
 * Return the molecular volume scattering coefficient (km^-1) for a given altitude
 * in kilometers.
 */
vec4 get_molecular_scattering_coefficient(float h)
{
    return molecular_scattering_coefficient_base * exp(-0.07771971 * pow(h, 1.16364243));
}

/*
 * Return the molecular volume absorption coefficient (km^-1) for a given altitude
 * in kilometers.
 */
vec4 get_molecular_absorption_coefficient(float h)
{
    h += 1e-4; // Avoid division by 0
    float t = log(h) - 3.22261;
    float density = 3.78547397e20 * (1.0 / h) * exp(-t * t * 5.55555555);
    //return ozone_absorption_cross_section * 347.0 * density;
    return ozone_absorption_cross_section * ozone_mean_monthly_dobson[MONTH] * density;
}

/*
 *
 *. Return the aerosol density (km^-3) for a given altitude in kilometers.
 */
float get_aerosol_density(float h)
{
#if AEROSOL_TYPE == 0 
    // Only for the Background aerosol type, no dependency on height
    return aerosol_base_density * (1.0 + aerosol_background_divided_by_base_density);
#else
    return aerosol_base_density * (exp(-h / aerosol_height_scale))+ aerosol_background_density;
#endif
}

/*
 * Get the collision coefficients (scattering and absorption) of the
 * atmospheric medium for a given point at an altitude h.
 */
void get_atmosphere_collision_coefficients(
        in float h,
        in float aerosol_turbidity,
        out vec4 aerosol_absorption,
        out vec4 aerosol_scattering,
        out vec4 molecular_absorption,
        out vec4 molecular_scattering,
        out vec4 extinction)
{
    h = max(h, 0.0); // In case height is negative

#if ENABLE_AEROSOLS == 0
    aerosol_absorption = vec4(0.0);
    aerosol_scattering = vec4(0.0);
#else
    float aerosol_density = get_aerosol_density(h);
   
    aerosol_absorption = aerosol_absorption_cross_section * aerosol_density * aerosol_turbidity;
    aerosol_scattering = aerosol_scattering_cross_section * aerosol_density * aerosol_turbidity;
#endif
    molecular_absorption = get_molecular_absorption_coefficient(h);        
    molecular_scattering = get_molecular_scattering_coefficient(h);

    extinction = 
        aerosol_absorption
        + aerosol_scattering
        + molecular_absorption
        + molecular_scattering;
    
    return;
}

//-----------------------------------------------------------------------------
// Spectral rendering stuff 
// This code is a compact, high-performance way to handle Spectral Rendering.

// In most graphics, we cheat by using just RGB. 
// But the real world—especially the sky—doesn't work in RGB; it works in wavelengths. 
// This snippet is the "bridge" that converts those scientific wavelengths back 
// into colors the monitor can actually display.
//
// Remark: 
// In GLSL, const at the global scope acts as a true compile-time constant.
//
// Global Scope: The compiler treats this as a fixed set of values, 
// often baking them directly into the instruction stream or constant buffers.
//
// Local Scope: If declared inside the function, some (admittedly older or less optimized) 
// compilers might technically "re-initialize" the matrix on every function call. 
// While most modern drivers will optimize this away, 
// keeping it global guarantees the most efficient handling.

const mat4x3 SPECTRAL_M = mat4x3(
    137.672389239975, -8.632904716299537, -1.7181567391931372,
    32.549094028629234, 91.29801417199785, -12.005406444382531,
    -38.91428392614275, 34.31665471469816, 29.89044807197628,
    8.572844237945445, -11.103384660054624, 117.47585277566478
);

// Convert spectral samples (vec4) to linear sRGB (vec3) using a precomputed matrix.
vec3 linear_srgb_from_spectral_samples(vec4 L)
{
    return SPECTRAL_M * L;
}

 