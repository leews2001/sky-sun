

uniform bool bEnableFlare;
uniform bool bEnableACES; // if true, use ACES tonemapping
uniform float fEyeAttitude; // in km
uniform float fSunElevationDeg; // in degrees, -10.0 - 90.0
uniform float fAerosolTurbidity; // aerosol turbidity, 0.0 - 1.0
uniform mat3  uCameraMat;         // Camera orientation matrix
uniform float fCameraFov; // in degrees
uniform vec2  uUVScale; 
uniform int u_keyPressed;
uniform float iTime;
uniform vec2 iResolution;
uniform sampler2D iChannel0; // from Buffer A ,SkyTexture LUT
uniform sampler2D iChannel1; // from Buffer A , Trnsmittance LUT
uniform sampler2D iChannel2;        // RGBA 1024x512
uniform vec3 iChannelResolution[3]; // channel resolution (in pixels)

#include "sky-sun-utils.glsl"

 

// Constants
const float k = 0.000226; // Gladstone-Dale constant
const float surfaceP = 101325.0; // Pascal


// A simple, smooth 3D Value Noise
float smoothNoise(vec3 p) {
 
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
        value += amplitude * smoothNoise(p * frequency);
        p *= 2.02;      // Increase frequency for the next octave
        amplitude *= 0.5; // Decrease influence of finer ripples
    }
    return value;
}




// Standard 3D noise function (you can swap this with your favorite noise)
float noise(vec3 p) {
    // ... existing noise implementation or texture lookup ...
    return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
}

// Get the turbulence "force" at a specific point in space
vec3 getTurbulence(vec3 pos, float time) {
    float scale = 0.05; // Size of the shimmering cells
    float speed = 0.0001;  // How fast the shimmer moves
    float strength = 0.000055; // Very small! Atmospheric n varies by tiny amounts.

    // Sample noise at different frequencies (Octaves)
    float n = noise(pos * scale + time * speed)* 2.0 - 1.0;
 
    pos.y = pos.y* 1000.;
    n += noise(pos * scale * 2.0 - time * speed * 0.8) * 0.5;
    
    // We want the gradient of the noise (how it changes in space)
    // To keep it simple, we can just return a small offset vector
    return vec3(n) * strength;
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

const float kRed   = 0.8994; // Bends ~0.6% less
const float kGreen = 1.000; // Baseline
const float kBlue  = 1.1007; // Bends ~0.7% more


float getRefractionGradient(float alt, float kFactor) {
   
    // Basic atmosphere constants
    float T = 288.0 - 0.0065 * alt; // Simplified T
    float P = 101325.0 * exp(-alt / 8400.0);
    //float n_minus_1 = 0.000226 * (P / T);
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
 
vec3 getRefractedDirection(vec3 viewPos, vec3 initialDir, float kFactor) {

    float alt = viewPos.y - EARTH_RADIUS; // km


    // 1. Calculate the sine of the angle to the geometric horizon
    // This accounts for the 'dip' if the camera is high up.
    float horizonSin = -sqrt(max(0.0, 2.0 * (1000.*EARTH_RADIUS)* (1000.*alt) + 1000.0*(alt * alt))) / (1000.0 * (EARTH_RADIUS + alt));
    
 
    // 2. Define a 'Refraction Window' 
    // We only care about rays near the horizon or pointing at the ground.
    // radians(3.0) is about 0.05. We add this to the horizon angle.
    float upperThreshold = horizonSin + 0.05; 
    
    // If the ray is pointing well above the horizon 'haze', skip the march.
    if (initialDir.y > upperThreshold * .001) {
     //  return initialDir;
    }

    vec3 currPos = viewPos;
    vec3 currDir = initialDir;
    float stepSize = 1.0; // Start with 1 meter steps for mirages

    for (int i = 0; i <32; i++) {
        alt = length(currPos) - EARTH_RADIUS; // km
        alt = alt * 1000.0; // convert to meters
        // Stop if we hit the ground or exit the atmosphere
        if (alt < 0.0 || alt > 8000.) break;

        float dn_dh = getRefractionGradient(alt, 1.2);
        vec3 up = normalize(currPos);
        
        // Angular dependency: bendDir is the rejection of gradient onto ray
        vec3 gradN = up * dn_dh;




        vec3 bendDir = gradN - dot(gradN, currDir) * currDir;

        currDir += bendDir * stepSize;
        currDir = normalize(currDir);
        
        // Move along the curved path
        currPos += currDir * stepSize;
        
        // Exponentially increase step size to cover the whole atmosphere
        stepSize *= 1.75; 
    }
    return currDir;
}



vec4 getRefractedDirectionWithLift(vec3 viewPos, vec3 initialDir, int max_steps) {

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
 
        n.x = 0.2*fbm(currPos * 1.0 + iTime * 4.1)-0.2; 
        n.y = fbm(currPos * 1.014 - iTime * 1.3)* 2.0 - 1.;
    

        // Apply strength
        float shimmerStrength = 1.0*turbulenceFade;
        vec2 jitter = 0.25*n * shimmerStrength;
         
         jitter.y = .5* jitter.y; // Only allow upward jitter to simulate "lift"
        // --- THE FIX FOR SHEARING ---
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
 
 


//==============================================================================

vec2 getAspectUV(vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    uv -= 0.5;
    uv *= uUVScale; // uniform passed from TS
    uv += 0.5;
    return uv;
}
 
//--------

// mat3 rotX(float a) { float s = sin(a), c = cos(a); return mat3(1.,0.,0.,0.,c,-s,0.,s,c); }
// mat3 rotY(float a) { float s = sin(a), c = cos(a); return mat3(c,0.,s,0.,1.,0.,-s,0.,c); }
// mat3 rotZ(float a) { float s = sin(a), c = cos(a); return mat3(c,-s,0.,s,c,0.,0.,0.,1.); }


/**
 *
 */
vec3 musk_Lensflare(vec2 uv,vec2 pos, float sz)
{
   

    float D =  min( 0.25+length( pos), 1.0); 
    D = smoothstep(0., 1.2, D);


	vec2 main = uv-pos;
    //vec2 uvd = uv* length(uv);
	vec2 uvd = uv*max(.12, (1.0+ log(length(uv)+0.1)));
	
	float ang = atan(main.y, main.x);
	float dist=length(main); dist = pow(dist,.1);
	//float n = musk_noise(vec2((ang-iTime/9.0)*16.0,dist*32.0));

    float L = length(uv-pos);
    sz = 30.;
    float f0sc = 0.1;
	float f0 = 1.0/(L*sz+.1) * f0sc; 

	// streaks
	//f0 = f0+f0*(sin((ang+iTime/18.0 + musk_noise(abs(ang)+n/2.0)*2.0)*12.0)*.1+dist*.1+.8);
    f0 = 0.01*f0; //+0.5*f0*(sin((ang+iTime/18.0 +2.0)*12.0)*.1+dist*.1+.8);
     
	// float f2 = max(1.0/(1.0+32.0*pow(length(uvd+0.8*pos),2.0)),.0)*00.25;
	// float f22 = max(1.0/(1.0+32.0*pow(length(uvd+0.85*pos),2.0)),.0)*00.23;
	// float f23 = max(1.0/(1.0+32.0*pow(length(uvd+0.9*pos),2.0)),.0)*00.21;

    // Outer arc , color abberration 
    float f2sc =  D;
	float f2 = max(1.0/(1.0+80.0*pow(length(uvd+0.65*pos),1.2)),.0)*0.25 * f2sc;
	float f22 = max(1.0/(1.0+80.0*pow(length(uvd+0.85*pos),1.2)),.0)*0.23* f2sc;
	float f23 = max(1.0/(1.0+80.0*pow(length(uvd+0.95*pos),1.2)),.0)*0.21* f2sc;
	
	vec2 uvx = mix(uv,uvd,-0.5);

    // first inner small disc (from edge)
    float f4sc =  D;
	float f4 = max(0.01-pow(length(uvx+0.4*pos),2.4),.0)*6.0* f4sc;
	float f42 = max(0.01-pow(length(uvx+0.45*pos),2.4),.0)*5.0* f4sc;
	float f43 = max(0.01-pow(length(uvx+0.5*pos),2.4),.0)*3.0* f4sc;
	 
     // first inner large disc (from edge)
	uvx = mix(uv,uvd,-.4);
	float f5sc =  D;
	float f5 = max(0.01-pow(length(uvx+0.2*pos),5.5),.0)*2.0 * f5sc;
	float f52 = max(0.01-pow(length(uvx+0.4*pos),4.5),.0)*2.0* f5sc;
	float f53 = max(0.01-pow(length(uvx+0.6*pos),5.5),.0)*2.0* f5sc;
	
	uvx = mix(uv,uvd,-0.5);
	
    // Second inner small disc (from edge)
    float f6sc =  D;
	float f6 = max(0.01-pow(length(uvx-0.3*pos),2.6),.0)*6.0* f6sc;
	float f62 = max(0.01-pow(length(uvx-0.325*pos),2.6),.0)*3.0* f6sc;
	float f63 = max(0.01-pow(length(uvx-0.35*pos),2.6),.0)*5.0 * f6sc;
	// float f6 = max(0.01-pow(length(uvx-0.3*pos),1.6),.0)*6.0*4.;
	// float f62 = max(0.01-pow(length(uvx-0.325*pos),1.6),.0)*3.0*10.;
	// float f63 = max(0.01-pow(length(uvx-0.35*pos),1.6),.0)*5.0*8.;	

	vec3 c = vec3(.0);
	
	c.r+=f2+f4+f5+f6; 
    c.g+=f22+f42+f52+f62; 
    c.b+=f23+f43+f53+f63;
 
 
    c.r+=2.*f2+f4+f5+f6;
    c.g+=2.*f22+f42+f52+f62;
    c.b+=2.*f23+f43+f53+f63; 
   
	c+=vec3(f0);

	return c;
}

   

/**
    * Computes the spectral radiance of the sun disk based on the ray direction and sun direction.
    * The sun disk is modeled as a solid angle with a specific angular radius.
    * 
    * @param rayDir The direction of the ray being traced.
    * @param sunDir The direction of the sun.
    * @param angularRadius The angular radius of the sun in radians.
    * @return The spectral radiance of the sun disk in W·m⁻²·nm⁻¹·sr⁻¹.
    */
vec4 computeSunDiskSpectral(vec3 rayDir, vec3 sunDir, float angularRadius) {

    float cosTheta   = dot(rayDir, sunDir);        // −1 … 1
    float minCos     = cos(angularRadius);         // edge threshold
    float minCos2     = cos(angularRadius*2.0);         // edge threshold
    float discWidth  = fwidth(cosTheta);           // screenspace footprint
    float alpha      = smoothstep(minCos - discWidth,
                                minCos + discWidth,
                                cosTheta);       // 0→1 across two pixels

 
    // Solid angle of sun disk in steradians (cone)
    float omegaSun = 2.0 * PI * (1.0 - minCos);

    if (cosTheta < minCos2)
    {
        // Outside sun disk, return zero radiance
        return vec4(0.0);
    }
    // Convert spectral irradiance (W·m⁻²·nm⁻¹) to spectral radiance (W·m⁻²·nm⁻¹·sr⁻¹)
    // ref: vec4(1.679, 1.828, 1.986, 1.307);
    // Spectral radiance
    

    vec4 diskRadiance = sun_spectral_irradiance / omegaSun;
    //vec4 spectral = vec4(1.500, 1.864, 1.715, 0.0) * 150.0;
    //vec4 diskRadiance = spectral / omegaSun;
    return diskRadiance;
}
 
  
vec3 limbDarkeningV3(float mu){
    // Model from http :// www . physics . hmc . edu / faculty / esin / a101 / limbdarkening . pd
    // Wavelength dependency of the Solar limb darkening by D. Hestroffer
    // Model using P5 polynomial from http://articles.adsabs.harvard.edu/cgi-bin/nphiarticle_query?1994SoPh..153...91N&defaultprint=YES&filetype=.pdf
    // coefficient for RGB wavelength (680 ,550 ,440)
    
    //mu =  sqrt(mu); // convert to normalized radius (0 at center, 1 at limb)
   
    mu = smoothstep(0., .66, mu);
    vec3 a0 = vec3 ( 0.34685 , 0.26073 , 0.15248) ;
    vec3 a1 = vec3 ( 1.37539 , 1.27428 , 1.38517) ;
    vec3 a2 = vec3 ( -2.04425 , -1.30352 , -1.49615) ;
    vec3 a3 = vec3 ( 2.70493 , 1.47085 , 1.99886) ;
    vec3 a4 = vec3 ( -1.94290 , -0.96618 , -1.48155) ;
    vec3 a5 = vec3 ( 0.55999 , 0.26384 , 0.44119) ;

    float mu2 = mu * mu ;
    float mu3 = mu2 * mu ;
    float mu4 = mu2 * mu2 ;
    float mu5 = mu4 * mu ;
    vec3 factor = a0 + a1 * mu + a2 * mu2 + a3 * mu3 + a4 * mu4 + a5 * mu5 ;
    vec3 finalLuminance = vec3 (1.0) ; // solar radiance at given wavelength
    finalLuminance *= (factor) ;
    return finalLuminance ;

}



vec3 sunWithBloom(vec3 rayDir, vec3 sunDir) { 

    // 	Converts sun’s angular radius to cosine of angle. This acts as a threshold:
	// •	cosTheta ≥ minSunCosTheta → pixel is within the sun disk.
	// •	cosTheta < minSunCosTheta → pixel is in the glow/bloom region.
    const float minSunCosTheta = cos(SUN_RADIUS_RADIANS* SUN_SCALE);
    //const float t = (1.0- minSunCosTheta) * 0.1;

    // cosine of angle between current ray and sun direction.
    float cosTheta = dot(rayDir, sunDir);

    if (cosTheta > minSunCosTheta) {
        float d = 1.0- minSunCosTheta;
     
        // Inside sun disk → return pure white light (maximum brightness).
 
        cosTheta = ( (cosTheta-minSunCosTheta) / d);

 
        vec3 col = limbDarkeningV3(cosTheta);
        if (u_keyPressed == 6) 
        //if (fSunElevationDeg < 0.0)
        {
            col = vec3( 1.0);
            //col = 10.0* col;
        }

        return 2.*8.*col;
        //return vec3(1.0)*4.*max(smoothstep(  minSunCosTheta-t,  minSunCosTheta+t, cosTheta), 0.25);
    }
 

    //-- Outside sun disk — compute bloom

    // how far outside the sun disk the pixel is (in terms of cosine angle difference).
    float offset = minSunCosTheta - cosTheta;
    
    // Gaussian-like decay: rapidly fades to zero as offset increases.
    float gaussianBloom = 0.1*exp(-offset*6600.0);
    
    //An inverse-falloff bloom, slower decay than Gaussian.
    float invBloom = 1.0/(0.02 + offset*300.0*2.5)*0.01;
 
 

    return vec3(gaussianBloom+invBloom);

}


//------------------------------------------------------------------------------

/*
 * ACES tonemapping fit for the sRGB color space
 * https://github.com/TheRealMJP/BakingLab/blob/master/BakingLab/ACES.hlsl
 */
// sRGB => XYZ => D65_2_D60 => AP1 => RRT_SAT
const mat3 aces_input_mat = mat3(
    0.59719, 0.07600, 0.02840,
    0.35458, 0.90834, 0.13383,
    0.04823, 0.01566, 0.83777
    );

// ODT_SAT => XYZ => D60_2_D65 => sRGB
const mat3 aces_output_mat = mat3(
    1.60475, -0.10208, -0.00327,
    -0.53108,  1.10813, -0.07276,
    -0.07367, -0.00605,  1.07602
    );

vec3 rrt_and_odt_fit(vec3 v)
{
    vec3 a = v * (v + 0.0245786) - 0.000090537;
    vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
    return a / b;
}

vec3 aces_fitted(vec3 color)
{
	color = aces_input_mat * color;
    color = rrt_and_odt_fit(color);
    color = aces_output_mat * color;
    return clamp(color, 0.0, 1.0);
}

//-----------------------------------------------------------------------------

vec3 gamma_correct(vec3 linear_srgb)
{
    vec3 a = 12.92 * linear_srgb;
    vec3 b = 1.055 * pow(linear_srgb, vec3(1.0 / 2.4)) - 0.055;
    vec3 c = step(vec3(0.0031308), linear_srgb);
    return mix(a, b, c);
}
 

void projection_camera(in vec2 fragCoord, out float phi, out float theta, out vec3 ray_dir)
{
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;

    ray_dir = vec3( uv.x, uv.y, 1.0 / tan(radians(fCameraFov) * 0.5));
    ray_dir = normalize(ray_dir); 
    ray_dir = uCameraMat* ray_dir;

    phi = atan(ray_dir.x, ray_dir.z);
    theta = asin(ray_dir.y);
}


  
 

vec3 jodieReinhardTonemap(vec3 c){
    // From: https://www.shadertoy.com/view/tdSXzD
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    vec3 tc = c / (c + 1.0);
    return mix(c / (l + 1.0), tc, tc);
}


vec3 tonemap(vec3 col) {

#if SHOW_RELATIVE_LUMINANCE == 0
//#if TONEMAPPING_TECHNIQUE == 0
    if( bEnableACES ) {
    // Apply exposure
        col = col * exp2(EXPOSURE);
        // Tonemap
        col = aces_fitted(col);
        // Apply the sRGB transfer function (gamma correction)
        col = clamp(gamma_correct(col), 0.0, 1.0);
    } else {
//#elif TONEMAPPING_TECHNIQUE == 1
        const float k = 0.05;
        col = 1.0 - exp(-k * col);
        col = clamp(gamma_correct(col), 0.0, 1.0);
    }
//#endif
#else
    const mat3 srgb_to_xyz = mat3(0.4124564, 0.2126729, 0.0193339,
                                  0.3575761, 0.7151522, 0.1191920,
                                  0.1804375, 0.0721750, 0.9503041);
    vec3 xyz = srgb_to_xyz * col;
    float lum = xyz.y * (1.0 / 17.4862339609375);
    col = vec3(lum);
#endif

    return col;
}

vec4 transmittance_from_lut_debug(sampler2D lut, float cos_theta, float normalized_altitude)
{
    float v = clamp(cos_theta * 0.5 + 0.5, 0.0, 1.0); 

    float u = clamp(normalized_altitude, 0.0, 1.0);
    return texture(lut, vec2(u, v));
}


//------------------------------------------------------------------------------

void main()
{
    vec3 rightVector = normalize(uCameraMat[0]); // Right (X)
    vec3 upVector    = normalize(uCameraMat[1]); // Up (Y)
    vec3 viewVector  = normalize(uCameraMat[2]); // Forward (Z)
 

    vec2  fragCoord = gl_FragCoord.xy;

    if (u_keyPressed == 1) { 
        // show transmittance LUT
        vec2 uv = gl_FragCoord.xy / (1.0 * iResolution.xy );
        vec3 trans = texture(iChannel0, uv).rgb * 0.2; 
        gl_FragColor = vec4(trans, 1.0);

        return;

    } else if (u_keyPressed == 2) { 
        // show skyview LUT
        vec2 uv = gl_FragCoord.xy / (1.0 * iResolution.xy );
        vec3 trans = texture(iChannel1, uv).rgb* 1.0;
        gl_FragColor = vec4(trans, 1.0); 
        return;
    }  



    float phi, theta;
    vec3 rayDir;
 
    projection_camera(fragCoord, phi, theta, rayDir);

    float azimuth = phi / PI * 0.5 + 0.5;
    float elev = sqrt(abs(theta) / (PI * 0.5)) * sign(theta) * 0.5 + 0.5;

    vec3 col = texture(iChannel0, vec2(azimuth, elev)).rgb;
 

    vec3 sunRGB = vec3(0.0); 
    
 #if SUN_METHOD == 0

        float distance_to_earth_center = EARTH_RADIUS + fEyeAttitude;
        vec3 viewPos = vec3(0.0, distance_to_earth_center, 0.0);
        

    

        // --- SUN CALCULATION ---
        float cos_zenith = cos(radians(90.0 - fSunElevationDeg));
        vec3 sunDir = normalize(vec3(0.0, cos_zenith, sqrt(1.0 - cos_zenith*cos_zenith)));

        // Transmittance should still use the path to the sun
        // (Technically the sun path is refracted too, but view-ray refraction is more visible)
        float normalized_altitude = fEyeAttitude / ATMOSPHERE_THICKNESS;
        vec4 transmittance_to_sun = transmittance_from_lut(iChannel1, dot(normalize(viewPos), sunDir), normalized_altitude); 


        vec3 srgb_transmittance_to_sun = linear_srgb_from_spectral_samples(transmittance_to_sun);

 
        // IMPORTANT: Check intersection with INITIAL ray to hide sun behind Earth,
        // but use REFRACTED ray inside sunWithBloom to get the squashed shape.

        float distG = rayPerpendicularDistance(viewPos, rayDir, EARTH_RADIUS);

        if ( abs(distG) < 0.025  ) {
            // near the horizon, show the refraction effect more clearly for debugging
    
            vec4 result = getRefractedDirectionWithLift(viewPos, rayDir,24);

            float phi0 = atan(result.x, result.z);
            float theta0 = asin(result.y);
            float azimuth0 = phi0 / PI * 0.5 + 0.5;
            float elev0 = sqrt(abs(theta0) / (PI * 0.5)) * sign(theta0) * 0.5 + 0.5;

            float delev = min(abs( elev0 - elev), 0.005)-0.0025;

            col = 0.5*(col+texture(iChannel0, vec2(azimuth0, elev+ delev)).rgb);
            

        }
        
        if (rayIntersectSphere(viewPos, rayDir, EARTH_RADIUS) < 0.0) 
        { 
            // 1. March the GREEN ray (our baseline)
            vec4 result = getRefractedDirectionWithLift(viewPos, rayDir, 24);
            vec3 rayG = result.xyz;
            
            float liftG = result.w;

            // 2. Derive Red and Blue rays by adjusting the lift
            // We modify the Y component and re-normalize
            vec3 rayR = normalize(vec3(rayG.x, rayDir.y + liftG * 0.6994, rayG.z));
            vec3 rayB = normalize(vec3(rayG.x, rayDir.y + liftG * 1.09, rayG.z));

            // 3. Sample the sun disc for each channel
            float sunR = sunWithBloom(rayR, sunDir).r;
            float sunG = sunWithBloom(rayG, sunDir).g;
            float sunB = sunWithBloom(rayB, sunDir).b;
 
    
            // 4. Combine and Apply Scattering
            // Note: scattering hits Blue harder, so Blue might naturally disappear
            vec3 sunLum = vec3(sunR, sunG, sunB);
 
            srgb_transmittance_to_sun.r = max(srgb_transmittance_to_sun.r, 0.5 / max(1.0, fAerosolTurbidity));
            sunLum *= srgb_transmittance_to_sun; 
            
            col += sunLum;
        }
#else
    vec4 sumLumSpectral = computeSunDiskSpectral(rayDir, sunDir, radians(SUN_RADIUS_DEGREES* SUN_SCALE)); // 0.53° angular radius of the sun



    if (length(sumLumSpectral) > 0.0) 
    { 
        float distance_to_earth_center = EARTH_RADIUS + fEyeAttitude; // km
        vec3 viewPos = vec3(0.0,0.0, distance_to_earth_center); // ray origin

        if (rayIntersectSphere(viewPos, rayDir, EARTH_RADIUS) < 0.0) {
            // sun is not behind the Earth
            
        
            // If the sun value is applied to this pixel, we need to calculate the transmittance to obscure it.
            //sunLum *= getValFromTLUT(iChannel1, iChannelResolution[0].xy, viewPos, sunDir);
            // Compute transmittance to sun using LUT
            vec3 zenith = normalize(viewPos);
            float cosTheta = dot(zenith, sunDir); 
            float normalized_altitude = fEyeAttitude / ATMOSPHERE_THICKNESS; 
            //const float ATMOSPHERE_TOP = 30.0; // km
            //normalized_altitude = clamp(fEyeAttitude / ATMOSPHERE_TOP, 0.0, 1.0);
            //float log_altitude = log(1.0 + fEyeAttitude) / log(1.0 + ATMOSPHERE_THICKNESS); // [0,1]
           

            vec4 transmittance_to_sun = transmittance_from_lut(
                        iChannel1, 
                        cosTheta, 
                        normalized_altitude
                        //log_altitude 
                        ); 
            //vec4 tSun = max(transmittance_to_sun, vec4(.05)); // minimum floor
            //transmittance_to_sun = tSun;

                                    
            vec4 attenuatedSpectral = sumLumSpectral * transmittance_to_sun; // attenuate the sun disk by the transmittance to the sun
            //attenuatedSpectral *= exp2(-1.0*(-1.0) ); // apply exposure
  
            
             sunRGB = linear_srgb_from_spectral_samples(attenuatedSpectral);
             //sunRGB *=sunWithBloom(rayDir, sunDir)* .1;
            
            // Add subtle Mie bloom
             
             //sunRGB = computeSunBloom(rayDir, sunDir, radians(SUN_RADIUS_DEGREES* SUN_SCALE), 1.005, 3000.0)*10.0;
           // sunRGB = sunWithBloomPBR(rayDir, sunDir , transmittance_to_sun.r, 1.0) * 1.0;
           
            float sc = 0.00001; // scale factor to convert from W·m⁻²·nm⁻¹ to RGB
            if ( length(sunRGB*sc) < length(col) ) {
                col += (sunRGB).rgb*sc*10.;
            } else {
        
                col *= (sunRGB).rgb* sc;
            }
 
        }
       
    }  
#endif
 

    //-------------------------------------


 
    col = tonemap(col);
    

    // Add lens flare
    float cosTheta0 = dot(viewVector , sunDir); 
    float cosTheta1 = cos(radians(fCameraFov*0.5+ 30.0));
     
    if (bEnableFlare){
        if (cosTheta0 > max( 0.,cosTheta1 )) 
        {

            const float minSunCosTheta = cos(SUN_RADIUS_RADIANS* SUN_SCALE);
            float cosTheta00 = dot(rayDir, sunDir);

            {
                // Inside sun disk → return pure white light (maximum brightness).
                //vec3 col = vec3(0.0);
                float d = 1.0- minSunCosTheta;
                //cosTheta = ( (cosTheta-minSunCosTheta)/ d);
                // col.r = limbDarkening(cosTheta ,700.0);
                // col.g = limbDarkening(cosTheta ,555.0);
                // col.b = limbDarkening(cosTheta ,380.0);

                //vec3 col2 = limbDarkeningV3(cosTheta);

                //return 8.*col;
                //return vec3(1.0)*4.*max(smoothstep(  minSunCosTheta-t,  minSunCosTheta+t, cosTheta), 0.25);


                vec3 deviation = sunDir - viewVector;
                // Compute sun alignment in screen space
                vec2 sun0   = vec2(
                            dot( deviation, rightVector),   // horizontal deviation
                            dot( deviation, upVector)   // vertical deviation
                        );

                // Difference from the camera's forward direction
                deviation = rayDir - viewVector;

                // Construct a 2D offset in camera-aligned screen space.
                // Project deviation vector onto the camera's right and up axes
                vec2 rd0 = vec2( 
                            dot(deviation, rightVector),    // horizontal deviation
                            dot(deviation, upVector)    // vertical deviation
                            );

                vec3 musk_color = vec3(1.0,0.85,0.71)*musk_Lensflare(rd0,sun0, 40.);       


                vec3 clampT = clamp(1.0*(srgb_transmittance_to_sun), 0., 1.2 );
                clampT.g = clamp( clampT.g, 0., 0.8);
                clampT.b = clamp( clampT.b, 0., 0.6);

                //if( cosTheta00 < minSunCosTheta ) 
                {
                    col += (musk_color * clampT); 
                } 

            }
        }
    }



    // col = jodieReinhardTonemap(col);
    // col = pow(col, vec3(1.0/2.2));
 
    gl_FragColor = vec4(col, 1.0);  
 
    
    //if (u_keyPressed == 4)  
    {   //--- lens dirt texture

        float sunVis = clamp(dot(rayDir, sunDir), 0.0, 1.0);
        sunVis = smoothstep( 0.33, 1., sunVis);
    
        vec2 uv2 = getAspectUV(gl_FragCoord.xy);
        vec4 dirt = texture2D(iChannel2, uv2 ); 
        const float base_dirt = .8;
        const float opacity = 1.;
        vec3 nL = srgb_transmittance_to_sun;

        nL =  clamp( nL, 0., 1. );
        float li = dot(nL,nL); 
        li = smoothstep(0.6, 3.25, li);
        gl_FragColor += max(1.0-opacity, base_dirt)*( 0.33*sunVis)* dirt * li;
    } 
    return;
}