

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

#include "atmosphere.glsl"
#include "noise.glsl"
#include "math.glsl"
#include "tonemapping.glsl"
 

#define SUN_STREAK 0 // 0 = disable sun streaks (performance boost, but less "musk-y")



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

    float L = length(uv-pos);
    sz = 30.;
    float f0sc = 0.1;
	float f0 = 1.0/(L*sz+.1) * f0sc; 
 
#if SUN_STREAK == 1
    // TODO: intensity of sunstreaks should be based on the angle to the sun, not just distance from center,
    // and also based on intensity of the sun disk (brighter sun = stronger streaks). This is a placeholder.
	f0 =  0.05* f0+ 0.2*f0*(sin((ang+iTime/18.0 +2.0)*12.0)*.1+dist*.1+.8);
#else
    f0 = 0.05*f0;
#endif 

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


vec3 tonemap(vec3 col) {

#if SHOW_RELATIVE_LUMINANCE == 0 
    if( bEnableACES ) {
    // Apply exposure
        col = col * exp2(EXPOSURE);
        // Tonemap
        col = aces_fitted(col);
        // Apply the sRGB transfer function (gamma correction)
        col = clamp(gamma_correct(col), 0.0, 1.0);
    } else { 
        const float k = 0.05;
        col = 1.0 - exp(-k * col);
        col = clamp(gamma_correct(col), 0.0, 1.0);
    } 
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

 


vec2 getAspectUV(vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    uv -= 0.5;
    uv *= uUVScale; // uniform passed from TS
    uv += 0.5;
    return uv;
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
    vec3 rayDir = projection_camera(fragCoord, fCameraFov, uCameraMat, phi, theta);

    float azimuth = phi / PI * 0.5 + 0.5;
    float elev = sqrt(abs(theta) / (PI * 0.5)) * sign(theta) * 0.5 + 0.5;

    vec3 col = texture(iChannel0, vec2(azimuth, elev)).rgb;
 

    vec3 sunRGB = vec3(0.0); 
    
    //--- Sun rendering with atmospheric refraction and bloom

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
          
                float d = 1.0- minSunCosTheta;
         


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

    // Optional: Apply gamma correction to convert from linear to sRGB space for display.
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