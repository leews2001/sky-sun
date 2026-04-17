// AtmosphereUI.ts

import GUI from 'lil-gui';
import { MovementController } from './utils/MovementController';

 //: The AtmosphereUI class encapsulates the user interface for 
 //: controlling various atmospheric and camera settings in the sky and sun rendering application.

export class AtmosphereUI {
   
   
    private gui: GUI;
    private settings: any; 
    private movController: MovementController; 

    //: Constructor initializes the UI with references to the GUI instance, settings object, and movement controller.
    constructor(
        gui: GUI,
        settings: any, 
        movController: MovementController, 
    ) {
        this.gui = gui;
        this.settings = settings; 
        this.movController = movController; 
    }

    //: This method initializes the UI by creating folders and controls for different categories of settings.
    public init(): void {

        this.xAddAtmostphereFolder();
        this.xAddSunEffectFolder();
        this.xAddLensEffectFolder();

        this.xAddCameraFolder();
        this.xAddPostProcessFolder();
        this.xAddToneMappingFolder();
        this.xAddDebugFolder();
    }

    //--- PRIVATE METHODS

    //: This helper method generates a unique ID for a given controller and assigns it to the corresponding input element in the GUI.
    private autoId(name: string, controller: any): any {

        const input = controller.domElement.querySelector('input, select, checkbox');

        if (input) {
            //: Generate a unique ID based on the property name and the provided name, and assign it to the input element. 
            //: This allows for better accessibility and potential future styling.
            const id = `gui-${controller._property}-${name.replace(/\s+/g, '-').toLowerCase()}`;
            input.id = id;
            input.setAttribute('name', id);
        }

        //: Return for chaining
        return controller; 
    }


    //: This method sets up the ATMOSPHERE folder and its controls
    private xAddAtmostphereFolder() {

        const atm = this.gui.addFolder('ATMOSPHERE');
        
        atm.add(this.settings, 'enableMultipleScattering').name(' ▪ m. scatter');

        //: The aerosol control is a slider that allows the user to adjust the aerosol density in the atmosphere, 
        //: which affects the scattering and overall appearance of the sky.
        this.autoId(
            'aerosol',
            atm.add(this.settings, 'aerosol', 0.1, 30.0, 0.1)
                .decimals(1)
                .name(' ▪ aerosol')
                .listen()
        );

        atm.add(this.settings, 'enableDust').name(' ▪ dust');

        //: The wind intensity control is a slider that adjusts the strength of the wind effect in the atmosphere,
        this.autoId(
            'windintensity',
            atm.add(this.settings, 'windIntensity', .0, 1.0, 0.02)
                .decimals(2)
                .name(' ▪ wind')
        );

        return;
    }

    //: This method sets up the SUN EFFECT folder and its controls
    private xAddSunEffectFolder() {

        const sun = this.gui.addFolder('SUN EFFECT');

        sun.add(this.settings, 'enableRefract').name(' ▪ refract');
        sun.add(this.settings, 'enableHeatHaze').name(' ▪ heat haze');
        sun.add(this.settings, 'enableLimbDarken').name(' ▪ limb dark');

        //: The sun elevation control is a slider that allows the user to adjust the angle of the sun above the horizon, which affects the lighting and color of the sky.
        this.autoId( 'sunelev',
            sun.add(this.settings, 'sunElevation', -20, 89.0,0.1)
                .decimals(1)
                .name(' ▪ elev (deg)')
                .listen()
        );

  
        return;
    }

    //: This method sets up the LENS EFFECT folder and its controls
    private xAddLensEffectFolder() {

        const lens = this.gui.addFolder('LENS EFFECT');

        lens.add(this.settings, 'enableFlare').name(' ▪ flare');
        lens.add(this.settings, 'enableLensDirt').name(' ▪ dirt');

        this.autoId('lensdirtweight',
            lens.add(this.settings, 'lensDirtWeight', 0, 2, 0.1)
                .decimals(1)
                .name(' ▪ dirt wgt.')
        );

        this.autoId('lensdirtstep0',
            lens.add(this.settings, 'lensDirtStep0', 0, 1, 0.1)
                .decimals(1)
                .name(' ▪ dirt step0')
        );
        
        this.autoId('lensdirtstep1',
            lens.add(this.settings, 'lensDirtStep1', 0, 5, 0.1)
                .decimals(1)
                .name(' ▪ dirt step1')
        );

        return;
    }

    private syncRotation(euler: { pitch: number, roll: number, yaw: number }) {

        this.settings.camPitch = euler.pitch;
        this.settings.camRoll = euler.roll;
        this.settings.camYaw = euler.yaw;

        this.settings._prevPitch = euler.pitch;
        this.settings._prevRoll = euler.roll;
        this.settings._prevYaw = euler.yaw;

        return;
    }

    //: This method sets up the CAMERA folder and its rotation sliders
    private xAddCameraFolder() {

        const cam = this.gui.addFolder('CAMERA');
        cam.add(this.settings, 'enablebreathing').name(' ▪ breathing');

        this.addRotationSlider(cam, 'camRoll', 'roll');
        this.addRotationSlider(cam, 'camPitch', 'pitch');
        this.addRotationSlider(cam, 'camYaw', 'yaw');

        this.autoId('camfov',
            cam.add(this.settings, 'camFov', 5, 170,0.5).name(' ▪ fOV')
            .decimals(1)
            .listen()
            .onChange( (val: number) => {
                this.movController.camFOV = val;
            })
        );

        this.autoId('eyeattitude',
        cam.add(this.settings, 'eyeAttitude', 0.02, 80, 0.1)
            .decimals(2)
            .name(' ▪ altitude')
            .listen()
            .onChange( (val: number) => {
                this.movController.camYPos = val;
            })
        );
        return;
    }

    //: This method adds a rotation slider for camera control and sets up its onChange behavior
    private addRotationSlider(folder: any, prop: string, label: string) {

        return this.autoId(prop.toLowerCase(), 
            folder.add(this.settings, prop, -180, 180, 0.1)
                .decimals(1)
                .name(` ▪ ${label}`)
                .listen()
                .onChange((val: number) => {

                    // 1. Calculate the delta from the LAST KNOWN STATE (not the current slider value, which may have wrapped around)
                    const stateKey = `_prev${prop.replace('cam', '')}` as keyof typeof this.settings;
                    
                    let delta = val - (this.settings[stateKey] as number);

                    // 2. Handle the -180/180 wrap-around for the slider
                    if (delta > 180) delta -= 360;
                    if (delta < -180) delta += 360;

                    // 3. Convert delta to radians for the movement controller
                    const rad = delta * Math.PI / 180;
                    const euler = this.movController.update(
                        prop === 'camPitch' ? -rad : 0,
                        prop === 'camYaw' ? rad : 0,
                        prop === 'camRoll' ? rad : 0
                    );
                    this.syncRotation(euler); // Atomic update
                })
        );
        return;
    }

    //: This method sets up the POST-PROCESS folder and its controls
    private xAddPostProcessFolder() {
        const pp = this.gui.addFolder('POST-PROCESS');

        pp.add(this.settings, 'enableDither').name(' ▪ dither');
        pp.add(this.settings, 'enableGrain').name(' ▪ grain');

        this.autoId('grainweight',
            pp.add(this.settings, 'grainWeight', 0, 3, 0.1)
            .name(' ▪ grain wgt.')
            .decimals(1)
        );

        return;
    }

    //: This method sets up the TONE MAPPING folder and its controls
    private xAddToneMappingFolder() {

        const tone= this.gui.addFolder('TONE MAPPING');
        tone.add(this.settings, 'enableACES').name(' ▪ aces');
        return;
    }

    //: This method sets up the DEBUG folder and its controls
    private xAddDebugFolder() {

        const debug = this.gui.addFolder('DEBUG');

        debug.add(this.settings, 'enableCheckerboard').name(' ▪ checkerboard');
        
        this.autoId('checkerboardscale',
            debug.add(this.settings, 'checkerboardScale', 1.0, 200.0, 1)
            .decimals(0)
            .name(' ▪ scale')
        );
 
        return;
    }
 
} // End of AtmosphereUI class