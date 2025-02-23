import * as THREE from 'three-usage-test';

abstract class TestBase {
    private readonly statsFps: THREE.Stats;
    private readonly statsDrawCalls: THREE.Stats;
    private readonly statsDrawCallsPanel: THREE.Stats.Panel;
    private readonly statsTriangles: THREE.Stats;
    private readonly statsTrianglesPanel: THREE.Stats.Panel;

    protected readonly renderer: THREE.WebGLRenderer;
    protected readonly camera: THREE.PerspectiveCamera;
    protected readonly cameraControl: THREE.OrbitControls;
    protected readonly scene: THREE.Scene;

    private started: boolean = false;
    private lastUpdateTimestamp: number | null = null;

    protected maxFps: number = Infinity;

    public constructor() {
        this.statsFps = new THREE.Stats();
        document.body.appendChild(this.statsFps.dom);

        this.statsDrawCalls = new THREE.Stats();
        document.body.appendChild(this.statsDrawCalls.dom);
        this.statsDrawCallsPanel = new THREE.Stats.Panel('draw calls', '#f8f', '#212');
        this.statsDrawCalls.addPanel(this.statsDrawCallsPanel);
        this.statsDrawCalls.showPanel(3);
        this.statsDrawCalls.dom.style.cssText = 'position:fixed;top:50px;left:0px;cursor:pointer;z-index:10000';

        this.statsTriangles = new THREE.Stats();
        document.body.appendChild(this.statsTriangles.dom);
        this.statsTrianglesPanel = new THREE.Stats.Panel('triangles', '#f8f', '#212');
        this.statsTriangles.addPanel(this.statsTrianglesPanel);
        this.statsTriangles.showPanel(3);
        this.statsTriangles.dom.style.cssText = 'position:fixed;top:100px;left:0px;cursor:pointer;z-index:10000';

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
        this.scene.name = 'test-scene';
        this.scene.matrixAutoUpdate = false;
        this.scene.add(new THREE.AxesHelper(500));
    }

    public start(): void {
        if (this.started) {
            console.warn('Cannot start a TestBase twice');
            return;
        }
        this.started = true;

        setInterval(() => {
            const rendererInfos = this.renderer.info;
            this.statsDrawCallsPanel.update(rendererInfos.render.calls, 200);
            this.statsTrianglesPanel.update(rendererInfos.render.triangles, 200);
        }, 100);

        let lastRenderTimestamp = performance.now();

        const render = () => {
            const now = performance.now();
            const minDeltaTime = 1000 / this.maxFps;
            const deltaTime = now - lastRenderTimestamp;

            if (deltaTime >= minDeltaTime) {
                this.statsFps.update();

                this.cameraControl.update();

                const now = performance.now();
                if (this.lastUpdateTimestamp === null) {
                    this.lastUpdateTimestamp = now;
                }
                this.update(now - this.lastUpdateTimestamp);
                this.lastUpdateTimestamp = now;
                this.render();
                lastRenderTimestamp = now;
            }
            window.requestAnimationFrame(render);
        };
        window.requestAnimationFrame(render);
    }

    protected render(): void {
        this.renderer.render(this.scene, this.camera);
    }

    protected abstract update(deltaMilliseconds: number): void;
}

export { TestBase };

