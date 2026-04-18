import GUI from 'lil-gui';

export type AddControlOptions = {
    label?: string;
    min?: number;
    max?: number;
    step?: number;
    decimals?: number;
    listen?: boolean;
    onChange?: (value: any) => void;
};

export type GUIController = {
    domElement: HTMLElement;
    _property?: string;
};

export class GuiController {

    //: keep unused reference for later to add presets, save/load, etc
    private gui: GUI;

    constructor(gui: GUI) {
        this.gui = gui;
    }

    addControl(
        folder: GUI,
        obj: any,
        prop: string,
        options: AddControlOptions = {}
    ) {
        const {
            label = prop,
            min,
            max,
            step,
            decimals,
            listen,
            onChange
        } = options;

        let ctrl = (min !== undefined)
            ? folder.add(obj, prop, min, max, step)
            : folder.add(obj, prop);

        if (decimals !== undefined) ctrl = ctrl.decimals(decimals);
        if (listen) ctrl = ctrl.listen();

        ctrl.name(label);

        if (onChange) {
            ctrl.onChange(onChange);
        }

        this.applyAutoId(ctrl, prop);

        return ctrl;
    }

    private applyAutoId(controller: GUIController, name: string) {
        
        const input = 
            controller.domElement.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
                ('.widget input, .widget select, .widget textarea');

        if (!input) return;

        const safeName = name
            .replace(/\s+/g, '-')
            .replace(/[^a-zA-Z0-9\-]/g, '')
            .toLowerCase();

        const id = `gui-${safeName}`;

        if (!input.id) {
            input.id = id;
            input.name = id;
        }

        const label = controller.domElement.querySelector('label');
        if (label) {
            label.setAttribute('for', id);
        }
    }
}