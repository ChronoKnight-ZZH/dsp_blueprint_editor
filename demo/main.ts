/**
 * BlueprintViewer 最小 demo（阶段 B 验证页）。
 *
 * 目的：证明 `new BlueprintViewer({ container })` + `loadBlueprint(str)` 这条
 * 主链路能在真实浏览器里跑通——单测与 build 都验证不了 WebGL 实际渲染效果。
 *
 * 访问：`yarn serve` 后打开 http://localhost:8080/dsp_blueprint_editor/demo/
 * （publicPath 是 /dsp_blueprint_editor/，见 vue.config.js）
 */
import { BlueprintViewer } from '@/lib';
import type { BlueprintLoadOutcome, ViewerError } from '@/lib';

const container = document.getElementById('viewer')!;
const logEl = document.getElementById('log')!;
const resultEl = document.getElementById('result')!;
const blueprintInput = document.getElementById('blueprint') as HTMLTextAreaElement;
const showRealModelsEl = document.getElementById('showRealModels') as HTMLInputElement;
const texturesEnabledEl = document.getElementById('texturesEnabled') as HTMLInputElement;
const maxInstancesEl = document.getElementById('maxInstances') as HTMLInputElement;

function log(msg: string, cls = '') {
    const line = document.createElement('div');
    if (cls) line.className = cls;
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
}

function showResult(outcome: BlueprintLoadOutcome) {
    resultEl.className = outcome.ok ? 'ok' : 'err';
    if (outcome.ok) {
        const v = outcome.value;
        resultEl.textContent =
            `✓ ok：buildingCount=${v.buildingCount}，areas=${v.areas.length}，` +
            `header.shortDesc="${v.header.shortDesc}"，` +
            `unknownModelIndexes=[${v.unknownModelIndexes.join(', ')}]`;
    } else {
        const e = outcome.error;
        resultEl.textContent = `✗ ${e.code}（phase=${e.phase}）：${e.message}`;
    }
}

// ---------------------------------------------------------------- Viewer 实例

let viewer: BlueprintViewer | null = null;

function readSettings() {
    return {
        showRealModels: showRealModelsEl.checked,
        texturesEnabled: texturesEnabledEl.checked,
        maxInstancesPerModel: Number(maxInstancesEl.value) || Infinity,
    };
}

function createViewer() {
    viewer = new BlueprintViewer(
        { container: '#viewer', ...readSettings() },
        {
            onBuildingSelect: index => log(`onBuildingSelect: ${index}`),
            onCameraChange: () => { /* 高频回调，不打日志 */ },
            onRebuild: info => log(`onRebuild: reason=${info.reason} buildings=${info.buildingCount} ${info.durationMs}ms`),
            onError: (e: ViewerError) => log(`onError: ${e.code} (${e.phase}) ${e.message}`, 'err'),
        },
    );
    log('new BlueprintViewer(...) 完成');
}

function loadBlueprint(str: string) {
    if (viewer === null) return;
    const t0 = performance.now();
    const outcome = viewer.loadBlueprint(str);
    showResult(outcome);
    log(`loadBlueprint 返回 ${outcome.ok ? 'ok' : outcome.error.code}，耗时 ${(performance.now() - t0).toFixed(0)}ms`);
}

// ---------------------------------------------------------------- 事件绑定

document.getElementById('btnCreate')!.addEventListener('click', () => {
    if (viewer !== null) {
        log('viewer 已存在，先 dispose', 'err');
        return;
    }
    createViewer();
});

document.getElementById('btnLoad')!.addEventListener('click', () => {
    loadBlueprint(blueprintInput.value);
});

document.getElementById('btnLoadFixture')!.addEventListener('click', async () => {
    // 页面在 /dsp_blueprint_editor/demo.html，fixture 在 public/demo/ 下，
    // 相对本页的路径是 demo/sample_throughput.txt（不依赖 publicPath 的绝对值）
    const res = await fetch('demo/sample_throughput.txt');
    if (!res.ok) {
        log(`fetch fixture 失败：${res.status}`, 'err');
        return;
    }
    blueprintInput.value = (await res.text()).trim();
    loadBlueprint(blueprintInput.value);
});

document.getElementById('btnBadString')!.addEventListener('click', () => {
    loadBlueprint('BLUEPRINT:not-a-real-blueprint');
});

document.getElementById('btnResetCamera')!.addEventListener('click', () => {
    viewer?.resetCamera();
    log('resetCamera()');
});

document.getElementById('btnDispose')!.addEventListener('click', () => {
    if (viewer === null) {
        log('viewer 不存在', 'err');
        return;
    }
    viewer.dispose();
    viewer = null;
    log('dispose() 完成；canvas 残留数=' + container.querySelectorAll('canvas').length);
});

// 三个设置任一变化 → setRenderSettings（showRealModels/maxInstances 重建，textures 原地重挂）
for (const el of [showRealModelsEl, texturesEnabledEl, maxInstancesEl]) {
    el.addEventListener('change', () => {
        if (viewer === null) return;
        const settings = readSettings();
        viewer.setRenderSettings(settings);
        log(`setRenderSettings(${JSON.stringify(settings)})`);
    });
}

// 加载后顺带验证 getBlueprintData / dispose 后再调用返回 already-disposed
document.getElementById('btnGetData')!.addEventListener('click', () => {
    const data = viewer === null ? null : viewer.getBlueprintData();
    log(`getBlueprintData(): ${data === null ? 'null' : `buildings=${data.buildings.length}`}`);
});

// 启动即创建 viewer，加载 fixture（demo 的最短路径）
createViewer();
void (async () => {
    try {
        const res = await fetch('demo/sample_throughput.txt');
        if (res.ok) {
            blueprintInput.value = (await res.text()).trim();
            loadBlueprint(blueprintInput.value);
        }
    } catch (e) {
        log(`自动加载 fixture 失败：${String(e)}`, 'err');
    }
})();
