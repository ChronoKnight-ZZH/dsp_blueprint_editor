"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.truth = exports.attachCamera = exports.attachRenderer = exports.debugMat = void 0;
const three_1 = require("three");
const vue_1 = require("vue");
function debugMat(m) {
    const trans = new three_1.Vector3();
    const rotation = new three_1.Quaternion();
    const scale = new three_1.Vector3();
    m.decompose(trans, rotation, scale);
    console.log('translation', trans);
    console.log('rotation   ', rotation);
    console.log('scale      ', scale);
}
exports.debugMat = debugMat;
function attachRenderer(el, renderer) {
    const onResize = () => {
        const rect = el.value.getBoundingClientRect();
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(rect.width, rect.height);
    };
    (0, vue_1.onMounted)(() => {
        onResize();
        window.addEventListener('resize', onResize);
        el.value.appendChild(renderer.domElement);
    });
    (0, vue_1.onUnmounted)(() => {
        window.removeEventListener('resize', onResize);
        renderer.dispose();
    });
}
exports.attachRenderer = attachRenderer;
function attachCamera(el, camera) {
    const onResize = () => {
        const rect = el.value.getBoundingClientRect();
        camera.aspect = rect.width / rect.height;
        camera.updateProjectionMatrix();
    };
    (0, vue_1.onMounted)(() => {
        onResize();
        window.addEventListener('resize', onResize);
    });
    (0, vue_1.onUnmounted)(() => { window.removeEventListener('resize', onResize); });
}
exports.attachCamera = attachCamera;
function truth(v) { return v ? '✓' : '✗'; }
exports.truth = truth;
//# sourceMappingURL=utils.js.map