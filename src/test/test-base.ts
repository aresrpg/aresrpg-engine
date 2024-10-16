import * as THREE from 'three-usage-test';

abstract class TestBase {
    private readonly stats: THREE.Stats;

    protected readonly renderer: THREE.WebGLRenderer;
    protected readonly camera: THREE.PerspectiveCamera;
    protected readonly cameraControl: THREE.OrbitControls;
    protected readonly scene: THREE.Scene;

    private started: boolean = false;

    protected maxFps: number = Infinity;

    public constructor() {
        this.stats = new THREE.Stats();
        document.body.appendChild(this.stats.dom);

        this.renderer = new THREE.WebGLRenderer();
        document.body.appendChild(this.renderer.domElement);
        this.renderer.setClearColor(0x880000);

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 10000);
        const udpateRendererSize = () => {
            const width = window.innerWidth;
            const height = window.innerHeight;
            this.renderer.setSize(width, height);
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
        };
        window.addEventListener('resize', udpateRendererSize);
        udpateRendererSize();

        this.camera.position.set(0, 210, 10);
        this.cameraControl = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.cameraControl.target.set(0, this.camera.position.y - 10, 0);

        this.scene = new THREE.Scene();
        this.scene.name = 'Scene';
        this.scene.matrixAutoUpdate = false;
        this.scene.add(new THREE.AxesHelper(500));
    }

    public start(): void {
        if (this.started) {
            console.warn('Cannot start a TestBase twice');
            return;
        }
        this.started = true;

        let lastRenderTimestamp = performance.now();

        const render = () => {
            const now = performance.now();
            const minDeltaTime = 1000 / this.maxFps;
            const deltaTime = now - lastRenderTimestamp;
            
            if (deltaTime >= minDeltaTime) {
                this.stats.update();
                
                this.cameraControl.update();
                this.update();
                this.renderer.render(this.scene, this.camera);
                lastRenderTimestamp = now;
            }
            window.requestAnimationFrame(render);
        };
        window.requestAnimationFrame(render);
    }

    protected abstract update(): void;
}

export { TestBase };
