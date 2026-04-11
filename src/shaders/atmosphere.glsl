/*
 Reference: https://www.shadertoy.com/view/msXXDS
 https://fgarlin.com/blog/spectral-sky/
 https://github.com/fgarlin/skytracer/tree/master/scripts
 http://www.cvrl.org/ lin2012xyz2e_1_7sf.csv
 https://ies.org/definitions/table-t-5a-color-matching-functions-and-chromaticity-coordinates-of-cie-1931-standard-colorimetric-observer/

*/

precision highp float;
// Configurable parameters
 

// 0=equirectangular, 1=fisheye, 2=projection
#define CAMERA_TYPE 7



const float SUN_ELEVATION_DEGREES = 0.0;    // 0=horizon, 90=zenith
const float EYE_ALTITUDE          = 50.5;    // km
const int   MONTH                 = 0;      // 0-11, January to December
const float AEROSOL_TURBIDITY     = 0.1;
const vec4  GROUND_ALBEDO         =  vec4(0.3,0.3, 0.3, .3);
// Ray marching steps. More steps mean better accuracy but worse performance
const int TRANSMITTANCE_STEPS     = 48;
const int IN_SCATTERING_STEPS     = 48;
// Camera settings
const float EXPOSURE              = -4.0;
// For the "projection" type camera
const float CAMERA_FOV   =  80.0;
const float CAMERA_YAW   =  -10.0;
const float CAMERA_PITCH = -12.0;
const float CAMERA_ROLL  =   0.0;
const float INF=1e17;

// Debug
#define ENABLE_SPECTRAL 1 // 0=RGB, 1=Spectral Rendering

#define SHOW_RELATIVE_LUMINANCE 0
#define TONEMAPPING_TECHNIQUE 0 // 0=ACES, 1=simple

//-----------------------------------------------------------------------------
// Constants

// All parameters that depend on wavelength (vec4) are sampled at
// 630, 560, 490, 430 nanometers
// Violet: 380–450 nm.
// Blue: 450–495 nm.
// Green: 495–570 nm.
// Yellow: 570–590 nm.
// Orange: 590–620 nm.
// Red: 620–750 nm
// Rayleigh volume-scattering coefficient for
// CAS wavelengths, in m^-1, as per
// https://www.shadertoy.com/view/43j3zm
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

/* 
    The spectral radiance of the Sun, W·m⁻²·nm⁻¹ at 630, 560, 490, 430 nm:

    L_{\lambda} = \frac{E_{\lambda}}{\Omega_{\text{sun}}}
    
    Where:
    -- E_{\lambda} is the spectral irradiance in W·m⁻²·nm⁻¹
       The radiant power per unit area per unit wavelength (surface power density) received from the Sun.
    -- \Omega_{\text{sun}} \approx 6.8 \times 10^{-5} \,\text{sr} is the solid angle subtended by the Sun, 
       as seen from the Earth
*/

//-- maybe: 629.3, 560.3, 490.79, 429.735 , 
//-- shader toy original
// const vec4 sun_spectral_irradiance = vec4(1.679, 1.828, 1.986, 1.307);

//  630, 560, 490, 430
const vec4 sun_spectral_irradiance =vec4(1.665,  1.786 , 2.032,  1.21);

/*
 * Rayleigh scattering coefficient at sea level, units km^-1
 * "Rayleigh-scattering calculations for the terrestrial atmosphere"
 * by Anthony Bucholtz (1995).
 */
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

// 0=Background, 1=Desert Dust, 2=Maritime Clean, 3=Maritime Mineral,
// 4=Polar Antarctic, 5=Polar Artic, 6=Remote Continental, 7=Rural, 8=Urban
#define AEROSOL_TYPE 9

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

//  main concentration near ground (the “real” aerosol load)
const float aerosol_base_density = 1.3681e20; 
// minimum residual concentration everywhere (even high up)
const float aerosol_background_density = 2e6;
const float aerosol_height_scale =  .4;
#endif

 

//-----------------------------------------------------------------------------

vec3 get_sun_direction_from_elevation(float elevation_degrees)
{
 
    // Calculate the cosine of the zenith angle
    float cos_zenith =  cos(radians(90.0 - elevation_degrees));

    // Return the sun direction vector v2
   // return vec3(0., cos_zenith, sqrt(1.0 - cos_zenith*cos_zenith));
    return vec3(-sqrt(1.0 - cos_zenith*cos_zenith), 0.0, cos_zenith);
}

 
/*-----------------------------------------------------------------------------
 * Helper function to obtain the transmittance to the top of the atmosphere
 * from Buffer A.
 */
vec4 transmittance_from_lut(sampler2D lut, float cos_theta, float normalized_altitude)
{
    float u = clamp(cos_theta * 0.5 + 0.5, 0.0, 1.0);
    //float u = clamp(cos_theta * 0.666667 + 0.3333333, 0.0, 1.0);

    float v = clamp(normalized_altitude, 0.0, 1.0);
    return texture(lut, vec2(u, v));
}



/*-----------------------------------------------------------------------------
 * Rayleigh phase function.
 */
float molecular_phase_function(float cos_theta)
{
    return RAYLEIGH_PHASE_SCALE * (1.0 + cos_theta*cos_theta);
}

/*-----------------------------------------------------------------------------
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

/*-----------------------------------------------------------------------------
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


/*-----------------------------------------------------------------------------
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

/*-----------------------------------------------------------------------------
 * Return the molecular volume scattering coefficient (km^-1) for a given altitude
 * in kilometers.
 */
vec4 get_molecular_scattering_coefficient(float h)
{
    return molecular_scattering_coefficient_base * exp(-0.07771971 * pow(h, 1.16364243));
}

/*-----------------------------------------------------------------------------
 * Return the molecular volume absorption coefficient (km^-1) for a given altitude
 * in kilometers.
 */
vec4 get_molecular_absorption_coefficient(float h)
{
    h += 1e-4; // Avoid division by 0
    float t = log(h) - 3.22261;
    float density = 3.78547397e20 * (1.0 / h) * exp(-t * t * 5.55555555); 
    return ozone_absorption_cross_section * ozone_mean_monthly_dobson[MONTH] * density;
}

/*-----------------------------------------------------------------------------
 *
 *. Return the aerosol density (km^-3) for a given altitude in kilometers.
 */
float get_aerosol_density(float ht_km)
{
#if AEROSOL_TYPE == 0 
    // Only for the Background aerosol type, no dependency on height
    return aerosol_base_density + aerosol_background_density;
#else
    return aerosol_base_density * (exp(-ht_km / aerosol_height_scale))+ aerosol_background_density;
#endif
}

/*-----------------------------------------------------------------------------
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

    float aerosol_density = get_aerosol_density(h);
   
    aerosol_absorption = aerosol_absorption_cross_section * aerosol_density * aerosol_turbidity;
    aerosol_scattering = aerosol_scattering_cross_section * aerosol_density * aerosol_turbidity;

    molecular_absorption = get_molecular_absorption_coefficient(h);        
    molecular_scattering = get_molecular_scattering_coefficient(h);

    extinction = 
        aerosol_absorption + aerosol_scattering
        + molecular_absorption + molecular_scattering;
    
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

// Remark: mat4x3 is a 4 column 3 row matrix, ye glsl mat is column-major order

// -- original matrix from Fernando García Liñán's shader code
const mat4x3 SPECTRAL_M0 = mat4x3(
    137.672389239975, -8.632904716299537, -1.7181567391931372, 
    32.549094028629234, 91.29801417199785, -12.005406444382531,
    -38.91428392614275, 34.31665471469816, 29.89044807197628,
    8.572844237945445, -11.103384660054624, 117.47585277566478
);

// -- using cmfs = colour.colorimetry.MSDS_CMFS['CIE 2015 2 Degree Standard Observer']
// fixed: lambdas = [630.0, 560.0, 490.0, 430.0] nm
// Optimal weights: [ 76.17322362,  70.58575132,  76.08629684,  53.8993201 ]
const mat4x3  SPECTRAL_M = mat4x3(
   136.03054061010093, -8.515037013083827, -1.6940142108486196,
    32.09953761605745, 90.03249342009984, -11.834611667864023,
    -38.239659016848535, 33.71408844162285, 29.36347457235007,
    6.490960534334301, -8.410884398153655, 88.9781227532175
);

// lambdas = np.array([630.0, 560.0, 490.0, 440.0])
// weights = np.array([71.67511889,  74.99855882,  60.30107575,  45.42075667])
const mat4x3  SPECTRAL_M2= mat4x3(
    127.99780168867633, -8.012215595734482, -1.5939809843106691,
    34.10630353821228, 95.66105236830423, -12.574475764383749,
    -30.306279458943287, 26.719605045776323, 23.271589997262378,
    4.320606075793804, -7.423020720982453, 92.47232146710412
);

// from Joint Optimization
// λ = 623.25, 570.22, 513.46, 448.39
// w = 56.2750, 54.5693, 58.6313, 55.1953ne
const mat4x3 SPECTRAL_M3 = mat4x3(
    122.092250, -6.012178, -1.724872,  // λ=623.3nm
    60.045245, 57.181841, -8.358483,  // λ=570.2nm
    -49.466002, 63.138439, -1.217499,  // λ=513.5nm
    2.058127, -6.920350, 110.169390  // λ=448.4nm  
);

 
// Convert spectral samples (vec4) to linear sRGB (vec3) using a precomputed matrix.
vec3 linear_srgb_from_spectral_samples(vec4 L)
{
    return SPECTRAL_M * L;
}

 

/**
 * Henyey–Greenstein Phase Function
 * Models the directional scattering of light in a medium like clouds.
 *
 * @param cosTheta - Cosine of the angle between view and light direction. 
 * @param g        - Asymmetry parameter: 0 isotropic, >0 forward, <0 backward. 
 *    - g = 0.0 → isotropic scattering (equal in all directions).
 *    - g > 0.0 → forward scattering (light beams toward sun).
 *    - g < 0.0 → backward scattering (rarely used in clouds).
 *  (usually between 0.6 and 0.95 for atmospheric haze/clouds).
 * Reference:
 * https://research.nvidia.com/labs/rtr/approximate-mie/
  * https://www.youtube.com/watch?v=uetMkaWUFTs
  * https://www.meteo.physik.uni-muenchen.de/~emde/doku.php?id=teaching:radiative_transfer:mie_phase
**/
float phaseHG(float cosTheta, float g) {

    return (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosTheta, 1.5);
}

float phaseDoubleHG(float cosTheta, float g1, float g2, float w) {
    return w * phaseHG(cosTheta, g1) + (1.0 - w) * phaseHG(cosTheta, g2);
}

float phase3HG(float cosTheta, float g1, float g2, float g3, float w1, float w2) {
    float w3 = 1.0 - w1 - w2;
    return w1 * phaseHG(cosTheta, g1) 
            + w2 * phaseHG(cosTheta, g2) 
            + w3 * phaseHG(cosTheta, g3);
}



//------------------------------------------------------------------------------
// Mirage gradient: models the temperature gradient near the ground that causes mirages.


float hash0( float n ) {
	return fract( sin(n)*4378.5453 );
}

float pnoise( vec3 o) 
{
	vec3 p = floor(o);
	vec3 fr = fract(o);
		
	float n = p.x + p.y*57.0 + p.z * 1009.0;

	float a = hash0(n+  0.0);
	float b = hash0(n+  1.0);
	float c = hash0(n+ 57.0);
	float d = hash0(n+ 58.0);
	
	float e = hash0(n+  0.0 + 1009.0);
	float f = hash0(n+  1.0 + 1009.0);
	float g = hash0(n+ 57.0 + 1009.0);
	float h = hash0(n+ 58.0 + 1009.0);
	
	
	vec3 fr2 = fr * fr;
	vec3 fr3 = fr2 * fr;
	
	vec3 t = 3.0 * fr2 - 2.0 * fr3;
	
	float u = t.x;
	float v = t.y;
	float w = t.z;

	// this last bit should be refactored to the same form as the rest :)
	float res1 = a + (b-a)*u +(c-a)*v + (a-b+d-c)*u*v;
	float res2 = e + (f-e)*u +(g-e)*v + (e-f+h-g)*u*v;
	
	float res = res1 * (1.0- w) + res2 * (w);
	
	return res;
}

const mat3 m = mat3( 0.00,  0.80,  0.60,
                    -0.80,  0.36, -0.48,
                    -0.60, -0.48,  0.64 );

float SmoothNoise( vec3 p )
{
    float f;
    f  = 0.5000*pnoise( p ); p = m*p*2.02;
    f += 0.2500*pnoise( p ); 
	
    return f * (1.0 / (0.5000 + 0.2500));
}




// A simple, smooth 3D Value Noise
float sim_smoothNoise(vec3 p) {
 
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f* f;
    //f = f * f * (3.0 - 2.0 * f); // Hermite interpolation (removes "sand" look)

    // Hash function to get random values at grid corners
    #define hash(p) fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123)
    
    float n000 = hash(i + vec3(0, 0, 0));
    float n100 = hash(i + vec3(1, 0, 0));
    float n010 = hash(i + vec3(0, 1, 0));
    float n110 = hash(i + vec3(1, 1, 0));
    float n001 = hash(i + vec3(0, 0, 1));
    float n101 = hash(i + vec3(1, 0, 1));
    float n011 = hash(i + vec3(0, 1, 1));
    float n111 = hash(i + vec3(1, 1, 1));

    return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
               mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}

float fbm(vec3 p) {
    float value = 0.0;
    float amplitude = 1.85;
    float frequency = 1.73; // Base frequency
    
    for (int i = 0; i < 3; i++) { // 3 octaves is usually enough for "detail"
        value += amplitude * sim_smoothNoise(p * frequency);
        p *= 2.02;      // Increase frequency for the next octave
        amplitude *= 0.5; // Decrease influence of finer ripples
    }
    return value;
}


float getTemperatureGradient(float alt) {
    // 1. Standard Lapse Rate (K/m)
    float standardLapseRate = -0.0065; 

    // 2. Mirage Parameters
    // For Omega Sun (Inferior): surfaceTemp > airTemp  
    // For Superior Mirage: surfaceTemp < airTemp  
    float surfaceTemp = 280.0; // Warm surface (Kelvin)
    float airTemp = 300.0;     // Ambient air
    float scaleHeight = 30.0;   // Mirage layer thickness (meters)

    float deltaT = surfaceTemp - airTemp;
    // Sharp exponential spike near the ground for mirages
    float mirageGrad = -(1.0 / scaleHeight) * deltaT * exp(-alt / scaleHeight);
    
    return mirageGrad + standardLapseRate;
}
 

float getRefractionGradient(float alt, float kFactor) {
   
    // Basic atmosphere constants
    float T = 288.0 - 0.0065 * alt; // Simplified T
    float P = 101325.0 * exp(-alt / 8400.0); 
    // Adjust n_minus_1 by the wavelength factor
    float n_minus_1 = (0.000226 * kFactor) * (P / T);

    // Young's formula: dn/dh = -(n-1) * (g/RT + (1/T)*(dT/dh))
    float gravityTerm = 0.0342 / T; 
    float tempTerm = getTemperatureGradient(alt) / T;
    
    return -n_minus_1 * (gravityTerm + tempTerm);
}


/**
 * This function "bends" the ray. Note that we only care about 
 * the final direction the ray points when it exits the atmosphere, 
 * as that is what determines which part of the sun or sky you are seeing.
 *
 * Computes the refracted ray direction due to atmospheric refraction.
 * Implements a simple ray marching approach to bend the ray according to
 * the refractive index gradient.
 *
 * @param viewPos The starting position of the ray (camera position).
 * @param initialDir The initial direction of the ray.
 * @return The refracted ray direction.
 */
 
vec4 getRefractedDirectionWithLift(vec3 viewPos, vec3 initialDir, int max_steps,  bool bEnableHeatHaze_, float iTime_) {

    float alt = viewPos.y - EARTH_RADIUS; // km


    // 1. Calculate the sine of the angle to the geometric horizon
    // This accounts for the 'dip' if the camera is high up.
    //float horizonSin = -sqrt(max(0.0, 2.0 * (1000.*EARTH_RADIUS)* (1000.*alt) + 1000.0*(alt * alt))) / (1000.0 * (EARTH_RADIUS + alt));
    
 
    // 2. Define a 'Refraction Window' 
    // We only care about rays near the horizon or pointing at the ground.
    // radians(3.0) is about 0.05. We add this to the horizon angle.
    //float upperThreshold = horizonSin + 0.05; 
    
    // If the ray is pointing well above the horizon 'haze', skip the march.
    //if (initialDir.y > upperThreshold * .001) {
     //  return initialDir;
   // }

    vec3 currPos = viewPos;
    vec3 currDir = initialDir;
    float stepSize = 1.0; // Start with 1 meter steps for mirages

    float jitter_wgt = bEnableHeatHaze_ ? 1.:0.;

    for (int i = 0; i <max_steps; i++) {
        alt = length(currPos) - EARTH_RADIUS; // km
        alt = alt * 1000.0; // convert to meters

        // Stop if we hit the ground or exit the atmosphere
        if (alt < -10.0 || alt > 6000.) break;


        // 2. ADD TURBULENCE
        // Scale turbulence by an exponential fade so it's only near the surface
        float turbulenceFade = 0.5*exp(-alt / 1250.); 
        turbulenceFade = min(.15, 250. / (alt + 1.0)); // Avoid division by zero

        // Sample noise for Horizontal (X) and Vertical (Y) jitter
        // We use 'currPos' so the noise is "pinned" to the world
        vec2 n;
 
        n.x = 0.2*fbm(currPos * 1.0 + iTime_ * 4.1)-0.2; 
        n.y = fbm(currPos * 1.014 - iTime_ * 1.3)* 2.0 - 2.;
    

        // Apply strength 
        vec2 jitter = 0.25 * n * turbulenceFade;
         
        jitter.y = .5* jitter.y; // Only allow upward jitter to simulate "lift"
        jitter = jitter_wgt* jitter;

        // Instead of adding a random vec3, we create a 'turbulent' up vector
        vec3 up = normalize(currPos);
        vec3 right = normalize(cross(up, currDir));
        vec3 perturbedUp = normalize(up + right *32.*jitter.x + cross(right, up) *64.*jitter.y);

        // Use this perturbedUp for your refraction calculation
        float dn_dh = getRefractionGradient(alt, 1.0);
        vec3 gradN = perturbedUp * dn_dh; 

        // Now calculate bending as before
        vec3 bendDir = gradN - dot(gradN, currDir) * currDir; 
        
        // 3. Combined Bending Force
 

        currDir += bendDir * stepSize;
        currDir = normalize(currDir);
        
        // Move along the curved path
        currPos += currDir * stepSize;
        
        // Exponentially increase step size to cover the whole atmosphere
        stepSize *= 1.15; 
    }
    // The "Lift" is essentially the difference in the Y (vertical) component
    float totalLift = currDir.y - initialDir.y;
    return vec4(currDir, totalLift);
}

//-----------------------------------------------------------------------------
// STARS


vec3 getStars(in vec3 from, in vec3 dir, float power) 
{
	vec3 color = vec3(pow(SmoothNoise(dir*320.0), 16.0));
	return pow(color*2.25, vec3(power));
}

// A simple hash to get a random value per direction
float hash13(vec3 p3) {
    p3  = fract(p3 * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// vec3 getStars2(in vec3 dir, float density, float brightness) {
//     // 1. Scale the direction to create a virtual grid on the sky
//     vec3 p = dir * 800.0; 
    
//     // 2. Get a random value for this specific point in the sky
//     float n = hash13(floor(p)); 
    
//     // 3. High-pass filter: only 'n' values very close to 1.0 become stars
//     // This creates sharp points instead of SmoothNoise blobs
//     float star = pow(n, density); 
    
//     // 4. Add Twinkle (Temporal variation)
//     // We use iTime to oscillate the brightness of individual stars
//     float twinkle = sin(iTime * 2.0 + n * 6.28) * 0.5 + 0.5;
//     star *= (0.7 + 0.3 * twinkle);

//     return vec3(star * brightness);
// }


vec3 getStars3(in vec3 rayDir, float fCameraFov, float brightness) {
    // 1. Calculate the Focal Length (same as in your projection_camera)
    float focalLength = 1.0 / tan(radians(fCameraFov) * 0.5);
    
    // 2. Base Scale: 1000.0 is an arbitrary density. 
    // Multiplying by focalLength ensures the grid 'thins out' as you zoom,
    // keeping the individual 'dots' the same screen-pixel size.
    float starScale = 1000.0 * focalLength;
    
    // 3. World-space to Grid-space
    vec3 p = rayDir * starScale;
    
    // 4. Use the floor to isolate a unique ID for each 'star cell'
    vec3 id = floor(p);
    float n = hash13(id); 
    
    // 5. High-contrast threshold for density
    // Adjust 0.99 to change how many stars appear
    float star = 0.0;
    if (n > 0.995) {
        // 6. Sub-pixel shaping: center the star within its cell
        vec3 cellUV = fract(p) - 0.5;
        float dist = length(cellUV);
        
        // This creates a crisp 1-2 pixel dot that doesn't 'block out'
        star = smoothstep(0.4, 0.2, dist);
    }

    // 7. Atmospheric fade (Don't show stars below horizon)
    star *= smoothstep(-0.01, 0.1, rayDir.y);

    return vec3(star * brightness);
}