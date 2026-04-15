
import { quat, mat3, vec3 } from 'gl-matrix';



function log_vector(label: string, v: vec3, precision: number = 2): void {
  console.log(
    `${label}$: (${v[0].toFixed(precision)}, ${v[1].toFixed(precision)}, ${v[2].toFixed(precision)})`
  );
}



export class MovementController {
     
    public cameraMat3  = mat3.create(); // gl-matrix mat3 for calculations
    public camYPos : number = .05; // Camera Y position for uniform updates
    public camFOV: number = 80.0; // Camera Field of View;

    private readonly _camRot = mat3.create();     // reuse mat3
    private readonly _axisRight = vec3.create();  // reuse vectors
    private readonly _axisUp = vec3.create();
    private readonly _axisForward = vec3.create();
    private readonly _qPitch = quat.create();     // reuse quats
    private readonly _qYaw = quat.create();
    private readonly _qRoll = quat.create();
    private readonly cameraQuat = quat.create(); // identity

    private _idleTime = 0;

    public applyIdleMotion(deltaTime: number) {
        this._idleTime += deltaTime;

        // 1. Breathing (Up/Down) - ~0.25Hz (1 breath every 4s)
        const breath = Math.sin(this._idleTime * 1.5) * 0.00005;

        // 2. Head Drift (Wandering)
        //const driftYaw = Math.cos(this._idleTime * 0.7) * 0.00005;
        // half of breathing pitch
        const driftPitch = Math.sin(this._idleTime * 0.4) * 0.000019;

        // 3. Natural Micro-Roll
        const microRoll = Math.cos(this._idleTime * 1.1) * 0.00013;

        // 4. Random Jitter (Muscle twitch)
        const jitter = (Math.random() - 0.5) * 0.00025;

        // Inject these into your update logic
        // You can pass these into your existing update() as deltas
        this.update(
            breath + driftPitch + jitter, // dPitch
            jitter* 1.21,//driftYaw,                     // dYaw
            jitter*1.13+ microRoll                     // dRoll
        );
    }

    public euler: { roll: number; pitch: number; yaw: number } = {
        roll: 0,
        pitch: 0,
        yaw: 0,
    };
    
    

    constructor() {
        // Initialize cameraQuat to identity
        quat.identity(this.cameraQuat);
        // Initialize cameraMat3 to identity 
        mat3.identity(this.cameraMat3);

        mat3.fromQuat(this._camRot, this.cameraQuat);

        // // Fill axis vectors from matrix (avoids vec3.fromValues allocations)
        vec3.set(this._axisRight,   this._camRot[0], this._camRot[1], this._camRot[2]);
        vec3.set(this._axisUp,      this._camRot[3], this._camRot[4], this._camRot[5]);
        vec3.set(this._axisForward, this._camRot[6], this._camRot[7], this._camRot[8]);
    }


    public update( 
        dPitch: number,  // delta pitch in radians
        dYaw: number,  // delta yaw in radians
        dRoll: number ) // delta roll in radians
        : { roll: number; pitch: number; yaw: number } {

        this.euler.pitch+=dPitch;

        if ( this.euler.pitch > Math.PI) this.euler.pitch -= 2*Math.PI;
        if ( this.euler.pitch < -Math.PI) this.euler.pitch += 2*Math.PI;

        this.euler.roll+=dRoll;

        if ( this.euler.roll > Math.PI) this.euler.roll -= 2*Math.PI;
        if ( this.euler.roll < -Math.PI) this.euler.roll += 2*Math.PI;

        this.euler.yaw+=dYaw;
        if ( this.euler.yaw > Math.PI) this.euler.yaw -= 2*Math.PI;
        if ( this.euler.yaw < -Math.PI) this.euler.yaw += 2*Math.PI;
        

        // Build incremental rotations (in-place)
        quat.setAxisAngle(this._qPitch, this._axisRight,   dPitch);
        quat.setAxisAngle(this._qYaw,   this._axisUp,      dYaw);
        quat.setAxisAngle(this._qRoll,  this._axisForward, dRoll); 

        // 1. Update the quaternion
        // Accumulate rotations in cameraQuat (reuse memory)
        quat.multiply(this.cameraQuat, this._qYaw, this.cameraQuat);
        quat.multiply(this.cameraQuat, this._qPitch, this.cameraQuat);
        quat.multiply(this.cameraQuat, this._qRoll, this.cameraQuat);
        quat.normalize(this.cameraQuat, this.cameraQuat);

        // --- CRITICAL ADDITION ---
        // Refresh the axis vectors from the NEWLY UPDATED quaternion

        mat3.fromQuat(this._camRot, this.cameraQuat);

        // Fill axis vectors from matrix (avoids vec3.fromValues allocations)
        vec3.set(this._axisRight,   this._camRot[0], this._camRot[1], this._camRot[2]);
        vec3.set(this._axisUp,      this._camRot[3], this._camRot[4], this._camRot[5]);
        vec3.set(this._axisForward, this._camRot[6], this._camRot[7], this._camRot[8]);

        //-------------------------        
        mat3.fromQuat(this.cameraMat3, this.cameraQuat);

        const pitch = this.angleToGroundPlane_v1( 
            { x: this._axisForward[0], y: this._axisForward[1], z: this._axisForward[2]}, 
        );

        const yaw = this.yawToForward( 
            { x: this._axisForward[0], y: this._axisForward[1], z: this._axisForward[2]} );

        
        const roll = this.rollToUp(
            { x: this._axisRight[0], y: this._axisRight[1], z: this._axisRight[2] }, // Right
            { x: this._axisUp[0], y: this._axisUp[1], z: this._axisUp[2] }  // Up
        );
        
        this.euler.pitch = pitch * Math.PI/180.0;
        this.euler.yaw = yaw * Math.PI/180.0;
        this.euler.roll = roll * Math.PI/180.0;

        return {roll, pitch, yaw};
    } // << End of update() method

    //: Returns angle (in radians) between vector v and the ground plane (XZ plane)

    private angleToGroundPlane_v1(fwd: {x: number, y: number, z: number}): number {

        // 1. Calculate the horizontal length of the forward vector (projection on XZ plane)
        const horizontalLen = Math.sqrt(fwd.x * fwd.x + fwd.z * fwd.z);

        // 2. Pitch is the angle between the vertical (y) and the horizontal length

        const angleRad = Math.atan2(fwd.y, horizontalLen);

        return angleRad * (180.0 / Math.PI);
    }

 
    private yawToForward(v: {x: number, y: number, z: number}): number {
        // Project to ground (XZ) plane
        const px = v.x;
        const pz = v.z;

        // Handle zero-length projection
        if (px === 0 && pz === 0) return 0;

        // atan2 returns angle in radians
        return Math.atan2(px, pz)* (180. / Math.PI); // angle in deg
    }

    private rollToUp(
        right: {x: number, y: number, z: number}, 
        up: {x: number, y: number, z: number}): number {
        
        const angleRad = Math.atan2(right.y, up.y);

        return angleRad * (180.0 / Math.PI);
    }


} // <<< End of MovementController class

 